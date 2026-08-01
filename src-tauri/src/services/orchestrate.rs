//! Orchestrator: build catalog prompt, parse/validate Plan JSON (SPEC §7.4).
use crate::repo::{
    get_agent_profile, list_agents, list_skills_by_agent, Agent, AgentModelProfile, Skill,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanIntent {
    pub summary: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanSubtask {
    pub id: String,
    pub title: String,
    pub agent: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub cli_engine: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub artifact_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlanQuestion {
    pub id: String,
    pub prompt: String,
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlanClarification {
    pub question_id: String,
    pub option: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanAnalysis {
    pub intent: PlanIntent,
    pub subtasks: Vec<PlanSubtask>,
    /// Max ready nodes to run in parallel (1–8). Absent → runner default (1).
    #[serde(default)]
    pub concurrency: Option<usize>,
    /// Clarifying questions (0–6). Empty/absent → skip Q&A UI.
    #[serde(default)]
    pub questions: Vec<PlanQuestion>,
    /// User answers after confirm; absent until submitted.
    #[serde(default)]
    pub clarifications: Vec<PlanClarification>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogSkill {
    pub relative_path: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogAgent {
    pub name: String,
    pub description: Option<String>,
    pub default_cli: String,
    pub preferred_model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub skills: Vec<CatalogSkill>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatePlanResult {
    pub plan: PlanAnalysis,
    pub warnings: Vec<String>,
}

/// Strip markdown fences and extract the first JSON object from CLI output.
pub fn extract_json_payload(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty orchestrator output".into());
    }

    // Prefer fenced ```json ... ``` block
    if let Some(start) = trimmed.find("```") {
        let after = &trimmed[start + 3..];
        let after = after
            .strip_prefix("json")
            .or_else(|| after.strip_prefix("JSON"))
            .unwrap_or(after);
        let after = after.trim_start_matches(|c: char| c == '\r' || c == '\n');
        if let Some(end) = after.find("```") {
            let inner = after[..end].trim();
            if inner.starts_with('{') {
                return Ok(inner.to_string());
            }
        }
    }

    // First balanced `{` … `}`
    if let Some(start) = trimmed.find('{') {
        let mut depth = 0i32;
        let mut in_str = false;
        let mut escape = false;
        for (i, ch) in trimmed[start..].char_indices() {
            if in_str {
                if escape {
                    escape = false;
                } else if ch == '\\' {
                    escape = true;
                } else if ch == '"' {
                    in_str = false;
                }
                continue;
            }
            match ch {
                '"' => in_str = true,
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(trimmed[start..start + i + 1].to_string());
                    }
                }
                _ => {}
            }
        }
    }

    Err("no JSON object found in orchestrator output".into())
}

pub fn parse_plan_json(raw: &str) -> Result<PlanAnalysis, String> {
    let payload = extract_json_payload(raw)?;
    let value: Value =
        serde_json::from_str(&payload).map_err(|e| format!("plan JSON parse error: {e}"))?;
    // Ignore unknown fields via serde default on structs
    serde_json::from_value(value).map_err(|e| format!("plan schema error: {e}"))
}

fn skill_basename(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

fn match_skill<'a>(skills: &'a [Skill], name: &str) -> Option<&'a Skill> {
    let needle = name.trim();
    let base = skill_basename(needle);
    skills.iter().find(|s| {
        s.relative_path == needle
            || skill_basename(&s.relative_path) == needle
            || skill_basename(&s.relative_path) == base
            || s.relative_path.ends_with(needle)
    })
}

/// Validate agents exist; drop unknown/disabled skills with warnings.
pub fn validate_plan(
    conn: &Connection,
    mut plan: PlanAnalysis,
) -> Result<ValidatePlanResult, String> {
    if plan.intent.summary.trim().is_empty() {
        return Err("intent.summary must not be empty".into());
    }
    if plan.subtasks.is_empty() {
        return Err("plan must contain at least one subtask".into());
    }

    let agents = list_agents(conn)?;
    let mut warnings = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for st in &mut plan.subtasks {
        let id = st.id.trim().to_string();
        if id.is_empty() {
            return Err("subtask id must not be empty".into());
        }
        if !seen_ids.insert(id.clone()) {
            return Err(format!("duplicate subtask id: {id}"));
        }
        st.id = id;

        if st.title.trim().is_empty() {
            return Err(format!("subtask {} title must not be empty", st.id));
        }

        let agent_name = st.agent.trim();
        if agent_name.is_empty() {
            return Err(format!("subtask {} agent must not be empty", st.id));
        }
        let agent = agents
            .iter()
            .find(|a| a.name == agent_name)
            .ok_or_else(|| format!("unknown agent in plan: {agent_name}"))?;
        st.agent = agent.name.clone();

        let agent_skills = list_skills_by_agent(conn, &agent.id)?;
        let mut kept = Vec::new();
        for sk in &st.skills {
            match match_skill(&agent_skills, sk) {
                Some(found) if found.enabled => {
                    kept.push(found.relative_path.clone());
                }
                Some(found) => {
                    warnings.push(format!(
                        "subtask {}: skill '{}' is disabled — dropped",
                        st.id, found.relative_path
                    ));
                }
                None => {
                    warnings.push(format!(
                        "subtask {}: unknown skill '{}' — dropped",
                        st.id, sk
                    ));
                }
            }
        }
        st.skills = kept;

        // Fill defaults from agent when missing
        if st.cli_engine.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
            st.cli_engine = Some(agent.default_cli.clone());
        }
        let profile = get_agent_profile(conn, &agent.id)?;
        if st.model.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
            st.model = profile
                .as_ref()
                .and_then(|p| p.preferred_model.clone())
                .filter(|m| !m.trim().is_empty());
        }
        if st
            .reasoning_effort
            .as_ref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
        {
            st.reasoning_effort = profile
                .as_ref()
                .and_then(|p| p.reasoning_effort.clone())
                .filter(|r| !r.trim().is_empty())
                .or_else(|| Some("medium".into()));
        }
        if st.prompt.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
            st.prompt = Some(st.title.clone());
        }
    }

    // Validate depends_on references
    for st in &plan.subtasks {
        for dep in &st.depends_on {
            if !seen_ids.contains(dep.as_str()) {
                return Err(format!(
                    "subtask {} depends_on unknown id: {dep}",
                    st.id
                ));
            }
            if dep == &st.id {
                return Err(format!("subtask {} cannot depend on itself", st.id));
            }
        }
    }

    if let Some(cycle) = detect_dependency_cycle(&plan.subtasks) {
        return Err(format!("dependency cycle detected: {cycle}"));
    }

    for st in &mut plan.subtasks {
        let engine = st
            .cli_engine
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("");
        if engine.is_empty() {
            return Err(format!("subtask {} cli_engine must not be empty", st.id));
        }
        let engine = normalize_supported_engine(engine).map_err(|e| {
            format!("subtask {}: {e}", st.id)
        })?;
        st.cli_engine = Some(engine.to_string());

        for path in &st.artifact_paths {
            if !is_safe_relative_artifact_path(path) {
                return Err(format!(
                    "subtask {}: unsafe artifact path '{path}' (must be relative, no '..')",
                    st.id
                ));
            }
        }

        if let Some(ref effort) = st.reasoning_effort {
            let e = effort.trim();
            if !e.is_empty() && !is_known_reasoning_effort(e) {
                return Err(format!(
                    "subtask {}: unsupported reasoning_effort '{e}' (expected none|low|medium|high|xhigh|max|ultra)",
                    st.id
                ));
            }
        }
    }

    sanitize_questions(&mut plan, &mut warnings);

    if let Some(raw) = plan.concurrency {
        let clamped = crate::services::dag_runner::clamp_concurrency(raw);
        if clamped != raw {
            warnings.push(format!(
                "concurrency {raw} clamped to {clamped} (allowed 1–{})",
                crate::services::dag_runner::MAX_CONCURRENCY
            ));
        }
        plan.concurrency = Some(clamped);
    }

    Ok(ValidatePlanResult { plan, warnings })
}

const MAX_QUESTIONS: usize = 6;
const MAX_NOTE_CHARS: usize = 500;

/// Drop/truncate invalid clarifying questions; never fail the whole plan.
pub fn sanitize_questions(plan: &mut PlanAnalysis, warnings: &mut Vec<String>) {
    let mut kept = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (i, q) in plan.questions.drain(..).enumerate() {
        if kept.len() >= MAX_QUESTIONS {
            warnings.push(format!(
                "questions truncated to {MAX_QUESTIONS} (dropped remaining)"
            ));
            break;
        }
        let id = q.id.trim().to_string();
        let prompt = q.prompt.trim().to_string();
        let options: Vec<String> = q
            .options
            .iter()
            .map(|o| o.trim().to_string())
            .filter(|o| !o.is_empty())
            .collect();
        if id.is_empty() || prompt.is_empty() {
            warnings.push(format!("question[{i}] missing id/prompt — dropped"));
            continue;
        }
        if !(2..=4).contains(&options.len()) {
            warnings.push(format!(
                "question '{id}' needs 2–4 options (got {}) — dropped",
                options.len()
            ));
            continue;
        }
        if !seen.insert(id.clone()) {
            warnings.push(format!("duplicate question id '{id}' — dropped"));
            continue;
        }
        kept.push(PlanQuestion {
            id,
            prompt,
            options,
        });
    }
    plan.questions = kept;
}

/// Merge user answers into the plan: write clarifications, append to prompts, clear questions.
pub fn apply_clarifications(
    mut plan: PlanAnalysis,
    answers: &[PlanClarification],
) -> Result<PlanAnalysis, String> {
    if plan.questions.is_empty() {
        return Err("plan has no pending clarifying questions".into());
    }

    let mut by_qid = std::collections::HashMap::new();
    for a in answers {
        let qid = a.question_id.trim().to_string();
        if qid.is_empty() {
            return Err("answer question_id must not be empty".into());
        }
        if by_qid.insert(qid.clone(), a).is_some() {
            return Err(format!("duplicate answer for question '{qid}'"));
        }
    }

    let mut clarifications = Vec::with_capacity(plan.questions.len());
    for q in &plan.questions {
        let ans = by_qid
            .get(&q.id)
            .ok_or_else(|| format!("missing answer for question '{}'", q.id))?;
        let option = ans.option.trim().to_string();
        if option.is_empty() {
            return Err(format!("answer for '{}' must select an option", q.id));
        }
        if !q.options.iter().any(|o| o == &option) {
            return Err(format!(
                "answer for '{}': option '{option}' is not in {:?}",
                q.id, q.options
            ));
        }
        let note = ans
            .note
            .as_ref()
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .map(|n| {
                if n.chars().count() > MAX_NOTE_CHARS {
                    n.chars().take(MAX_NOTE_CHARS).collect()
                } else {
                    n
                }
            });
        clarifications.push(PlanClarification {
            question_id: q.id.clone(),
            option,
            note,
        });
    }

    let block = format_clarification_block(&plan.questions, &clarifications);
    for st in &mut plan.subtasks {
        let base = st.prompt.clone().unwrap_or_else(|| st.title.clone());
        st.prompt = Some(format!("{}\n\n{}", base.trim_end(), block));
    }

    plan.clarifications = clarifications;
    plan.questions.clear(); // answered — UI will not re-prompt
    Ok(plan)
}

fn format_clarification_block(
    questions: &[PlanQuestion],
    clarifications: &[PlanClarification],
) -> String {
    let mut lines = vec!["## 用户澄清 (User Clarifications)".to_string()];
    for q in questions {
        if let Some(c) = clarifications.iter().find(|c| c.question_id == q.id) {
            let mut line = format!("- {}: {}", q.prompt, c.option);
            if let Some(ref note) = c.note {
                line.push_str(&format!(" — {note}"));
            }
            lines.push(line);
        }
    }
    lines.join("\n")
}

/// Hard runtime preflight before Dispatch — CLI installed, model/effort in live catalog.
pub fn preflight_for_dispatch(plan: &PlanAnalysis) -> Result<Vec<String>, String> {
    let warnings = Vec::new();
    for st in &plan.subtasks {
        let engine = st
            .cli_engine
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("subtask {} missing cli_engine", st.id))?;
        let engine = normalize_supported_engine(engine)
            .map_err(|e| format!("subtask {}: {e}", st.id))?;

        if crate::services::cli_probe::resolve_engine_binary(engine).is_none() {
            return Err(format!(
                "subtask {}: CLI not installed or not found: {engine}",
                st.id
            ));
        }

        if let Some(ref model) = st.model {
            let model = model.trim();
            if model.is_empty() {
                continue;
            }
            match crate::services::cli_models::list_engine_models(engine, false) {
                Ok(catalog) => {
                    let found = catalog.models.iter().find(|m| m.id == model);
                    match found {
                        None => {
                            return Err(format!(
                                "subtask {}: model '{model}' is not available for {engine}",
                                st.id
                            ));
                        }
                        Some(m) => {
                            if let Some(ref effort) = st.reasoning_effort {
                                let e = effort.trim();
                                if !e.is_empty()
                                    && !m.efforts.is_empty()
                                    && !m.efforts.iter().any(|x| x == e)
                                {
                                    return Err(format!(
                                        "subtask {}: reasoning_effort '{e}' not supported by model '{model}' (allowed: {})",
                                        st.id,
                                        m.efforts.join(", ")
                                    ));
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    return Err(format!(
                        "subtask {}: failed to load {engine} model catalog: {e}",
                        st.id
                    ));
                }
            }
        }
    }
    Ok(warnings)
}

fn normalize_supported_engine(engine: &str) -> Result<&'static str, String> {
    match engine.trim() {
        "cursor-agent" => Ok("cursor-agent"),
        "codex" => Ok("codex"),
        "opencode" => Ok("opencode"),
        other => Err(format!(
            "unsupported cli_engine '{other}' (expected cursor-agent|codex|opencode)"
        )),
    }
}

fn is_known_reasoning_effort(effort: &str) -> bool {
    matches!(
        effort.to_lowercase().as_str(),
        "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
    )
}

fn is_safe_relative_artifact_path(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }
    let path = std::path::Path::new(trimmed);
    if path.is_absolute() {
        return false;
    }
    for c in path.components() {
        if matches!(
            c,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        ) {
            return false;
        }
    }
    true
}

/// Returns a human-readable cycle path if a dependency cycle exists.
fn detect_dependency_cycle(subtasks: &[PlanSubtask]) -> Option<String> {
    use std::collections::HashMap;
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for st in subtasks {
        adj.insert(
            st.id.as_str(),
            st.depends_on.iter().map(|s| s.as_str()).collect(),
        );
    }
    // 0=unvisited, 1=visiting, 2=done
    let mut state: HashMap<&str, u8> = HashMap::new();
    let mut stack: Vec<&str> = Vec::new();

    fn dfs<'a>(
        node: &'a str,
        adj: &HashMap<&'a str, Vec<&'a str>>,
        state: &mut HashMap<&'a str, u8>,
        stack: &mut Vec<&'a str>,
    ) -> Option<String> {
        state.insert(node, 1);
        stack.push(node);
        if let Some(deps) = adj.get(node) {
            for &dep in deps {
                match state.get(dep).copied().unwrap_or(0) {
                    1 => {
                        let idx = stack.iter().position(|x| *x == dep).unwrap_or(0);
                        let mut path: Vec<&str> = stack[idx..].to_vec();
                        path.push(dep);
                        return Some(path.join(" → "));
                    }
                    0 => {
                        if let Some(c) = dfs(dep, adj, state, stack) {
                            return Some(c);
                        }
                    }
                    _ => {}
                }
            }
        }
        stack.pop();
        state.insert(node, 2);
        None
    }

    for st in subtasks {
        if state.get(st.id.as_str()).copied().unwrap_or(0) == 0 {
            if let Some(c) = dfs(st.id.as_str(), &adj, &mut state, &mut stack) {
                return Some(c);
            }
        }
    }
    None
}

pub fn build_agent_catalog(conn: &Connection) -> Result<Vec<CatalogAgent>, String> {
    let agents = list_agents(conn)?;
    let mut out = Vec::with_capacity(agents.len());
    for agent in agents {
        let profile = get_agent_profile(conn, &agent.id)?;
        let skills = list_skills_by_agent(conn, &agent.id)?
            .into_iter()
            .map(|s| CatalogSkill {
                relative_path: s.relative_path,
                title: s.title,
                description: s.description,
                enabled: s.enabled,
            })
            .collect();
        out.push(catalog_from_agent(&agent, profile.as_ref(), skills));
    }
    Ok(out)
}

fn catalog_from_agent(
    agent: &Agent,
    profile: Option<&AgentModelProfile>,
    skills: Vec<CatalogSkill>,
) -> CatalogAgent {
    CatalogAgent {
        name: agent.name.clone(),
        description: agent.description.clone(),
        default_cli: agent.default_cli.clone(),
        preferred_model: profile.and_then(|p| p.preferred_model.clone()),
        reasoning_effort: profile.and_then(|p| p.reasoning_effort.clone()),
        skills,
    }
}

pub fn build_orchestrate_prompt(goal: &str, catalog: &[CatalogAgent]) -> Result<String, String> {
    let catalog_json = serde_json::to_string_pretty(catalog)
        .map_err(|e| format!("catalog serialize: {e}"))?;
    Ok(format!(
        r#"You are the AgentFlow Orchestrator. Given the user GOAL and the AGENT CATALOG, produce a single JSON plan.

RULES:
- Respond with ONLY a JSON object (no markdown commentary outside optional ```json fences).
- agent field must be an exact agent name from the catalog.
- skills must be relative_path values that exist and are enabled for that agent (or omit).
- depends_on must reference other subtask ids in this plan.
- Include a concrete prompt for each subtask.
- artifact_paths must be workspace-relative paths that the subtask will actually create (match the prompt).
- Cross-agent pipelines are allowed. Downstream prompts must NOT assume upstream workspace paths; at runtime AgentFlow copies predecessor artifacts into `.agentflow/handoff/<run_id>/<upstream_id>/` inside the consumer workspace and injects those paths into the prompt.
- For every producer subtask that creates files, set artifact_paths to those exact relative paths so dependents can receive them.
- If the GOAL is clear and actionable, set "questions" to [].
- If the GOAL is ambiguous, add up to 6 clarifying questions (single-choice, 2–4 options each) that unblock planning decisions. Still produce a best-effort intent + subtasks; answers will refine prompts later.
- Set "concurrency" to how many independent ready subtasks may run in parallel (integer 1–8). Use 1 when the DAG is mostly sequential; use 2–8 only when several subtasks share no depends_on chain and can safely run together.

GOAL:
{goal}

AGENT CATALOG:
{catalog_json}

OUTPUT SCHEMA:
{{
  "intent": {{ "summary": "...", "tags": ["..."] }},
  "concurrency": 1,
  "subtasks": [
    {{
      "id": "t1",
      "title": "...",
      "agent": "<catalog name>",
      "skills": ["skill-file.md"],
      "depends_on": [],
      "cli_engine": "cursor-agent|codex|opencode",
      "model": "...",
      "reasoning_effort": "none|low|medium|high|xhigh|max|ultra",
      "prompt": "concrete instructions for the agent",
      "artifact_paths": ["relative/path.md"]
    }}
  ],
  "questions": [
    {{
      "id": "q1",
      "prompt": "clarifying question for the user",
      "options": ["option A", "option B", "option C"]
    }}
  ]
}}
"#
    ))
}

pub fn plan_to_analysis_json(plan: &PlanAnalysis) -> Result<String, String> {
    serde_json::to_string(plan).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_db_at;
    use crate::repo::{upsert_agent, upsert_skills_many, AgentUpsert, SkillUpsert};
    use tempfile::TempDir;

    fn seed_agent(conn: &Connection, name: &str, ws: &str) -> String {
        let agent = upsert_agent(
            conn,
            AgentUpsert {
                id: None,
                name: name.into(),
                description: Some("desc".into()),
                workspace_path: ws.into(),
                git_url: None,
                default_cli: "codex".into(),
                status: None,
            },
        )
        .unwrap();
        upsert_skills_many(
            conn,
            &[SkillUpsert {
                id: None,
                agent_id: agent.id.clone(),
                relative_path: ".agent/skills/web-crawler.md".into(),
                title: Some("Web Crawler".into()),
                description: None,
                enabled: Some(true),
                content_hash: None,
            }],
        )
        .unwrap();
        agent.id
    }

    #[test]
    fn extract_json_from_fenced_markdown() {
        let raw = "Here you go:\n```json\n{\"intent\":{\"summary\":\"x\",\"tags\":[]},\"subtasks\":[]}\n```\n";
        let got = extract_json_payload(raw).unwrap();
        assert!(got.contains("\"intent\""));
    }

    #[test]
    fn validate_rejects_unknown_agent() {
        let dir = TempDir::new().unwrap();
        let conn = open_db_at(&dir.path().join("t.db")).unwrap();
        let ws = dir.path().join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        seed_agent(&conn, "web-ops", &ws.to_string_lossy());

        let plan = parse_plan_json(
            r#"{
              "intent": {"summary": "do stuff", "tags": []},
              "subtasks": [{
                "id": "t1",
                "title": "scrape",
                "agent": "no-such-agent",
                "skills": [],
                "depends_on": [],
                "prompt": "go"
              }]
            }"#,
        )
        .unwrap();
        let err = validate_plan(&conn, plan).unwrap_err();
        assert!(err.contains("unknown agent"), "{err}");
    }

    #[test]
    fn validate_drops_unknown_skills_with_warning() {
        let dir = TempDir::new().unwrap();
        let conn = open_db_at(&dir.path().join("t.db")).unwrap();
        let ws = dir.path().join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        seed_agent(&conn, "web-ops", &ws.to_string_lossy());

        let plan = parse_plan_json(
            r#"{
              "intent": {"summary": "scrape prices", "tags": ["web"]},
              "subtasks": [{
                "id": "t1",
                "title": "scrape",
                "agent": "web-ops",
                "skills": ["web-crawler.md", "missing.md"],
                "depends_on": [],
                "prompt": "scrape sites"
              }]
            }"#,
        )
        .unwrap();
        let result = validate_plan(&conn, plan).unwrap();
        assert_eq!(result.plan.subtasks[0].skills.len(), 1);
        assert!(result.warnings.iter().any(|w| w.contains("missing.md")));
    }

    #[test]
    fn validate_fixture_happy_path() {
        let dir = TempDir::new().unwrap();
        let conn = open_db_at(&dir.path().join("t.db")).unwrap();
        let ws = dir.path().join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        seed_agent(&conn, "web-ops", &ws.to_string_lossy());

        let fixture = include_str!("../../tests/fixtures/plan_valid.json");
        let plan = parse_plan_json(fixture).unwrap();
        let result = validate_plan(&conn, plan).unwrap();
        assert_eq!(result.plan.subtasks.len(), 1);
        assert_eq!(result.plan.subtasks[0].agent, "web-ops");
    }

    #[test]
    fn sanitize_questions_caps_and_drops_invalid() {
        let mut plan = parse_plan_json(
            r#"{
              "intent": {"summary": "x", "tags": []},
              "subtasks": [{"id":"t1","title":"t","agent":"a","skills":[],"depends_on":[],"prompt":"p"}],
              "questions": [
                {"id":"q1","prompt":"Platform?","options":["Web","iOS"]},
                {"id":"q2","prompt":"Bad","options":["only-one"]},
                {"id":"q1","prompt":"dup","options":["A","B"]},
                {"id":"q3","prompt":"Lang?","options":["Rust","Go","TS"]},
                {"id":"q4","prompt":"q4","options":["a","b"]},
                {"id":"q5","prompt":"q5","options":["a","b"]},
                {"id":"q6","prompt":"q6","options":["a","b"]},
                {"id":"q7","prompt":"q7","options":["a","b"]}
              ]
            }"#,
        )
        .unwrap();
        let mut warnings = vec![];
        sanitize_questions(&mut plan, &mut warnings);
        // Valid: q1,q3,q4,q5,q6,q7 (q2 bad options, duplicate q1 dropped) → 6
        assert_eq!(plan.questions.len(), 6);
        assert!(plan.questions.iter().all(|q| q.id != "q2"));
        assert!(warnings.iter().any(|w| w.contains("2–4") || w.contains("duplicate")));
    }

    #[test]
    fn apply_clarifications_appends_block_and_clears_questions() {
        let plan = parse_plan_json(
            r#"{
              "intent": {"summary": "x", "tags": []},
              "subtasks": [{
                "id":"t1","title":"t","agent":"a","skills":[],"depends_on":[],
                "prompt":"Do the thing"
              }],
              "questions": [
                {"id":"q1","prompt":"Platform?","options":["Web","iOS"]}
              ]
            }"#,
        )
        .unwrap();
        let merged = apply_clarifications(
            plan,
            &[PlanClarification {
                question_id: "q1".into(),
                option: "Web".into(),
                note: Some("desktop first".into()),
            }],
        )
        .unwrap();
        assert!(merged.questions.is_empty());
        assert_eq!(merged.clarifications.len(), 1);
        let prompt = merged.subtasks[0].prompt.as_deref().unwrap();
        assert!(prompt.contains("Do the thing"));
        assert!(prompt.contains("用户澄清"));
        assert!(prompt.contains("Web"));
        assert!(prompt.contains("desktop first"));
    }
}
