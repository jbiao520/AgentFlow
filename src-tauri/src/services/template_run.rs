//! Instantiate a template and optionally dispatch + start a DAG run.
//! Shared by IPC command and the background schedule ticker.
use crate::engines::runner::CancelToken;
use crate::repo::{create_goal, get_template, save_plan};
use crate::services::dispatch::{dispatch_plan, DispatchResult};
use crate::services::orchestrate::{
    parse_plan_json, plan_to_analysis_json, validate_plan, PlanAnalysis,
};
use crate::services::template_vars::{instantiate_texts, parse_variables_json, resolve_values};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::AppHandle;

use crate::services::dag_runner::{run_dag_loop, DEFAULT_CONCURRENCY};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartRunResult {
    pub run_id: String,
    pub started: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstantiateRunResult {
    pub ok: bool,
    pub goal_id: Option<String>,
    pub plan_id: Option<String>,
    pub plan: Option<PlanAnalysis>,
    pub dispatch: Option<DispatchResult>,
    pub started: Option<StartRunResult>,
    pub error: Option<String>,
    pub warnings: Vec<String>,
}

fn fail(err: impl Into<String>) -> InstantiateRunResult {
    InstantiateRunResult {
        ok: false,
        goal_id: None,
        plan_id: None,
        plan: None,
        dispatch: None,
        started: None,
        error: Some(err.into()),
        warnings: vec![],
    }
}

/// Spawn DAG runner thread for an existing run_id.
pub fn spawn_dag_run(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    cancels: Arc<Mutex<HashMap<String, CancelToken>>>,
    run_id: String,
    concurrency: Option<usize>,
) -> Result<StartRunResult, String> {
    {
        let conn = db
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        let _ = crate::repo::get_task_run(&conn, &run_id)?
            .ok_or_else(|| format!("run not found: {run_id}"))?;
    }

    let cancel = CancelToken::new();
    {
        let mut map = cancels
            .lock()
            .map_err(|e| format!("run state lock poisoned: {e}"))?;
        if let Some(prev) = map.insert(run_id.clone(), cancel.clone()) {
            prev.cancel();
        }
    }

    let db2 = Arc::clone(&db);
    let app2 = app.clone();
    let run_id2 = run_id.clone();
    let conc = concurrency.unwrap_or(DEFAULT_CONCURRENCY);
    let cancels2 = Arc::clone(&cancels);

    thread::spawn(move || {
        let _ = run_dag_loop(db2, app2, run_id2.clone(), cancel, conc);
        if let Ok(mut map) = cancels2.lock() {
            map.remove(&run_id2);
        }
    });

    Ok(StartRunResult {
        run_id,
        started: true,
    })
}

/// Resolve template variables → persist goal/plan → optional dispatch+start.
pub fn instantiate_template_run(
    app: &AppHandle,
    db: &Arc<Mutex<Connection>>,
    cancels: &Arc<Mutex<HashMap<String, CancelToken>>>,
    template_id: &str,
    values: &HashMap<String, String>,
    dispatch: bool,
) -> Result<InstantiateRunResult, String> {
    let (goal_prompt, _plan_json, warnings, plan) = {
        let conn = db
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        let tmpl = get_template(&conn, template_id)?
            .ok_or_else(|| format!("template not found: {template_id}"))?;
        let declared = parse_variables_json(&tmpl.variables_json)?;
        let resolved = resolve_values(&declared, values)?;
        let (goal, plan_json) =
            instantiate_texts(&tmpl.goal_prompt, &tmpl.plan_json, &resolved)?;
        let parsed = parse_plan_json(&plan_json)?;
        let validated = validate_plan(&conn, parsed)?;
        (
            goal,
            plan_json,
            validated.warnings,
            validated.plan,
        )
    };

    let goal_trim = goal_prompt.trim();
    if goal_trim.is_empty() {
        return Ok(fail("goal must not be empty"));
    }

    let (goal_id, plan_id) = {
        let conn = db
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        let analysis_json = plan_to_analysis_json(&plan)?;
        let goal = create_goal(&conn, goal_trim, Some(template_id))?;
        let plan_row = save_plan(&conn, &goal.id, &analysis_json)?;
        (goal.id, plan_row.id)
    };

    if !dispatch {
        return Ok(InstantiateRunResult {
            ok: true,
            goal_id: Some(goal_id),
            plan_id: Some(plan_id),
            plan: Some(plan),
            dispatch: None,
            started: None,
            error: None,
            warnings,
        });
    }

    let dispatched = {
        let conn = db
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        dispatch_plan(&conn, &plan_id)?
    };

    let started = spawn_dag_run(
        app.clone(),
        Arc::clone(db),
        Arc::clone(cancels),
        dispatched.run.id.clone(),
        None,
    )?;

    Ok(InstantiateRunResult {
        ok: true,
        goal_id: Some(goal_id),
        plan_id: Some(plan_id),
        plan: Some(plan),
        dispatch: Some(dispatched),
        started: Some(started),
        error: None,
        warnings,
    })
}
