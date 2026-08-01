//! Schedule IPC — CRUD + enable + run-now.
use crate::repo::{
    create_schedule as repo_create, delete_schedule as repo_delete, get_schedule,
    list_schedules as repo_list, set_schedule_enabled, update_schedule as repo_update,
    Schedule, ScheduleCreate, ScheduleUpdate,
};
use crate::services::scheduler::run_schedule_now;
use crate::state::{DbState, RunState};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

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
pub fn list_schedules(state: State<'_, DbState>) -> Result<Vec<Schedule>, String> {
    with_db(&state, repo_list)
}

#[tauri::command(rename = "get_schedule")]
pub fn get_schedule_cmd(
    state: State<'_, DbState>,
    id: String,
) -> Result<Option<Schedule>, String> {
    with_db(&state, |c| get_schedule(c, &id))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateScheduleArgs {
    pub name: String,
    pub template_id: String,
    #[serde(default)]
    pub values_json: Option<String>,
    pub mode: String,
    #[serde(default)]
    pub interval_secs: Option<i64>,
    pub next_run_at: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub cron_expr: Option<String>,
    #[serde(default)]
    pub window_start: Option<String>,
    #[serde(default)]
    pub window_end: Option<String>,
    #[serde(default = "default_overlap")]
    pub overlap_policy: String,
    #[serde(default)]
    pub max_retries: i64,
    #[serde(default = "default_retry_delay")]
    pub retry_delay_secs: i64,
}

fn default_true() -> bool {
    true
}

fn default_overlap() -> String {
    "queue".into()
}

fn default_retry_delay() -> i64 {
    300
}

#[tauri::command(rename = "create_schedule")]
pub fn create_schedule_cmd(
    state: State<'_, DbState>,
    args: CreateScheduleArgs,
) -> Result<Schedule, String> {
    with_db(&state, |c| {
        repo_create(
            c,
            ScheduleCreate {
                name: args.name,
                template_id: args.template_id,
                values_json: args.values_json.unwrap_or_else(|| "{}".into()),
                mode: args.mode,
                interval_secs: args.interval_secs,
                next_run_at: args.next_run_at,
                enabled: args.enabled,
                cron_expr: args.cron_expr,
                window_start: args.window_start,
                window_end: args.window_end,
                overlap_policy: args.overlap_policy,
                max_retries: args.max_retries,
                retry_delay_secs: args.retry_delay_secs,
            },
        )
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateScheduleArgs {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub template_id: Option<String>,
    #[serde(default)]
    pub values_json: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub interval_secs: Option<i64>,
    #[serde(default)]
    pub clear_interval: bool,
    #[serde(default)]
    pub next_run_at: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub cron_expr: Option<String>,
    #[serde(default)]
    pub clear_cron_expr: bool,
    #[serde(default)]
    pub window_start: Option<String>,
    #[serde(default)]
    pub clear_window_start: bool,
    #[serde(default)]
    pub window_end: Option<String>,
    #[serde(default)]
    pub clear_window_end: bool,
    #[serde(default)]
    pub overlap_policy: Option<String>,
    #[serde(default)]
    pub max_retries: Option<i64>,
    #[serde(default)]
    pub retry_delay_secs: Option<i64>,
}

#[tauri::command(rename = "update_schedule")]
pub fn update_schedule_cmd(
    state: State<'_, DbState>,
    args: UpdateScheduleArgs,
) -> Result<Schedule, String> {
    let interval_secs = if args.clear_interval {
        Some(None)
    } else if args.interval_secs.is_some() {
        Some(args.interval_secs)
    } else {
        None
    };
    let cron_expr = if args.clear_cron_expr {
        Some(None)
    } else if args.cron_expr.is_some() {
        Some(args.cron_expr)
    } else {
        None
    };
    let window_start = if args.clear_window_start {
        Some(None)
    } else if args.window_start.is_some() {
        Some(args.window_start)
    } else {
        None
    };
    let window_end = if args.clear_window_end {
        Some(None)
    } else if args.window_end.is_some() {
        Some(args.window_end)
    } else {
        None
    };
    with_db(&state, |c| {
        repo_update(
            c,
            &args.id,
            ScheduleUpdate {
                name: args.name,
                template_id: args.template_id,
                values_json: args.values_json,
                mode: args.mode,
                interval_secs,
                next_run_at: args.next_run_at,
                enabled: args.enabled,
                cron_expr,
                window_start,
                window_end,
                overlap_policy: args.overlap_policy,
                max_retries: args.max_retries,
                retry_delay_secs: args.retry_delay_secs,
            },
        )
    })
}

#[tauri::command(rename = "delete_schedule")]
pub fn delete_schedule_cmd(state: State<'_, DbState>, id: String) -> Result<(), String> {
    with_db(&state, |c| repo_delete(c, &id))
}

#[tauri::command(rename = "set_schedule_enabled")]
pub fn set_schedule_enabled_cmd(
    state: State<'_, DbState>,
    id: String,
    enabled: bool,
) -> Result<Schedule, String> {
    with_db(&state, |c| set_schedule_enabled(c, &id, enabled))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunScheduleNowResult {
    pub run_id: String,
}

#[tauri::command(rename = "run_schedule_now")]
pub fn run_schedule_now_cmd(
    app: AppHandle,
    state: State<'_, DbState>,
    runs: State<'_, RunState>,
    id: String,
) -> Result<RunScheduleNowResult, String> {
    let schedule = with_db(&state, |c| {
        get_schedule(c, &id)?.ok_or_else(|| format!("schedule not found: {id}"))
    })?;
    let run_id = run_schedule_now(&app, &state.conn_arc(), &runs.cancels_arc(), &schedule)?;
    Ok(RunScheduleNowResult { run_id })
}
