//! Task domain IPC — persistence + dispatch / DAG runner / interventions.
use crate::repo::{
    append_task_log as repo_append_log, create_goal as repo_create_goal,
    create_task_run as repo_create_run, get_task_node, get_task_run as repo_get_run,
    increment_node_retry, insert_task_nodes as repo_insert_nodes, list_task_logs as repo_list_logs,
    list_task_runs as repo_list_runs, save_plan as repo_save_plan,
    update_node_status as repo_update_node, update_run_progress as repo_update_progress, Goal,
    Plan, TaskLog, TaskLogAppend, TaskNode, TaskNodeInsert, TaskRun, TaskRunWithNodes,
};
use crate::services::dag_runner::{
    ensure_run_resumable, run_dag_loop, DEFAULT_CONCURRENCY,
};
use crate::services::dispatch::{dispatch_plan as svc_dispatch, DispatchResult};
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
    with_db(&state, |c| repo_get_run(c, &id))
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
    with_db(&state, |c| svc_dispatch(c, &plan_id))
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

    let db = state.conn_arc();
    let app2 = app.clone();
    let run_id2 = run_id.clone();
    let conc = concurrency.unwrap_or(DEFAULT_CONCURRENCY);
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
pub fn cancel_run(runs: State<'_, RunState>, run_id: String) -> Result<(), String> {
    let map = runs
        .cancels
        .lock()
        .map_err(|e| format!("run state lock poisoned: {e}"))?;
    if let Some(token) = map.get(&run_id) {
        token.cancel();
        Ok(())
    } else {
        Err(format!("no active runner for run: {run_id}"))
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

/// Read a text file under the agent's workspace (path traversal safe).
#[tauri::command]
pub fn read_workspace_file(
    state: State<'_, DbState>,
    agent_id: String,
    relative_path: String,
) -> Result<WorkspaceFileResult, String> {
    let rel = relative_path.trim();
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

    let conn = state
        .conn
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    let agent = crate::repo::get_agent(&conn, &agent_id)?
        .ok_or_else(|| format!("agent not found: {agent_id}"))?;
    let ws = PathBuf::from(&agent.workspace_path)
        .canonicalize()
        .map_err(|e| format!("workspace not accessible: {e}"))?;
    let full = ws.join(rel);
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
