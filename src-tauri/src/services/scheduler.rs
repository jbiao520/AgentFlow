//! Background ticker: fire due schedules by instantiating their templates.
use crate::db::now_iso8601;
use crate::engines::runner::CancelToken;
use crate::repo::{list_due_schedules, mark_schedule_fired, mark_schedule_manual_run, Schedule};
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
            "[AgentMind] schedule ticker started (every {TICK_SECS}s) at {}",
            now_iso8601()
        );
        loop {
            if let Err(e) = tick_once(&app, &db, &cancels) {
                eprintln!("[AgentMind] schedule tick error: {e}");
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
    );

    let (run_id, err) = match result {
        Ok(r) if r.ok => {
            let rid = r
                .started
                .as_ref()
                .map(|s| s.run_id.clone())
                .or_else(|| r.dispatch.as_ref().map(|d| d.run.id.clone()));
            eprintln!(
                "[AgentMind] schedule '{}' fired → run {:?}",
                schedule.name, rid
            );
            (rid, None)
        }
        Ok(r) => {
            let e = r.error.unwrap_or_else(|| "instantiate failed".into());
            eprintln!(
                "[AgentMind] schedule '{}' failed: {e}",
                schedule.name
            );
            (None, Some(e))
        }
        Err(e) => {
            eprintln!(
                "[AgentMind] schedule '{}' error: {e}",
                schedule.name
            );
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
    let values: HashMap<String, String> = serde_json::from_str(&schedule.values_json)
        .map_err(|e| format!("values_json: {e}"))?;

    let result = instantiate_template_run(
        app,
        db,
        cancels,
        &schedule.template_id,
        &values,
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
