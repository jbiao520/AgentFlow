//! Task domain IPC — persistence + dispatch / DAG runner / interventions.
use crate::repo::{
    append_task_log as repo_append_log, clear_task_runs as repo_clear_runs,
    create_goal as repo_create_goal, create_task_run as repo_create_run,
    delete_task_run as repo_delete_run, get_task_node, get_task_run as repo_get_run,
    increment_node_retry, insert_task_nodes as repo_insert_nodes, list_task_logs as repo_list_logs,
    list_task_runs as repo_list_runs, save_plan as repo_save_plan,
    update_node_status as repo_update_node, update_run_progress as repo_update_progress, Goal,
    Plan, TaskLog, TaskLogAppend, TaskNode, TaskNodeInsert, TaskRun, TaskRunWithNodes,
};
use crate::services::dag_runner::{
    ensure_run_resumable, resolve_concurrency, run_dag_loop,
};
use crate::services::dispatch::{dispatch_plan as svc_dispatch, DispatchResult};
use crate::services::orchestrate::parse_plan_json;
use crate::engines::runner::CancelToken;
use crate::state::{DbState, RunState};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, State};

fn with_db<T, F>(state: &State<'_, DbState>, f: F) -> Result<T, String>
where
    F: FnOnce(&rusqlite::Connection) -> Result<T, String>,
{
    let conn = state
        .conn
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    f(&conn)
}

fn plan_concurrency_for_run(
    conn: &rusqlite::Connection,
    run_id: &str,
) -> Result<Option<usize>, String> {
    let full = repo_get_run(conn, run_id)?.ok_or_else(|| format!("run not found: {run_id}"))?;
    let plan = crate::repo::get_plan(conn, &full.run.plan_id)?
        .ok_or_else(|| format!("plan not found: {}", full.run.plan_id))?;
    let analysis = parse_plan_json(&plan.analysis_json).ok();
    Ok(analysis.and_then(|a| a.concurrency))
}

#[tauri::command]
pub fn create_goal(
    state: State<'_, DbState>,
    prompt: String,
    template_key: Option<String>,
) -> Result<Goal, String> {
    with_db(&state, |c| {
        repo_create_goal(c, &prompt, template_key.as_deref())
    })
}

#[tauri::command]
pub fn save_plan(
    state: State<'_, DbState>,
    goal_id: String,
    analysis_json: String,
) -> Result<Plan, String> {
    with_db(&state, |c| repo_save_plan(c, &goal_id, &analysis_json))
}

#[tauri::command]
pub fn create_task_run(
    state: State<'_, DbState>,
    goal_id: String,
    plan_id: String,
) -> Result<TaskRun, String> {
    with_db(&state, |c| repo_create_run(c, &goal_id, &plan_id))
}

#[tauri::command]
pub fn insert_task_nodes(
    state: State<'_, DbState>,
    run_id: String,
    nodes: Vec<TaskNodeInsert>,
) -> Result<Vec<TaskNode>, String> {
    with_db(&state, |c| repo_insert_nodes(c, &run_id, &nodes))
}

#[tauri::command]
pub fn list_task_runs(state: State<'_, DbState>, limit: Option<i64>) -> Result<Vec<TaskRun>, String> {
    with_db(&state, |c| repo_list_runs(c, limit.unwrap_or(50)))
}

#[tauri::command]
pub fn get_task_run(
    state: State<'_, DbState>,
    id: String,
) -> Result<Option<TaskRunWithNodes>, String> {
    with_db(&state, |c| {
        let full = repo_get_run(c, &id)?;
        let Some(full) = full else {
            return Ok(None);
        };
        // Rebuild polluted or missing acceptance reports for finished runs so
        // older history picks up marker-parsing fixes without a re-run.
        let terminal = matches!(
            full.run.status.as_str(),
            "success" | "failed" | "cancelled"
        );
        if terminal
            && crate::services::delivery::delivery_report_needs_rebuild(
                full.run.delivery_report_json.as_deref(),
            )
        {
            match crate::services::delivery::finalize_delivery_report(c, &id) {
                Ok(_) => repo_get_run(c, &id),
                Err(_) => Ok(Some(full)),
            }
        } else {
            Ok(Some(full))
        }
    })
}

#[tauri::command]
pub fn delete_task_run(
    state: State<'_, DbState>,
    runs: State<'_, RunState>,
    run_id: String,
) -> Result<(), String> {
    {
        let mut map = runs
            .cancels
            .lock()
            .map_err(|e| format!("run state lock poisoned: {e}"))?;
        if let Some(token) = map.remove(&run_id) {
            token.cancel();
        }
    }
    with_db(&state, |c| {
        if !repo_delete_run(c, &run_id)? {
            return Err(format!("run not found: {run_id}"));
        }
        Ok(())
    })
}

#[tauri::command]
pub fn clear_task_runs(
    state: State<'_, DbState>,
    runs: State<'_, RunState>,
) -> Result<u64, String> {
    {
        let mut map = runs
            .cancels
            .lock()
            .map_err(|e| format!("run state lock poisoned: {e}"))?;
        for (_, token) in map.drain() {
            token.cancel();
        }
    }
    with_db(&state, |c| repo_clear_runs(c))
}

#[tauri::command]
pub fn update_node_status(
    state: State<'_, DbState>,
    node_id: String,
    status: String,
) -> Result<TaskNode, String> {
    with_db(&state, |c| repo_update_node(c, &node_id, &status))
}

#[tauri::command]
pub fn append_task_log(
    state: State<'_, DbState>,
    entry: TaskLogAppend,
) -> Result<TaskLog, String> {
    with_db(&state, |c| repo_append_log(c, entry))
}

#[tauri::command]
pub fn list_task_logs(
    state: State<'_, DbState>,
    run_id: String,
    agent_filter: Option<String>,
) -> Result<Vec<TaskLog>, String> {
    with_db(&state, |c| {
        repo_list_logs(c, &run_id, agent_filter.as_deref())
    })
}

#[tauri::command]
pub fn update_run_progress(
    state: State<'_, DbState>,
    run_id: String,
    progress: f64,
    status: Option<String>,
) -> Result<TaskRun, String> {
    with_db(&state, |c| {
        repo_update_progress(c, &run_id, progress, status.as_deref())
    })
}

#[tauri::command]
pub fn dispatch_plan(
    state: State<'_, DbState>,
    plan_id: String,
) -> Result<DispatchResult, String> {
    svc_dispatch(&state.conn, &plan_id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartRunResult {
    pub run_id: String,
    pub started: bool,
}

#[tauri::command]
pub fn start_run(
    app: AppHandle,
    state: State<'_, DbState>,
    runs: State<'_, RunState>,
    run_id: String,
    concurrency: Option<usize>,
) -> Result<StartRunResult, String> {
    {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        let _ = repo_get_run(&conn, &run_id)?
            .ok_or_else(|| format!("run not found: {run_id}"))?;
    }

    let cancel = CancelToken::new();
    let cancels = runs.cancels_arc();
    {
        let mut map = cancels
            .lock()
            .map_err(|e| format!("run state lock poisoned: {e}"))?;
        if let Some(prev) = map.insert(run_id.clone(), cancel.clone()) {
            prev.cancel();
        }
    }

    let conc = {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        let plan_conc = plan_concurrency_for_run(&conn, &run_id)?;
        resolve_concurrency(concurrency, plan_conc)
    };

    let db = state.conn_arc();
    let app2 = app.clone();
    let run_id2 = run_id.clone();
    let cancels2 = Arc::clone(&cancels);

    thread::spawn(move || {
        let _ = run_dag_loop(db, app2, run_id2.clone(), cancel, conc);
        if let Ok(mut map) = cancels2.lock() {
            map.remove(&run_id2);
        }
    });

    Ok(StartRunResult {
        run_id,
        started: true,
    })
}

#[tauri::command]
pub fn cancel_run(
    state: State<'_, DbState>,
    runs: State<'_, RunState>,
    run_id: String,
) -> Result<(), String> {
    let had_runner = {
        let map = runs
            .cancels
            .lock()
            .map_err(|e| format!("run state lock poisoned: {e}"))?;
        if let Some(token) = map.get(&run_id) {
            token.cancel();
            true
        } else {
            false
        }
    };

    if had_runner {
        // DAG loop will settle nodes and mark cancelled.
        Ok(())
    } else {
        // No in-memory runner (orphaned / already finished) — settle DB directly.
        with_db(&state, |c| {
            let full = repo_get_run(c, &run_id)?.ok_or_else(|| format!("run not found: {run_id}"))?;
            if matches!(
                full.run.status.as_str(),
                "success" | "failed" | "cancelled"
            ) {
                return Err(format!("run already finished: {}", full.run.status));
            }
            crate::services::recovery::finalize_interrupted_run(
                c,
                &run_id,
                "run cancelled by user (no active runner)",
            )
        })
    }
}

#[tauri::command]
pub fn retry_node(
    app: AppHandle,
    state: State<'_, DbState>,
    runs: State<'_, RunState>,
    run_id: String,
    node_id: String,
) -> Result<TaskNode, String> {
    let node = {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        let node = get_task_node(&conn, &node_id)?
            .ok_or_else(|| format!("node not found: {node_id}"))?;
        if node.run_id != run_id {
            return Err("node does not belong to run".into());
        }
        if node.status != "failed" {
            return Err(format!(
                "retry only allowed for failed nodes (got {})",
                node.status
            ));
        }
        let node = increment_node_retry(&conn, &node_id)?;
        ensure_run_resumable(&conn, &run_id)?;
        node
    };

    let should_start = {
        let map = runs
            .cancels
            .lock()
            .map_err(|e| format!("run state lock poisoned: {e}"))?;
        !map.contains_key(&run_id)
    };
    if should_start {
        let _ = start_run(app, state, runs, run_id, None)?;
    }

    Ok(node)
}

/// Retry every failed node in a run. This is the action exposed by failure notifications.
#[tauri::command]
pub fn retry_run(
    app: AppHandle,
    state: State<'_, DbState>,
    runs: State<'_, RunState>,
    run_id: String,
) -> Result<StartRunResult, String> {
    {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        let full = repo_get_run(&conn, &run_id)?
            .ok_or_else(|| format!("run not found: {run_id}"))?;
        let failed: Vec<String> = full
            .nodes
            .iter()
            .filter(|node| node.status == "failed")
            .map(|node| node.id.clone())
            .collect();
        if failed.is_empty() {
            return Err("run has no failed nodes to retry".into());
        }
        for node_id in failed {
            increment_node_retry(&conn, &node_id)?;
        }
        ensure_run_resumable(&conn, &run_id)?;
    }

    let active = {
        let map = runs
            .cancels
            .lock()
            .map_err(|e| format!("run state lock poisoned: {e}"))?;
        map.contains_key(&run_id)
    };
    if active {
        return Err("run is already active".into());
    }
    start_run(app, state, runs, run_id, None)
}

#[tauri::command]
pub fn skip_node(
    app: AppHandle,
    state: State<'_, DbState>,
    runs: State<'_, RunState>,
    run_id: String,
    node_id: String,
) -> Result<TaskNode, String> {
    let node = {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        let node = get_task_node(&conn, &node_id)?
            .ok_or_else(|| format!("node not found: {node_id}"))?;
        if node.run_id != run_id {
            return Err("node does not belong to run".into());
        }
        if matches!(node.status.as_str(), "success" | "skipped") {
            return Err(format!("cannot skip node in status {}", node.status));
        }
        if node.status == "running" {
            return Err(
                "cannot skip a running node — cancel the run first, or wait for it to finish"
                    .into(),
            );
        }
        let node = repo_update_node(&conn, &node_id, "skipped")?;
        ensure_run_resumable(&conn, &run_id)?;
        if let Ok(Some(full)) = repo_get_run(&conn, &run_id) {
            let _ = app.emit(
                "task-run-updated",
                crate::services::dag_runner::TaskRunUpdatedEvent {
                    run: full.run,
                    nodes: full.nodes,
                },
            );
        }
        node
    };

    let should_start = {
        let map = runs
            .cancels
            .lock()
            .map_err(|e| format!("run state lock poisoned: {e}"))?;
        !map.contains_key(&run_id)
    };
    if should_start {
        let _ = start_run(app, state, runs, run_id, None)?;
    }

    Ok(node)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceFileResult {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevealArtifactResult {
    /// Absolute path that was revealed in Finder.
    pub revealed_path: String,
    /// True when the requested relative file existed.
    pub existed: bool,
    /// True when a parent/workspace fallback was revealed instead of the file.
    pub fallback: bool,
}

fn validate_relative_path(rel: &str) -> Result<&Path, String> {
    let rel = rel.trim();
    if rel.is_empty() {
        return Err("relative_path must not be empty".into());
    }
    let path = Path::new(rel);
    if path.is_absolute() {
        return Err("absolute paths not allowed".into());
    }
    for c in path.components() {
        if matches!(c, Component::ParentDir) {
            return Err("path must not contain ..".into());
        }
    }
    Ok(path)
}

fn agent_workspace(state: &State<'_, DbState>, agent_id: &str) -> Result<PathBuf, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    let agent = crate::repo::get_agent(&conn, agent_id)?
        .ok_or_else(|| format!("agent not found: {agent_id}（可能已被删除，无法读取产物）"))?;
    PathBuf::from(&agent.workspace_path)
        .canonicalize()
        .map_err(|e| format!("workspace not accessible: {e}"))
}

/// Pick a Finder reveal target: the file if present, else nearest existing parent under workspace.
pub fn resolve_reveal_target(ws: &Path, relative: &Path) -> (PathBuf, bool, bool) {
    let candidate = ws.join(relative);
    if candidate.exists() {
        if let Ok(canon) = candidate.canonicalize() {
            if canon.starts_with(ws) {
                return (canon, true, false);
            }
        }
    }

    let mut cur = candidate.parent().map(|p| p.to_path_buf());
    while let Some(p) = cur {
        if p.starts_with(ws) {
            if p.exists() {
                if let Ok(canon) = p.canonicalize() {
                    if canon.starts_with(ws) {
                        return (canon, false, true);
                    }
                }
                return (p, false, true);
            }
            if p == *ws {
                break;
            }
        } else {
            break;
        }
        cur = p.parent().map(|p| p.to_path_buf());
    }
    (ws.to_path_buf(), false, true)
}

fn reveal_path_macos(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.display()));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path.to_string_lossy()])
            .status()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("reveal_in_finder is only supported on macOS in v1".to_string())
    }
}

