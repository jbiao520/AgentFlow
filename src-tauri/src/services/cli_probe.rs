use crate::repo::cli_status::{
    upsert_cli_engine_status, EngineStatus, ENGINE_NAMES,
};
use rusqlite::Connection;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// Probe cursor-agent / codex / opencode; persist results. Never panics on missing CLIs.
pub fn probe_cli_engines(conn: &Connection) -> Result<Vec<EngineStatus>, String> {
    // Probe in parallel — sequential --version can take up to 9s and feels like a no-op refresh.
    let handles: Vec<_> = ENGINE_NAMES
        .iter()
        .map(|name| {
            let engine = (*name).to_string();
            thread::spawn(move || probe_one(&engine))
        })
        .collect();

    let mut probed = Vec::with_capacity(ENGINE_NAMES.len());
    for handle in handles {
        match handle.join() {
            Ok(status) => probed.push(status),
            Err(_) => {
                return Err("CLI probe thread panicked".into());
            }
        }
    }

    let mut out = Vec::with_capacity(probed.len());
    for status in probed {
        let persisted = upsert_cli_engine_status(
            conn,
            &status.engine,
            status.available,
            status.version.as_deref(),
        )?;
        out.push(persisted);
    }
    Ok(out)
}

fn probe_one(engine: &str) -> EngineStatus {
    match resolve_binary(engine) {
        Some(bin) => {
            // Binary found ⇒ available. Version is best-effort; a flaky --version
            // must not mark an installed CLI as offline (that made refresh look broken).
            let version = run_version(&bin).ok();
            EngineStatus {
                engine: engine.to_string(),
                available: true,
                version,
                last_checked_at: None,
            }
        }
        None => EngineStatus {
            engine: engine.to_string(),
            available: false,
            version: None,
            last_checked_at: None,
        },
    }
}

fn resolve_binary(engine: &str) -> Option<PathBuf> {
    if let Some(p) = which(engine) {
        return Some(p);
    }
    for candidate in common_paths(engine) {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Public for adapters — resolve engine binary path or None.
pub fn resolve_engine_binary(engine: &str) -> Option<PathBuf> {
    resolve_binary(engine)
}

fn which(name: &str) -> Option<PathBuf> {
    let output = Command::new("which")
        .arg(name)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return None;
    }
    let p = PathBuf::from(&path);
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

fn common_paths(engine: &str) -> Vec<PathBuf> {
    let home = directories::UserDirs::new()
        .map(|u| u.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("/"));
    match engine {
        "cursor-agent" => vec![
            home.join(".local/bin/cursor-agent"),
            PathBuf::from("/usr/local/bin/cursor-agent"),
            PathBuf::from("/opt/homebrew/bin/cursor-agent"),
        ],
        "codex" => vec![
            PathBuf::from("/opt/homebrew/bin/codex"),
            PathBuf::from("/usr/local/bin/codex"),
            home.join(".local/bin/codex"),
            home.join(".cargo/bin/codex"),
        ],
        "opencode" => vec![
            home.join(".opencode/bin/opencode"),
            PathBuf::from("/opt/homebrew/bin/opencode"),
            PathBuf::from("/usr/local/bin/opencode"),
            home.join(".local/bin/opencode"),
        ],
        _ => vec![],
    }
}

fn run_version(bin: &Path) -> Result<String, String> {
    let mut child = Command::new(bin)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn {}: {e}", bin.display()))?;

    let mut stdout = child.stdout.take().ok_or("missing stdout")?;
    let mut stderr = child.stderr.take().ok_or("missing stderr")?;

    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        let mut err = String::new();
        let _ = stdout.read_to_string(&mut out);
        let _ = stderr.read_to_string(&mut err);
        (out, err)
    });

    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let (out, err) = reader.join().unwrap_or_default();
                if !status.success() && out.trim().is_empty() && err.trim().is_empty() {
                    return Err(format!("--version exited {}", status));
                }
                let text = if !out.trim().is_empty() { out } else { err };
                return Ok(normalize_version(&text));
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    return Err("version probe timed out".into());
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(e) => {
                let _ = child.kill();
                return Err(format!("try_wait: {e}"));
            }
        }
    }
}

fn normalize_version(raw: &str) -> String {
    let line = raw.lines().next().unwrap_or(raw).trim();
    // Keep a short display form (first line, capped).
    if line.chars().count() > 64 {
        line.chars().take(64).collect()
    } else {
        line.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use tempfile::NamedTempFile;

    #[test]
    fn probe_returns_three_entries() {
        let tmp = NamedTempFile::new().expect("tempfile");
        let conn = Connection::open(tmp.path()).expect("open");
        migrate(&conn).expect("migrate");

        let statuses = probe_cli_engines(&conn).expect("probe");
        assert_eq!(statuses.len(), 3);
        let names: Vec<_> = statuses.iter().map(|s| s.engine.as_str()).collect();
        assert_eq!(names, vec!["cursor-agent", "codex", "opencode"]);
        for s in &statuses {
            assert!(s.last_checked_at.is_some());
        }
    }
}
