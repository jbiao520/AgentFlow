//! Background ticker: fire due schedules by instantiating their templates.
use crate::db::now_iso8601;
use crate::engines::runner::CancelToken;
use crate::repo::{
    has_active_schedule_run, list_due_schedules, mark_schedule_fired, mark_schedule_manual_run,
    mark_schedule_skipped, next_window_open_at, outside_run_window, Schedule,
};
use crate::services::notify::notify_schedule_failed;
use crate::services::template_run::instantiate_template_run;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

const TICK_SECS: u64 = 15;

/// Start a daemon thread that polls due schedules.
pub fn start_scheduler(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    cancels: Arc<Mutex<HashMap<String, CancelToken>>>,
) {
    thread::spawn(move || {
        eprintln!(
            "[AgentFlow] schedule ticker started (every {TICK_SECS}s) at {}",
            now_iso8601()
        );
        loop {
            if let Err(e) = tick_once(&app, &db, &cancels) {
                eprintln!("[AgentFlow] schedule tick error: {e}");
            }
            thread::sleep(Duration::from_secs(TICK_SECS));
        }
    });
}

fn tick_once(
    app: &AppHandle,
    db: &Arc<Mutex<Connection>>,
    cancels: &Arc<Mutex<HashMap<String, CancelToken>>>,
) -> Result<(), String> {
    let due = {
        let conn = db
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        list_due_schedules(&conn)?
    };
    for schedule in due {
        if outside_run_window(&schedule, crate::db::now_unix()) {
            if let Some(next) = next_window_open_at(&schedule, crate::db::now_unix()) {
                if let Ok(conn) = db.lock() {
                    let _ = conn.execute(
                        "UPDATE schedules SET next_run_at=?1, updated_at=?2 WHERE id=?3",
                        rusqlite::params![
                            crate::db::format_unix_as_iso8601(next),
                            crate::db::now_iso8601(),
                            schedule.id,
                        ],
                    );
                }
            }
            continue;
        }

        let active = db
            .lock()
            .ok()
            .and_then(|conn| has_active_schedule_run(&conn, &schedule.id).ok())
            .unwrap_or(false);
        if active && schedule.overlap_policy != "allow" {
            if schedule.overlap_policy == "skip" {
                if let Ok(conn) = db.lock() {
                    let _ = mark_schedule_skipped(
                        &conn,
                        &schedule.id,
                        "skipped because the previous run is still active",
                    );
                }
            }
            // queue: leave next_run_at due; the ticker will fire it after the
            // active run reaches a terminal state.
            continue;
        }
        fire_one(app, db, cancels, &schedule);
    }
    Ok(())
}

fn fire_one(
    app: &AppHandle,
    db: &Arc<Mutex<Connection>>,
    cancels: &Arc<Mutex<HashMap<String, CancelToken>>>,
    schedule: &Schedule,
) {
    let values: HashMap<String, String> = serde_json::from_str(&schedule.values_json)
        .unwrap_or_default();

    let result = instantiate_template_run(
        app,
        db,
        cancels,
        &schedule.template_id,
        &values,
        true,
        Some(&schedule.id),
        false,
    );

    let (run_id, err) = match result {
        Ok(r) if r.ok => {
            let rid = r
                .started
                .as_ref()
                .map(|s| s.run_id.clone())
                .or_else(|| r.dispatch.as_ref().map(|d| d.run.id.clone()));
            eprintln!(
                "[AgentFlow] schedule '{}' fired → run {:?}",
                schedule.name, rid
            );
            (rid, None)
        }
        Ok(r) => {
            let e = r.error.unwrap_or_else(|| "instantiate failed".into());
            eprintln!(
                "[AgentFlow] schedule '{}' failed: {e}",
                schedule.name
            );
            notify_schedule_failed(app, &schedule.id, &schedule.name, &e);
            (None, Some(e))
        }
        Err(e) => {
            eprintln!(
                "[AgentFlow] schedule '{}' error: {e}",
                schedule.name
            );
            notify_schedule_failed(app, &schedule.id, &schedule.name, &e);
            (None, Some(e))
        }
    };

    if let Ok(conn) = db.lock() {
        let _ = mark_schedule_fired(
            &conn,
            &schedule.id,
            run_id.as_deref(),
            err.as_deref(),
        );
    }
}

/// Manually trigger a schedule now (does not wait for next_run_at).
pub fn run_schedule_now(
    app: &AppHandle,
    db: &Arc<Mutex<Connection>>,
    cancels: &Arc<Mutex<HashMap<String, CancelToken>>>,
    schedule: &Schedule,
) -> Result<String, String> {
    if schedule.overlap_policy != "allow" {
        let active = {
            let conn = db
                .lock()
                .map_err(|e| format!("db lock poisoned: {e}"))?;
            has_active_schedule_run(&conn, &schedule.id)?
        };
        if active {
            return Err("该定时任务已有运行中的实例，当前重叠策略不允许立即执行".into());
        }
    }
    let values: HashMap<String, String> = serde_json::from_str(&schedule.values_json)
        .map_err(|e| format!("values_json: {e}"))?;

    let result = instantiate_template_run(
        app,
        db,
        cancels,
        &schedule.template_id,
        &values,
        true,
        Some(&schedule.id),
        true,
    )?;

    if !result.ok {
        let e = result.error.unwrap_or_else(|| "instantiate failed".into());
        let _ = {
            let conn = db
                .lock()
                .map_err(|err| format!("db lock poisoned: {err}"))?;
            mark_schedule_manual_run(&conn, &schedule.id, None, Some(&e))
        };
        notify_schedule_failed(app, &schedule.id, &schedule.name, &e);
        return Err(e);
    }

    let run_id = result
        .started
        .as_ref()
        .map(|s| s.run_id.clone())
        .or_else(|| result.dispatch.as_ref().map(|d| d.run.id.clone()))
        .ok_or_else(|| "run started but run_id missing".to_string())?;

    {
        let conn = db
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        mark_schedule_manual_run(&conn, &schedule.id, Some(&run_id), None)?;
    }

    Ok(run_id)
}
