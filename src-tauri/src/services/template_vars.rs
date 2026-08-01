//! Template variable helpers: placeholders, substitution, structure-lock merge.
use crate::services::orchestrate::{parse_plan_json, plan_to_analysis_json, PlanAnalysis};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TemplateVariable {
    pub key: String,
    pub label: String,
    #[serde(default = "default_true")]
    pub required: bool,
    #[serde(default)]
    pub default: Option<String>,
}

fn default_true() -> bool {
    true
}

pub fn is_valid_var_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Find `{{snake_case}}` placeholders in text.
pub fn collect_placeholders(text: &str) -> HashSet<String> {
    let mut keys = HashSet::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 3 < bytes.len() {
        if bytes[i] == b'{' && bytes[i + 1] == b'{' {
            if let Some(end) = text[i + 2..].find("}}") {
                let key = &text[i + 2..i + 2 + end];
                if is_valid_var_key(key) {
                    keys.insert(key.to_string());
                }
                i += 2 + end + 2;
                continue;
            }
        }
        i += 1;
    }
    keys
}

pub fn collect_plan_placeholders(plan: &PlanAnalysis) -> HashSet<String> {
    let mut keys = collect_placeholders(&plan.intent.summary);
    for st in &plan.subtasks {
        if let Some(p) = &st.prompt {
            keys.extend(collect_placeholders(p));
        }
    }
    keys
}

pub fn parse_variables_json(raw: &str) -> Result<Vec<TemplateVariable>, String> {
    let vars: Vec<TemplateVariable> =
        serde_json::from_str(raw).map_err(|e| format!("variables_json parse error: {e}"))?;
    let mut seen = HashSet::new();
    for v in &vars {
        if !is_valid_var_key(&v.key) {
            return Err(format!(
                "invalid variable key '{}': must match ^[a-z][a-z0-9_]*$",
                v.key
            ));
        }
        if !seen.insert(v.key.clone()) {
            return Err(format!("duplicate variable key '{}'", v.key));
        }
    }
    Ok(vars)
}

