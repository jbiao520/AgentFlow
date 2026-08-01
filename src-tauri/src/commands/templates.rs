//! Template IPC — CRUD, polish, instantiate.
use crate::commands::orchestrate::{
    orchestrate_from_json, OrchestrateFromJsonArgs, OrchestrateResult,
};
use crate::commands::tasks::{start_run, StartRunResult};
use crate::repo::{
    create_template as repo_create, delete_template as repo_delete,
    duplicate_template as repo_duplicate, get_goal, get_orchestrator_settings, get_plan,
    get_task_run, get_template, list_templates as repo_list, update_template as repo_update,
    Template, TemplateCreate, TemplateUpdate,
};
use crate::services::dispatch::{dispatch_plan as svc_dispatch, DispatchResult};
use crate::services::orchestrate::{parse_plan_json, validate_plan};
use crate::services::template_polish::{
    polish_template_blocking, skip_polish_draft, PolishResult,
};
use crate::services::template_vars::{
    assert_plan_structure_unchanged, instantiate_texts, parse_variables_json, resolve_values,
    unknown_placeholders,
};
use crate::state::{DbState, RunState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolishTemplateArgs {
    #[serde(default)]
    pub goal_id: Option<String>,
    #[serde(default)]
    pub plan_id: Option<String>,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub goal_prompt: Option<String>,
    #[serde(default)]
    pub plan_json: Option<String>,
    /// If true, skip CLI polish and return raw snapshot.
    #[serde(default)]
    pub skip_ai: bool,
}

fn load_goal_plan(
    conn: &rusqlite::Connection,
    args: &PolishTemplateArgs,
) -> Result<(String, String, Option<String>, Option<String>, Option<String>), String> {
    let mut source_goal_id = args.goal_id.clone();
    let mut source_plan_id = args.plan_id.clone();
    let mut source_run_id = args.run_id.clone();

    if let Some(run_id) = &args.run_id {
        let wrapped = get_task_run(conn, run_id)?
            .ok_or_else(|| format!("run not found: {run_id}"))?;
        source_goal_id = Some(wrapped.run.goal_id.clone());
        source_plan_id = Some(wrapped.run.plan_id.clone());
        source_run_id = Some(wrapped.run.id.clone());
    }

    if let (Some(g), Some(p)) = (
        args.goal_prompt.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        args.plan_json.as_deref().map(str::trim).filter(|s| !s.is_empty()),
    ) {
        return Ok((
            g.to_string(),
            p.to_string(),
            source_goal_id,
            source_plan_id,
            source_run_id,
        ));
    }

    let plan_id = source_plan_id
        .clone()
        .ok_or_else(|| "plan_id or plan_json required".to_string())?;
    let plan = get_plan(conn, &plan_id)?.ok_or_else(|| format!("plan not found: {plan_id}"))?;
    let goal_id = source_goal_id.clone().unwrap_or_else(|| plan.goal_id.clone());
    let goal = get_goal(conn, &goal_id)?.ok_or_else(|| format!("goal not found: {goal_id}"))?;
    Ok((
        goal.prompt,
        plan.analysis_json,
        Some(goal_id),
        Some(plan_id),
        source_run_id,
    ))
}

#[tauri::command]
pub fn list_templates(state: State<'_, DbState>) -> Result<Vec<Template>, String> {
    with_db(&state, repo_list)
}

#[tauri::command(rename = "get_template")]
pub fn get_template_cmd(
    state: State<'_, DbState>,
    id: String,
) -> Result<Option<Template>, String> {
    with_db(&state, |c| get_template(c, &id))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolishTemplateResult {
    pub polish: PolishResult,
    pub source_goal_id: Option<String>,
    pub source_plan_id: Option<String>,
    pub source_run_id: Option<String>,
}

#[tauri::command]
pub async fn polish_template(
    state: State<'_, DbState>,
    args: PolishTemplateArgs,
) -> Result<PolishTemplateResult, String> {
    let (goal_prompt, plan_json, source_goal_id, source_plan_id, source_run_id) = {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        load_goal_plan(&conn, &args)?
    };

    // Validate plan parses
    let _ = parse_plan_json(&plan_json)?;

    if args.skip_ai {
        return Ok(PolishTemplateResult {
            polish: skip_polish_draft(&goal_prompt, &plan_json),
            source_goal_id,
            source_plan_id,
            source_run_id,
        });
    }

    let settings = {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        get_orchestrator_settings(&conn)?
    };

    let goal_prompt_c = goal_prompt.clone();
    let plan_json_c = plan_json.clone();
    let polish = tauri::async_runtime::spawn_blocking(move || {
        polish_template_blocking(&settings, &goal_prompt_c, &plan_json_c)
    })
    .await
    .map_err(|e| format!("polish join error: {e}"))?;

    Ok(PolishTemplateResult {
        polish,
        source_goal_id,
        source_plan_id,
        source_run_id,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTemplateArgs {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub source_goal_id: Option<String>,
    #[serde(default)]
    pub source_plan_id: Option<String>,
    #[serde(default)]
    pub source_run_id: Option<String>,
    pub goal_prompt: String,
    pub plan_json: String,
    #[serde(default)]
    pub variables_json: Option<String>,
}

#[tauri::command(rename = "create_template")]
pub fn create_template_cmd(
    state: State<'_, DbState>,
    args: CreateTemplateArgs,
) -> Result<Template, String> {
    let vars_raw = args.variables_json.unwrap_or_else(|| "[]".into());
    let vars = parse_variables_json(&vars_raw)?;
    let unknown = unknown_placeholders(&args.goal_prompt, &args.plan_json, &vars)?;
    if !unknown.is_empty() {
        return Err(format!(
            "undeclared placeholders: {}",
            unknown.join(", ")
        ));
    }
    // Parse plan for basic shape
    let _ = parse_plan_json(&args.plan_json)?;

    with_db(&state, |c| {
        repo_create(
            c,
            TemplateCreate {
                name: args.name,
                description: args.description,
                source_goal_id: args.source_goal_id,
                source_plan_id: args.source_plan_id,
                source_run_id: args.source_run_id,
                goal_prompt: args.goal_prompt,
                plan_json: args.plan_json,
                variables_json: vars_raw,
            },
        )
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTemplateArgs {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub goal_prompt: Option<String>,
    #[serde(default)]
    pub plan_json: Option<String>,
    #[serde(default)]
    pub variables_json: Option<String>,
}

#[tauri::command(rename = "update_template")]
pub fn update_template_cmd(
    state: State<'_, DbState>,
    args: UpdateTemplateArgs,
) -> Result<Template, String> {
    with_db(&state, |c| {
        let existing = get_template(c, &args.id)?
            .ok_or_else(|| format!("template not found: {}", args.id))?;

        let plan_json = if let Some(ref new_plan) = args.plan_json {
            Some(assert_plan_structure_unchanged(
                &existing.plan_json,
                new_plan,
            )?)
        } else {
            None
        };

        let goal_prompt = args
            .goal_prompt
            .clone()
            .unwrap_or_else(|| existing.goal_prompt.clone());
        let final_plan = plan_json
            .clone()
            .unwrap_or_else(|| existing.plan_json.clone());
        let vars_raw = args
            .variables_json
            .clone()
            .unwrap_or_else(|| existing.variables_json.clone());
        let vars = parse_variables_json(&vars_raw)?;
        let unknown = unknown_placeholders(&goal_prompt, &final_plan, &vars)?;
        if !unknown.is_empty() {
            return Err(format!(
                "undeclared placeholders: {}",
                unknown.join(", ")
            ));
        }

        repo_update(
            c,
            &args.id,
            TemplateUpdate {
                name: args.name,
                description: args.description,
                goal_prompt: args.goal_prompt,
                plan_json,
                variables_json: args.variables_json,
            },
        )
    })
}

#[tauri::command(rename = "delete_template")]
pub fn delete_template_cmd(state: State<'_, DbState>, id: String) -> Result<(), String> {
    with_db(&state, |c| repo_delete(c, &id))
}

#[tauri::command(rename = "duplicate_template")]
pub fn duplicate_template_cmd(
    state: State<'_, DbState>,
    id: String,
) -> Result<Template, String> {
    with_db(&state, |c| repo_duplicate(c, &id))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstantiateTemplateArgs {
    pub template_id: String,
    /// key → value
    #[serde(default)]
    pub values: HashMap<String, String>,
    /// If true, dispatch + start after creating plan.
    #[serde(default)]
    pub dispatch: bool,
    /// User override for this run only (1–8). Absent → use plan.concurrency / default.
    #[serde(default)]
    pub concurrency: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstantiateTemplateResult {
    pub orchestrate: OrchestrateResult,
    pub dispatch: Option<DispatchResult>,
    pub started: Option<StartRunResult>,
}

#[tauri::command]
pub fn instantiate_template(
    app: AppHandle,
    state: State<'_, DbState>,
    runs: State<'_, RunState>,
    args: InstantiateTemplateArgs,
) -> Result<InstantiateTemplateResult, String> {
    let (goal, plan_json, template_id) = {
        let conn = state
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        let tmpl = get_template(&conn, &args.template_id)?
            .ok_or_else(|| format!("template not found: {}", args.template_id))?;
        let declared = parse_variables_json(&tmpl.variables_json)?;
        let resolved = resolve_values(&declared, &args.values)?;
        // Also require values for any undeclared leftover — substitute will catch
        let (goal, plan_json) =
            instantiate_texts(&tmpl.goal_prompt, &tmpl.plan_json, &resolved)?;

        // Agent presence check before direct dispatch
        if args.dispatch {
            let plan = parse_plan_json(&plan_json)?;
            let validated = validate_plan(&conn, plan)?;
            let _ = validated;
        }

        (goal, plan_json, tmpl.id)
    };

    let orch = orchestrate_from_json(
        state.clone(),
        OrchestrateFromJsonArgs {
            goal,
            plan_json,
            template_key: Some(template_id),
        },
    )?;

    if !orch.ok {
        return Ok(InstantiateTemplateResult {
            orchestrate: orch,
            dispatch: None,
            started: None,
        });
    }

    if !args.dispatch {
        return Ok(InstantiateTemplateResult {
            orchestrate: orch,
            dispatch: None,
            started: None,
        });
    }

    let plan_id = orch
        .plan_row
        .as_ref()
        .map(|p| p.id.clone())
        .ok_or_else(|| "orchestrate succeeded but plan_row missing".to_string())?;

    let dispatched = with_db(&state, |c| svc_dispatch(c, &plan_id))?;
    let started = start_run(app, state, runs, dispatched.run.id.clone(), args.concurrency)?;

    Ok(InstantiateTemplateResult {
        orchestrate: orch,
        dispatch: Some(dispatched),
        started: Some(started),
    })
}
