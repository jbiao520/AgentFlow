//! System notifications (macOS banners via the notification plugin).
//! Sends run-ended / schedule-failure alerts so automated execution
//! results are visible even when the user is not watching the app.
use crate::repo::{get_goal, TaskRun};
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

/// Ask macOS for notification permission (shows the system prompt once).
pub fn request_notification_permission(app: &AppHandle) {
    match app.notification().request_permission() {
        Ok(state) => eprintln!("[AgentFlow] notification permission: {state:?}"),
        Err(e) => eprintln!("[AgentFlow] notification permission request failed: {e}"),
    }
}

/// Fire a system notification. Best-effort: errors are logged, never fatal.
pub fn notify(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("[AgentFlow] notification failed: {e}");
    }
}

const MAX_TITLE_CHARS: usize = 60;

#[derive(Debug, Clone, Serialize)]
pub struct TaskNotificationEvent {
    pub kind: String,
    pub title: String,
    pub message: String,
    pub run_id: Option<String>,
    pub schedule_id: Option<String>,
    pub can_retry: bool,
}

fn emit_actionable_event(app: &AppHandle, event: TaskNotificationEvent) {
    if let Err(e) = app.emit("task-notification", event) {
        eprintln!("[AgentFlow] notification event failed: {e}");
    }
}

/// Notify the user that a DAG run reached a terminal state (success/failed/cancelled).
pub fn notify_run_ended(app: &AppHandle, conn: &Connection, run: &TaskRun) {
    let prompt = get_goal(conn, &run.goal_id)
        .ok()
        .flatten()
        .map(|g| g.prompt)
        .unwrap_or_default();
    let title: String = if prompt.trim().is_empty() {
        "AgentFlow 任务".to_string()
    } else {
        prompt.trim().chars().take(MAX_TITLE_CHARS).collect()
    };
    let pct = (run.progress * 100.0).round() as i64;
    let body = match run.status.as_str() {
        "success" => format!("执行成功 · 进度 {pct}%"),
        "failed" => "执行失败 · 可打开任务中心查看结果或重试".to_string(),
        "cancelled" => format!("已取消 · 进度 {pct}%"),
        _ => return,
    };
    notify(app, &title, &body);
    if run.status == "failed" {
        emit_actionable_event(
            app,
            TaskNotificationEvent {
                kind: "run_failed".into(),
                title,
                message: run
                    .error
                    .clone()
                    .unwrap_or_else(|| "执行失败".into()),
                run_id: Some(run.id.clone()),
                schedule_id: run.schedule_id.clone(),
                can_retry: true,
            },
        );
    }
}

/// Notify the user that a scheduled task could not be started.
pub fn notify_schedule_failed(
    app: &AppHandle,
    schedule_id: &str,
    schedule_name: &str,
    error: &str,
) {
    let body: String = error.trim().chars().take(120).collect();
    let title = format!("定时任务「{schedule_name}」启动失败");
    notify(app, &title, &format!("{body} · 可查看任务或重试"));
    emit_actionable_event(
        app,
        TaskNotificationEvent {
            kind: "schedule_failed".into(),
            title,
            message: body,
            run_id: None,
            schedule_id: Some(schedule_id.to_string()),
            can_retry: true,
        },
    );
}