pub fn substitute_text(text: &str, values: &HashMap<String, String>) -> Result<String, String> {
    let mut out = String::with_capacity(text.len());
    let mut missing = Vec::new();
    let mut i = 0;
    while i < text.len() {
        if text[i..].starts_with("{{") {
            if let Some(rel) = text[i + 2..].find("}}") {
                let key = &text[i + 2..i + 2 + rel];
                if is_valid_var_key(key) {
                    match values.get(key) {
                        Some(v) => out.push_str(v),
                        None => {
                            missing.push(key.to_string());
                            out.push_str(&text[i..i + 2 + rel + 2]);
                        }
                    }
                    i += 2 + rel + 2;
                    continue;
                }
            }
        }
        let ch = text[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    if !missing.is_empty() {
        missing.sort();
        missing.dedup();
        return Err(format!(
            "missing values for placeholders: {}",
            missing.join(", ")
        ));
    }
    Ok(out)
}

/// Templates lock agent assignment (who runs a subtask), not how that agent runs.
/// Clear snapshotted CLI/model/effort so `validate_plan` rebinds from the
/// agent's *current* `default_cli` / preferred model profile at execute time.
pub fn clear_subtask_runtime_routing(plan: &mut PlanAnalysis) {
    for st in &mut plan.subtasks {
        st.cli_engine = None;
        st.model = None;
        st.reasoning_effort = None;
    }
}

/// Strip frozen CLI/model/effort from a plan JSON string (template save/load).
pub fn strip_runtime_routing_from_plan_json(plan_json: &str) -> Result<String, String> {
    let mut plan = parse_plan_json(plan_json)?;
    clear_subtask_runtime_routing(&mut plan);
    plan_to_analysis_json(&plan)
}

/// Apply variable values to goal prompt + plan prompts (structure unchanged).
/// Also drops snapshotted runtime routing so agent config changes take effect.
pub fn instantiate_texts(
    goal_prompt: &str,
    plan_json: &str,
    values: &HashMap<String, String>,
) -> Result<(String, String), String> {
    let goal = substitute_text(goal_prompt, values)?;
    let mut plan = parse_plan_json(plan_json)?;
    plan.intent.summary = substitute_text(&plan.intent.summary, values)?;
    for st in &mut plan.subtasks {
        if let Some(p) = st.prompt.take() {
            st.prompt = Some(substitute_text(&p, values)?);
        }
    }
    // Agent CLI/model may have changed since the template was saved — rebind later.
    clear_subtask_runtime_routing(&mut plan);
    let out_json = plan_to_analysis_json(&plan)?;
    Ok((goal, out_json))
}

/// Resolve values from declared variables + user map (defaults fill gaps).
pub fn resolve_values(
    declared: &[TemplateVariable],
    provided: &HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    for v in declared {
        if let Some(val) = provided.get(&v.key) {
            let t = val.trim();
            if t.is_empty() {
                if v.required {
                    return Err(format!("required variable '{}' is empty", v.key));
                }
                if let Some(d) = &v.default {
                    out.insert(v.key.clone(), d.clone());
                } else {
                    out.insert(v.key.clone(), String::new());
                }
            } else {
                out.insert(v.key.clone(), t.to_string());
            }
        } else if let Some(d) = &v.default {
            out.insert(v.key.clone(), d.clone());
        } else if v.required {
            return Err(format!("required variable '{}' missing", v.key));
        }
    }
    Ok(out)
}

/// Keep source DAG/routing; take prompt text (and intent.summary) from polished.
pub fn structure_lock_merge(
    source: &PlanAnalysis,
    polished: &PlanAnalysis,
) -> Result<PlanAnalysis, String> {
    let polished_by_id: HashMap<&str, &crate::services::orchestrate::PlanSubtask> = polished
        .subtasks
        .iter()
        .map(|s| (s.id.as_str(), s))
        .collect();

    let mut merged = source.clone();
    merged.intent.summary = polished.intent.summary.clone();
    for st in &mut merged.subtasks {
        if let Some(p) = polished_by_id.get(st.id.as_str()) {
            st.prompt = p.prompt.clone();
        }
    }
    Ok(merged)
}

/// Merge polished plan_json string onto source plan_json with structure lock.
pub fn structure_lock_plan_json(
    source_plan_json: &str,
    polished_plan_json: &str,
) -> Result<String, String> {
    let source = parse_plan_json(source_plan_json)?;
    let polished = parse_plan_json(polished_plan_json)?;
    let merged = structure_lock_merge(&source, &polished)?;
    plan_to_analysis_json(&merged)
}

/// Ensure update plan_json does not change DAG vs existing template plan.
pub fn assert_plan_structure_unchanged(
    existing_plan_json: &str,
    new_plan_json: &str,
) -> Result<String, String> {
    let existing = parse_plan_json(existing_plan_json)?;
    let incoming = parse_plan_json(new_plan_json)?;
    if existing.subtasks.len() != incoming.subtasks.len() {
        return Err("cannot change subtask count on a template".into());
    }
    for (a, b) in existing.subtasks.iter().zip(incoming.subtasks.iter()) {
        if a.id != b.id {
            return Err(format!("cannot change subtask id ({} → {})", a.id, b.id));
        }
        if a.depends_on != b.depends_on {
            return Err(format!("cannot change depends_on for subtask {}", a.id));
        }
        if a.agent != b.agent {
            return Err(format!("cannot change agent for subtask {}", a.id));
        }
        if a.skills != b.skills {
            return Err(format!("cannot change skills for subtask {}", a.id));
        }
    }
    let mut out = structure_lock_merge(&existing, &incoming)?;
    for (st, inc) in out.subtasks.iter_mut().zip(incoming.subtasks.iter()) {
        st.prompt = inc.prompt.clone();
    }
    plan_to_analysis_json(&out)
}

pub fn unknown_placeholders(
    goal_prompt: &str,
    plan_json: &str,
    declared: &[TemplateVariable],
) -> Result<Vec<String>, String> {
    let plan = parse_plan_json(plan_json)?;
    let mut keys = collect_placeholders(goal_prompt);
    keys.extend(collect_plan_placeholders(&plan));
    let declared_keys: HashSet<&str> = declared.iter().map(|v| v.key.as_str()).collect();
    let mut unknown: Vec<String> = keys
        .into_iter()
        .filter(|k| !declared_keys.contains(k.as_str()))
        .collect();
    unknown.sort();
    Ok(unknown)
}

/// Parse polish model output JSON object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolishDraft {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub variables: Vec<TemplateVariable>,
    #[serde(default)]
    pub goal_prompt: String,
    /// May be object or string; normalized to plan JSON string after lock.
    #[serde(alias = "plan_json")]
    pub plan: Value,
}

pub fn parse_polish_draft(raw: &str) -> Result<PolishDraft, String> {
    let text = extract_json_object(raw)?;
    serde_json::from_str(&text).map_err(|e| format!("polish JSON parse error: {e}"))
}

fn extract_json_object(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if serde_json::from_str::<Value>(trimmed).is_ok() {
        return Ok(trimmed.to_string());
    }
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            let slice = &trimmed[start..=end];
            if serde_json::from_str::<Value>(slice).is_ok() {
                return Ok(slice.to_string());
            }
        }
    }
    Err("could not find JSON object in polish output".into())
}

