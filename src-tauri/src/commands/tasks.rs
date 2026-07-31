//! Task domain IPC — persistence only; CLI execution is Phase 5.
use crate::repo::{
    append_task_log as repo_append_log, create_goal as repo_create_goal,
    create_task_run as repo_create_run, get_task_run as repo_get_run,
    insert_task_nodes as repo_insert_nodes, list_task_logs as repo_list_logs,
    list_task_runs as repo_list_runs, save_plan as repo_save_plan,
    update_node_status as repo_update_node, update_run_progress as repo_update_progress, Goal,
    Plan, TaskLog, TaskLogAppend, TaskNode, TaskNodeInsert, TaskRun, TaskRunWithNodes,
};
use crate::state::DbState;
use tauri::State;

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