/// Read a text file under the agent's workspace (path traversal safe).
#[tauri::command]
pub fn read_workspace_file(
    state: State<'_, DbState>,
    agent_id: String,
    relative_path: String,
) -> Result<WorkspaceFileResult, String> {
    let rel_path = validate_relative_path(&relative_path)?;
    let rel = relative_path.trim();
    let ws = agent_workspace(&state, &agent_id)?;
    let full = ws.join(rel_path);
    let canon = full
        .canonicalize()
        .map_err(|e| format!("file not found: {e}"))?;
    if !canon.starts_with(&ws) {
        return Err("path escapes agent workspace".into());
    }
    let content = std::fs::read_to_string(&canon).map_err(|e| format!("read failed: {e}"))?;
    // Cap preview size
    let content = if content.len() > 200_000 {
        format!(
            "{}…\n\n[truncated — {} bytes total]",
            &content[..200_000],
            content.len()
        )
    } else {
        content
    };
    Ok(WorkspaceFileResult {
        path: rel.to_string(),
        content,
    })
}

/// Reveal an artifact path in Finder. Falls back to parent/workspace if the file is missing.
#[tauri::command]
pub fn reveal_workspace_artifact(
    state: State<'_, DbState>,
    agent_id: String,
    relative_path: String,
) -> Result<RevealArtifactResult, String> {
    let rel_path = validate_relative_path(&relative_path)?;
    let ws = agent_workspace(&state, &agent_id)?;
    let (target, existed, fallback) = resolve_reveal_target(&ws, rel_path);
    reveal_path_macos(&target)?;
    Ok(RevealArtifactResult {
        revealed_path: target.to_string_lossy().to_string(),
        existed,
        fallback,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reveal_target_prefers_existing_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        let ws = tmp.path().canonicalize().unwrap();
        let arts = ws.join("artifacts");
        fs::create_dir_all(&arts).unwrap();
        let file = arts.join("out.md");
        fs::write(&file, "hi").unwrap();

        let (target, existed, fallback) =
            resolve_reveal_target(&ws, Path::new("artifacts/out.md"));
        assert!(existed);
        assert!(!fallback);
        assert_eq!(target, file.canonicalize().unwrap());
    }

    #[test]
    fn reveal_target_falls_back_to_parent_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        let ws = tmp.path().canonicalize().unwrap();
        let arts = ws.join("artifacts");
        fs::create_dir_all(&arts).unwrap();

        let (target, existed, fallback) =
            resolve_reveal_target(&ws, Path::new("artifacts/missing.md"));
        assert!(!existed);
        assert!(fallback);
        assert_eq!(target, arts.canonicalize().unwrap());
    }

    #[test]
    fn reveal_target_falls_back_to_workspace() {
        let tmp = tempfile::TempDir::new().unwrap();
        let ws = tmp.path().canonicalize().unwrap();

        let (target, existed, fallback) =
            resolve_reveal_target(&ws, Path::new("artifacts/missing.md"));
        assert!(!existed);
        assert!(fallback);
        assert_eq!(target, ws);
    }
}