pub fn finalize_polish_draft(
    source_goal: &str,
    source_plan_json: &str,
    draft: PolishDraft,
) -> Result<(String, String, String, Vec<TemplateVariable>, String), String> {
    let plan_json = match draft.plan {
        Value::String(s) => s,
        other => serde_json::to_string(&other).map_err(|e| format!("plan serialize: {e}"))?,
    };
    let locked = structure_lock_plan_json(source_plan_json, &plan_json)?;
    let vars = draft.variables;
    for v in &vars {
        if !is_valid_var_key(&v.key) {
            return Err(format!("invalid polished variable key '{}'", v.key));
        }
    }
    let goal = if draft.goal_prompt.trim().is_empty() {
        source_goal.to_string()
    } else {
        draft.goal_prompt
    };
    let name = if draft.name.trim().is_empty() {
        "未命名模版".to_string()
    } else {
        draft.name.trim().to_string()
    };
    Ok((name, draft.description, goal, vars, locked))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_plan() -> &'static str {
        r#"{
          "intent": {"summary": "Monitor competitor prices", "tags": ["research"]},
          "subtasks": [
            {
              "id": "t1",
              "title": "Collect",
              "agent": "research-collector",
              "skills": ["web"],
              "depends_on": [],
              "prompt": "Collect prices for Acme Corp"
            },
            {
              "id": "t2",
              "title": "Summarize",
              "agent": "writer",
              "skills": [],
              "depends_on": ["t1"],
              "prompt": "Summarize Acme Corp findings"
            }
          ]
        }"#
    }

    #[test]
    fn substitute_and_collect() {
        let keys = collect_placeholders("hello {{topic}} and {{topic}} {{id_1}}");
        assert!(keys.contains("topic"));
        assert!(keys.contains("id_1"));
        let mut vals = HashMap::new();
        vals.insert("topic".into(), "phones".into());
        vals.insert("id_1".into(), "42".into());
        assert_eq!(
            substitute_text("{{topic}}-{{id_1}}", &vals).unwrap(),
            "phones-42"
        );
        assert!(substitute_text("{{missing}}", &vals).is_err());
    }

    #[test]
    fn structure_lock_keeps_dag() {
        let polished = r#"{
          "intent": {"summary": "Monitor {{topic}}", "tags": ["x"]},
          "subtasks": [
            {
              "id": "t1",
              "title": "CHANGED",
              "agent": "other-agent",
              "skills": ["hack"],
              "depends_on": ["t2"],
              "prompt": "Collect prices for {{topic}}"
            },
            {
              "id": "t2",
              "title": "Summarize",
              "agent": "writer",
              "skills": [],
              "depends_on": ["t1"],
              "prompt": "Summarize {{topic}}"
            }
          ]
        }"#;
        let locked = structure_lock_plan_json(sample_plan(), polished).unwrap();
        let plan = parse_plan_json(&locked).unwrap();
        assert_eq!(plan.intent.summary, "Monitor {{topic}}");
        assert_eq!(plan.subtasks[0].agent, "research-collector");
        assert_eq!(plan.subtasks[0].depends_on, Vec::<String>::new());
        assert_eq!(plan.subtasks[0].skills, vec!["web"]);
        assert_eq!(
            plan.subtasks[0].prompt.as_deref(),
            Some("Collect prices for {{topic}}")
        );
        assert_eq!(plan.subtasks[0].title, "Collect");
    }

    #[test]
    fn instantiate_texts_replaces_prompts() {
        let locked = structure_lock_plan_json(
            sample_plan(),
            r#"{
          "intent": {"summary": "Monitor {{topic}}", "tags": []},
          "subtasks": [
            {"id":"t1","title":"Collect","agent":"research-collector","skills":["web"],"depends_on":[],"prompt":"Collect {{topic}}"},
            {"id":"t2","title":"Summarize","agent":"writer","skills":[],"depends_on":["t1"],"prompt":"Sum {{topic}}"}
          ]
        }"#,
        )
        .unwrap();
        let mut vals = HashMap::new();
        vals.insert("topic".into(), "Nike".into());
        let (goal, plan_json) = instantiate_texts("Goal {{topic}}", &locked, &vals).unwrap();
        assert_eq!(goal, "Goal Nike");
        assert!(plan_json.contains("Collect Nike"));
        assert!(!plan_json.contains("{{topic}}"));
    }

    #[test]
    fn instantiate_clears_frozen_cli_and_model() {
        let plan = r#"{
          "intent": {"summary": "Do {{topic}}", "tags": []},
          "subtasks": [
            {
              "id": "t1",
              "title": "Collect",
              "agent": "research-collector",
              "skills": ["web"],
              "depends_on": [],
              "cli_engine": "codex",
              "model": "sol",
              "reasoning_effort": "high",
              "prompt": "Collect {{topic}}"
            }
          ]
        }"#;
        let mut vals = HashMap::new();
        vals.insert("topic".into(), "phones".into());
        let (_goal, out) = instantiate_texts("Goal {{topic}}", plan, &vals).unwrap();
        let parsed = parse_plan_json(&out).unwrap();
        assert!(parsed.subtasks[0].cli_engine.is_none());
        assert!(parsed.subtasks[0].model.is_none());
        assert!(parsed.subtasks[0].reasoning_effort.is_none());
        assert_eq!(
            parsed.subtasks[0].prompt.as_deref(),
            Some("Collect phones")
        );
        // Agent assignment stays locked.
        assert_eq!(parsed.subtasks[0].agent, "research-collector");
    }

    #[test]
    fn strip_runtime_routing_preserves_agent_and_dag() {
        let plan = r#"{
          "intent": {"summary": "s", "tags": []},
          "subtasks": [
            {
              "id": "t1",
              "title": "Collect",
              "agent": "research-collector",
              "skills": ["web"],
              "depends_on": [],
              "cli_engine": "cursor-agent",
              "model": "gpt-5",
              "reasoning_effort": "medium",
              "prompt": "do it"
            }
          ]
        }"#;
        let out = strip_runtime_routing_from_plan_json(plan).unwrap();
        let parsed = parse_plan_json(&out).unwrap();
        assert_eq!(parsed.subtasks[0].agent, "research-collector");
        assert_eq!(parsed.subtasks[0].skills, vec!["web"]);
        assert!(parsed.subtasks[0].cli_engine.is_none());
        assert!(parsed.subtasks[0].model.is_none());
        assert!(parsed.subtasks[0].reasoning_effort.is_none());
    }
}
