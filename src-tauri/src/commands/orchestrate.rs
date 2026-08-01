//! Orchestrate IPC — call engine or accept fixture JSON; validate Plan (SPEC §7.4).
use crate::db::path::ensure_db_dir;
use crate::engines::adapter::{EngineRunRequest, LogEvent};
use crate::engines::runner::{run_engine_unchecked, CancelToken};
use crate::repo::{
    create_goal, get_orchestrator_settings, get_plan, save_plan, update_plan_analysis, Goal, Plan,
};
use crate::services::dispatch::{dispatch_plan as svc_dispatch, DispatchResult};
use crate::services::orchestrate::{
    apply_clarifications, build_agent_catalog, build_orchestrate_prompt, parse_plan_json,
    plan_to_analysis_json, validate_plan, PlanAnalysis, PlanClarification,
};
use crate::state::{DbState, RunState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrateArgs {
    pub goal: String,
    #[serde(default)]
    pub template_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrateFromJsonArgs {
    pub goal: String,
    pub plan_json: String,
    #[serde(default)]
    pub template_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrateResult {
    pub ok: bool,
    pub goal: Option<Goal>,
    pub plan_row: Option<Plan>,
    pub plan: Option<PlanAnalysis>,
    pub warnings: Vec<String>,
    pub raw_output: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmPlanAnswersArgs {
    pub plan_id: String,
    pub answers: Vec<PlanClarification>,
    /// User override for this run only (1–8). Absent → use plan.concurrency / default.
    #[serde(default)]
    pub concurrency: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmPlanAnswersResult {
    pub plan: PlanAnalysis,
    pub dispatch: DispatchResult,
    pub started: bool,
}

fn orchestrate_cwd() -> Result<String, String> {
    let db = ensure_db_dir()?;
    let parent = db
        .parent()
        .ok_or_else(|| "app data dir missing parent".to_string())?;
    let cwd = parent.join("orchestrator");
    fs::create_dir_all(&cwd).map_err(|e| format!("create orchestrator cwd: {e}"))?;
    Ok(cwd.to_string_lossy().to_string())
}

fn persist_validated(
    state: &State<'_, DbState>,
    goal_prompt: &str,
    template_key: Option<&str>,
    plan: &PlanAnalysis,
    warnings: Vec<String>,
    raw_output: Option<String>,
) -> Result<OrchestrateResult, String> {
    let analysis_json = plan_to_analysis_json(plan)?;
    let conn = state
        .conn
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    let goal = create_goal(&conn, goal_prompt, template_key)?;
    let plan_row = save_plan(&conn, &goal.id, &analysis_json)?;
    Ok(OrchestrateResult {
        ok: true,
        goal: Some(goal),
        plan_row: Some(plan_row),
        plan: Some(plan.clone()),
        warnings,
        raw_output,
        error: None,
    })
}

fn fail_result(raw_output: Option<String>, error: String) -> OrchestrateResult {
    OrchestrateResult {
        ok: false,
        goal: None,
        plan_row: None,
        plan: None,
        warnings: vec![],
        raw_output,
        error: Some(error),
    }
}

/// Fixture / test path: validate + persist without calling a live CLI.
#[tauri::command]
pub fn orchestrate_from_json(
    state: State<'_, DbState>,
    args: OrchestrateFromJsonArgs,
) -> Result<OrchestrateResult, String> {
    let goal = args.goal.trim();
    if goal.is_empty() {
        return Ok(fail_result(None, "goal must not be empty".into()));
    }
    let raw = args.plan_json.clone();
    let parsed = match parse_plan_json(&raw) {
        Ok(p) => p,
        Err(e) => return Ok(fail_result(Some(raw), e)),
    };
    let validated = {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        match validate_plan(&conn, parsed) {
            Ok(v) => v,
            Err(e) => return Ok(fail_result(Some(raw), e)),
        }
    };
    persist_validated(
        &state,
        goal,
        args.template_key.as_deref(),
        &validated.plan,
        validated.warnings,
        Some(raw),
    )
}

/// Live CLI orchestrate using orchestrator_settings.
/// CLI spawn runs off the UI thread via `spawn_blocking`.
#[tauri::command]
pub async fn orchestrate(
    state: State<'_, DbState>,
    args: OrchestrateArgs,
) -> Result<OrchestrateResult, String> {
    let goal = args.goal.trim().to_string();
    if goal.is_empty() {
        return Ok(fail_result(None, "goal must not be empty".into()));
    }

    let (settings, catalog, prompt) = {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        let settings = get_orchestrator_settings(&conn)?;
        let catalog = build_agent_catalog(&conn)?;
        if catalog.is_empty() {
            return Ok(fail_result(
                None,
                "no agents registered — import an agent before orchestrating".into(),
            ));
        }
        let prompt = build_orchestrate_prompt(&goal, &catalog)?;
        (settings, catalog, prompt)
    };
    let _ = catalog; // used in prompt already

    let cwd = orchestrate_cwd()?;
    let model = Some(settings.model.clone()).filter(|m| !m.is_empty());
    let reasoning = crate::services::cli_models::effective_reasoning_effort(
        &settings.cli_engine,
        model.as_deref(),
        Some(settings.reasoning_effort.as_str()),
    );
    let req = EngineRunRequest {
        engine: settings.cli_engine.clone(),
        cwd,
        prompt,
        model,
        reasoning,
        fast: settings.use_fast,
        extra_args: vec![],
        env: HashMap::new(),
        // Keep text/final blob mode so Plan JSON can be parsed from stdout.
        stream_output: false,
    };

    let (run_result, raw) = tauri::async_runtime::spawn_blocking(move || {
        let cancel = CancelToken::new();
        let mut stdout_buf = String::new();
        let mut stderr_buf = String::new();
        let run_result = run_engine_unchecked(&req, &cancel, None, |ev: LogEvent| {
            if ev.stream == "stdout" {
                if !stdout_buf.is_empty() {
                    stdout_buf.push('\n');
                }
                stdout_buf.push_str(&ev.line);
            } else {
                if !stderr_buf.is_empty() {
                    stderr_buf.push('\n');
                }
                stderr_buf.push_str(&ev.line);
            }
        }, None);
        let raw = if stdout_buf.trim().is_empty() {
            stderr_buf
        } else {
            stdout_buf
        };
        (run_result, raw)
    })
    .await
    .map_err(|e| format!("orchestrate join error: {e}"))?;

    match run_result {
        Ok(code) if code != 0 => {
            return Ok(fail_result(
                Some(raw),
                format!("orchestrator CLI exited with code {code}"),
            ));
        }
        Err(e) => return Ok(fail_result(Some(raw), e)),
        Ok(_) => {}
    }

    let parsed = match parse_plan_json(&raw) {
        Ok(p) => p,
        Err(e) => return Ok(fail_result(Some(raw), e)),
    };
    let validated = {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        match validate_plan(&conn, parsed) {
            Ok(v) => v,
            Err(e) => return Ok(fail_result(Some(raw), e)),
        }
    };

    persist_validated(
        &state,
        &goal,
        args.template_key.as_deref(),
        &validated.plan,
        validated.warnings,
        Some(raw),
    )
}

/// Merge clarifying answers into the plan, then dispatch + start.
#[tauri::command]
pub fn confirm_plan_answers(
    app: AppHandle,
    state: State<'_, DbState>,
    runs: State<'_, RunState>,
    args: ConfirmPlanAnswersArgs,
) -> Result<ConfirmPlanAnswersResult, String> {
    let plan_id = args.plan_id.trim().to_string();
    if plan_id.is_empty() {
        return Err("plan_id must not be empty".into());
    }

    let merged_plan = {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        let row = get_plan(&conn, &plan_id)?.ok_or_else(|| format!("plan not found: {plan_id}"))?;
        let analysis = parse_plan_json(&row.analysis_json)
            .map_err(|e| format!("stored plan JSON invalid: {e}"))?;
        let merged = apply_clarifications(analysis, &args.answers)?;
        let validated = validate_plan(&conn, merged)?;
        let json = plan_to_analysis_json(&validated.plan)?;
        let _ = update_plan_analysis(&conn, &plan_id, &json)?;
        validated.plan
    };

    let dispatch = {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        svc_dispatch(&conn, &plan_id)?
    };

    let started = crate::commands::tasks::start_run(
        app,
        state,
        runs,
        dispatch.run.id.clone(),
        args.concurrency,
    )?
    .started;

    Ok(ConfirmPlanAnswersResult {
        plan: merged_plan,
        dispatch,
        started,
    })
}
