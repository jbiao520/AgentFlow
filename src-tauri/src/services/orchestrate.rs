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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanAnalysis {
    pub intent: PlanIntent,
    pub subtasks: Vec<PlanSubtask>,
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

    Ok(ValidatePlanResult { plan, warnings })
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
        r#"You are the AgentMind Orchestrator. Given the user GOAL and the AGENT CATALOG, produce a single JSON plan.

RULES:
- Respond with ONLY a JSON object (no markdown commentary outside optional ```json fences).
- agent field must be an exact agent name from the catalog.
- skills must be relative_path values that exist and are enabled for that agent (or omit).
- depends_on must reference other subtask ids in this plan.
- Include a concrete prompt for each subtask.

GOAL:
{goal}

AGENT CATALOG:
{catalog_json}

OUTPUT SCHEMA:
{{
  "intent": {{ "summary": "...", "tags": ["..."] }},
  "subtasks": [
    {{
      "id": "t1",
      "title": "...",
      "agent": "<catalog name>",
      "skills": ["skill-file.md"],
      "depends_on": [],
      "cli_engine": "cursor-agent|codex|opencode",
      "model": "...",
      "reasoning_effort": "low|medium|high",
      "prompt": "concrete instructions for the agent",
      "artifact_paths": ["relative/path.md"]
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
                relative_path: ".agent/skills/playwright-crawler.md".into(),
                title: Some("Playwright".into()),
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
                "skills": ["playwright-crawler.md", "missing.md"],
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
}
