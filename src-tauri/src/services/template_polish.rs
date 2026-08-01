//! AI polish for execution templates — extract variables and rewrite prompts.
use crate::db::path::ensure_db_dir;
use crate::engines::adapter::{EngineRunRequest, LogEvent};
use crate::engines::runner::{run_engine_unchecked, CancelToken};
use crate::repo::OrchestratorSettings;
use crate::services::template_vars::{
    finalize_polish_draft, parse_polish_draft, TemplateVariable,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolishResult {
    pub ok: bool,
    pub name: Option<String>,
    pub description: Option<String>,
    pub goal_prompt: Option<String>,
    pub plan_json: Option<String>,
    pub variables: Vec<TemplateVariable>,
    pub raw_output: Option<String>,
    pub error: Option<String>,
}

fn polish_cwd() -> Result<String, String> {
    let db = ensure_db_dir()?;
    let parent = db
        .parent()
        .ok_or_else(|| "app data dir missing parent".to_string())?;
    let cwd = parent.join("orchestrator");
    fs::create_dir_all(&cwd).map_err(|e| format!("create orchestrator cwd: {e}"))?;
    Ok(cwd.to_string_lossy().to_string())
}

pub fn build_polish_prompt(goal_prompt: &str, plan_json: &str) -> String {
    format!(
        r#"You are preparing a reusable execution template for AgentFlow.

Given an original goal and a Plan JSON (DAG of subtasks), produce a polished template:

1. Identify concrete values that should become variables when re-running (topics, ids, product names, URLs, dates, etc.).
2. Replace those values with placeholders like {{{{topic}}}} or {{{{product_id}}}} (snake_case keys only).
3. Polish the goal prompt and each subtask prompt for clarity — keep the same meaning.
4. Do NOT change subtask id, depends_on, agent, or skills. Keep the same number of subtasks and the same ids.

Return ONLY a single JSON object (no markdown fences) with this shape:
{{
  "name": "short template name",
  "description": "one sentence",
  "variables": [
    {{"key":"topic","label":"主题","required":true,"default":null}}
  ],
  "goal_prompt": "… with {{{{placeholders}}}} …",
  "plan": {{ ... full plan object with parameterized prompts ... }}
}}

Original goal:
---
{goal}
---

Original plan JSON:
---
{plan}
---
"#,
        goal = goal_prompt,
        plan = plan_json
    )
}

fn fail(raw: Option<String>, error: String) -> PolishResult {
    PolishResult {
        ok: false,
        name: None,
        description: None,
        goal_prompt: None,
        plan_json: None,
        variables: vec![],
        raw_output: raw,
        error: Some(error),
    }
}

/// Run polish via orchestrator CLI settings. Blocking — call from spawn_blocking.
pub fn polish_template_blocking(
    settings: &OrchestratorSettings,
    goal_prompt: &str,
    plan_json: &str,
) -> PolishResult {
    let cwd = match polish_cwd() {
        Ok(c) => c,
        Err(e) => return fail(None, e),
    };
    let prompt = build_polish_prompt(goal_prompt, plan_json);
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
        stream_output: false,
    };

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

    match run_result {
        Ok(code) if code != 0 => {
            return fail(
                Some(raw),
                format!("polish CLI exited with code {code}"),
            );
        }
        Err(e) => return fail(Some(raw), e),
        Ok(_) => {}
    }

    let draft = match parse_polish_draft(&raw) {
        Ok(d) => d,
        Err(e) => return fail(Some(raw), e),
    };

    match finalize_polish_draft(goal_prompt, plan_json, draft) {
        Ok((name, description, goal, vars, locked_plan)) => PolishResult {
            ok: true,
            name: Some(name),
            description: Some(description),
            goal_prompt: Some(goal),
            plan_json: Some(locked_plan),
            variables: vars,
            raw_output: Some(raw),
            error: None,
        },
        Err(e) => fail(Some(raw), e),
    }
}

/// Skip-AI draft: empty variables, original texts.
pub fn skip_polish_draft(goal_prompt: &str, plan_json: &str) -> PolishResult {
    PolishResult {
        ok: true,
        name: Some("未命名模版".into()),
        description: Some(String::new()),
        goal_prompt: Some(goal_prompt.to_string()),
        plan_json: Some(plan_json.to_string()),
        variables: vec![],
        raw_output: None,
        error: None,
    }
}
