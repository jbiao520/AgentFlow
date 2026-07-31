//! Shared process spawn + line streaming for engine adapters.
use crate::db::now_iso8601;
use crate::engines::adapter::{prepare_command, EngineRunRequest, LogEvent};
use rusqlite::Connection;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

/// Cooperative cancel flag — set to request child kill.
#[derive(Clone, Default)]
pub struct CancelToken {
    cancelled: Arc<AtomicBool>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

struct KillOnDrop {
    child: Option<Child>,
}

impl KillOnDrop {
    fn new(child: Child) -> Self {
        Self { child: Some(child) }
    }

    fn take(mut self) -> Child {
        self.child.take().expect("child already taken")
    }
}

impl Drop for KillOnDrop {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Validate `cwd` matches an imported agent workspace (canonicalized path compare).
pub fn validate_imported_workspace(conn: &Connection, cwd: &str) -> Result<String, String> {
    let target = canonicalize_existing(cwd)?;
    let agents = crate::repo::list_agents(conn)?;
    for agent in agents {
        let Ok(ws) = canonicalize_existing(&agent.workspace_path) else {
            continue;
        };
        if ws == target {
            return Ok(target.to_string_lossy().to_string());
        }
    }
    Err(format!(
        "cwd is not an imported agent workspace: {cwd}"
    ))
}

fn canonicalize_existing(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err(format!("cwd must be absolute: {path}"));
    }
    p.canonicalize()
        .map_err(|e| format!("cwd not accessible ({path}): {e}"))
}

/// Spawn engine process; stream stdout/stderr lines via `on_log`; return exit code.
/// Caller must validate `req.cwd` is an imported workspace before calling.
/// Kills child on cancel token or if the function returns early (drop).
pub fn run_engine_unchecked<F>(
    req: &EngineRunRequest,
    cancel: &CancelToken,
    mut on_log: F,
) -> Result<i32, String>
where
    F: FnMut(LogEvent),
{
    let prepared = prepare_command(req)?;
    emit(
        &mut on_log,
        "stderr",
        &format!("$ {} {}", prepared.program, prepared.args.join(" ")),
    );

    let mut command = Command::new(&prepared.program);
    command
        .args(&prepared.args)
        .current_dir(&req.cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    for (k, v) in &req.env {
        command.env(k, v);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("spawn {}: {e}", prepared.program))?;

    let stdout = child.stdout.take().ok_or("missing stdout")?;
    let stderr = child.stderr.take().ok_or("missing stderr")?;

    let (tx, rx) = std::sync::mpsc::channel::<LogEvent>();

    let tx_out = tx.clone();
    let out_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let _ = tx_out.send(LogEvent {
                        ts: now_iso8601(),
                        stream: "stdout".into(),
                        line,
                    });
                }
                Err(_) => break,
            }
        }
    });

    let tx_err = tx;
    let err_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let _ = tx_err.send(LogEvent {
                        ts: now_iso8601(),
                        stream: "stderr".into(),
                        line,
                    });
                }
                Err(_) => break,
            }
        }
    });

    let mut guard = KillOnDrop::new(child);

    loop {
        while let Ok(ev) = rx.try_recv() {
            on_log(ev);
        }

        if cancel.is_cancelled() {
            emit(&mut on_log, "stderr", "[cancelled]");
            drop(guard);
            let _ = out_handle.join();
            let _ = err_handle.join();
            return Err("sandbox run cancelled".into());
        }

        match guard.child.as_mut().unwrap().try_wait() {
            Ok(Some(status)) => {
                // Drain remaining lines
                drop(guard.take()); // release without kill — already exited
                let _ = out_handle.join();
                let _ = err_handle.join();
                while let Ok(ev) = rx.try_recv() {
                    on_log(ev);
                }
                let code = status.code().unwrap_or(if status.success() { 0 } else { 1 });
                return Ok(code);
            }
            Ok(None) => {
                thread::sleep(std::time::Duration::from_millis(40));
            }
            Err(e) => {
                drop(guard);
                return Err(format!("wait failed: {e}"));
            }
        }
    }
}

/// Validate cwd then spawn. Holds no DB lock during process lifetime.
#[allow(dead_code)] // used by future DAG runner (Phase 5); sandbox uses unchecked path
pub fn run_engine<F>(
    conn: &Connection,
    req: &EngineRunRequest,
    cancel: &CancelToken,
    on_log: F,
) -> Result<i32, String>
where
    F: FnMut(LogEvent),
{
    let cwd = validate_imported_workspace(conn, &req.cwd)?;
    let mut req = req.clone();
    req.cwd = cwd;
    run_engine_unchecked(&req, cancel, on_log)
}

fn emit<F: FnMut(LogEvent)>(on_log: &mut F, stream: &str, line: &str) {
    on_log(LogEvent {
        ts: now_iso8601(),
        stream: stream.to_string(),
        line: line.to_string(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::repo::{upsert_agent, AgentUpsert};
    use std::collections::HashMap;
    use tempfile::TempDir;

    #[test]
    fn rejects_cwd_not_in_agents() {
        let tmp = tempfile::NamedTempFile::new().expect("tmp");
        let conn = Connection::open(tmp.path()).expect("open");
        migrate(&conn).expect("migrate");
        let err = validate_imported_workspace(&conn, "/no/such/agent/ws").unwrap_err();
        assert!(
            err.contains("not an imported") || err.contains("not accessible"),
            "unexpected err: {err}"
        );
    }

    #[test]
    fn accepts_imported_workspace_cwd() {
        let ws = TempDir::new().expect("ws");
        let tmp = tempfile::NamedTempFile::new().expect("db");
        let conn = Connection::open(tmp.path()).expect("open");
        migrate(&conn).expect("migrate");
        let path = ws.path().canonicalize().unwrap().to_string_lossy().to_string();
        upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "probe-ws".into(),
                description: None,
                workspace_path: path.clone(),
                git_url: None,
                default_cli: "codex".into(),
                status: None,
            },
        )
        .expect("agent");
        let ok = validate_imported_workspace(&conn, &path).expect("valid");
        assert_eq!(ok, path);
    }

    #[test]
    #[ignore = "spawns real CLI; run manually with an imported workspace"]
    fn integration_echo_via_true_binary_shape() {
        // Placeholder ignored test — real CLI runs belong in sandbox UI verification.
        let _req = EngineRunRequest {
            engine: "codex".into(),
            cwd: "/tmp".into(),
            prompt: "say hi".into(),
            model: None,
            reasoning: None,
            extra_args: vec![],
            env: HashMap::new(),
        };
    }
}
