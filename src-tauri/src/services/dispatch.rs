//! Dispatch: create TaskRun + DAG nodes from a validated Plan.
use crate::repo::{
    create_task_run, get_plan, insert_task_nodes, list_agents, TaskNode, TaskNodeInsert, TaskRun,
};
use crate::services::orchestrate::{
    parse_plan_json, preflight_for_dispatch, validate_plan, PlanAnalysis,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchResult {
    pub run: TaskRun,
    pub nodes: Vec<TaskNode>,
}

pub fn load_plan_analysis(
    conn: &Connection,
    plan_id: &str,
) -> Result<(String, String, PlanAnalysis), String> {
    let plan = get_plan(conn, plan_id)?.ok_or_else(|| format!("plan not found: {plan_id}"))?;
    let analysis = parse_plan_json(&plan.analysis_json)
        .map_err(|e| format!("stored plan JSON invalid: {e}"))?;
    Ok((plan.id, plan.goal_id, analysis))
}

/// Create a new run + pending nodes from plan. Prefer new run each dispatch (idempotent re-dispatch).
pub fn dispatch_plan(conn: &Connection, plan_id: &str) -> Result<DispatchResult, String> {
    let (_plan_id, goal_id, analysis) = load_plan_analysis(conn, plan_id)?;

    // Re-validate structural constraints + hard runtime preflight before any writes.
    let validated = validate_plan(conn, analysis)?;
    let _ = preflight_for_dispatch(&validated.plan)?;
    let analysis = validated.plan;
    let agents = list_agents(conn)?;

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("begin dispatch transaction: {e}"))?;

    let built = (|| -> Result<DispatchResult, String> {
        let run = create_task_run(&tx, &goal_id, plan_id)?;

        let mut inserts = Vec::with_capacity(analysis.subtasks.len());
        for (seq, st) in analysis.subtasks.iter().enumerate() {
            let agent = agents
                .iter()
                .find(|a| a.name == st.agent)
                .ok_or_else(|| format!("agent missing at dispatch: {}", st.agent))?;

            let skill_ids_json = serde_json::to_string(&st.skills).unwrap_or_else(|_| "[]".into());
            let depends_on_json =
                serde_json::to_string(&st.depends_on).unwrap_or_else(|_| "[]".into());
            let artifact_paths_json = if st.artifact_paths.is_empty() {
                None
            } else {
                Some(serde_json::to_string(&st.artifact_paths).unwrap_or_else(|_| "[]".into()))
            };

            inserts.push(TaskNodeInsert {
                id: Some(format!("{}:{}", run.id, st.id)),
                seq: seq as i64,
                title: st.title.clone(),
                agent_id: Some(agent.id.clone()),
                skill_ids_json: Some(skill_ids_json),
                cli_engine: st.cli_engine.clone(),
                model: st.model.clone(),
                reasoning_effort: st.reasoning_effort.clone(),
                depends_on_json: Some(depends_on_json),
                status: Some("pending".into()),
                artifact_paths_json,
            });
        }

        for insert in &mut inserts {
            let deps: Vec<String> = insert
                .depends_on_json
                .as_ref()
                .and_then(|j| serde_json::from_str(j).ok())
                .unwrap_or_default();
            let mapped: Vec<String> = deps
                .into_iter()
                .map(|d| format!("{}:{}", run.id, d))
                .collect();
            insert.depends_on_json =
                Some(serde_json::to_string(&mapped).unwrap_or_else(|_| "[]".into()));
        }

        let nodes = insert_task_nodes(&tx, &run.id, &inserts)?;
        Ok(DispatchResult { run, nodes })
    })();

    match built {
        Ok(result) => {
            tx.commit()
                .map_err(|e| format!("commit dispatch transaction: {e}"))?;
            Ok(result)
        }
        Err(e) => {
            let _ = tx.rollback();
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_db_at;
    use crate::repo::{
        create_goal, save_plan, upsert_agent, upsert_skills_many, AgentUpsert, SkillUpsert,
    };
    use crate::services::orchestrate::plan_to_analysis_json;
    use tempfile::TempDir;

    #[test]
    fn dispatch_fixture_plan_creates_n_nodes() {
        let dir = TempDir::new().unwrap();
        let conn = open_db_at(&dir.path().join("t.db")).unwrap();
        let ws = dir.path().join("ws");
        std::fs::create_dir_all(&ws).unwrap();

        let agent = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "web-ops".into(),
                description: None,
                workspace_path: ws.to_string_lossy().into(),
                git_url: None,
                default_cli: "codex".into(),
                status: None,
            },
        )
        .unwrap();
        upsert_skills_many(
            &conn,
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

        let fixture = include_str!("../../tests/fixtures/plan_valid.json");
        let mut analysis = parse_plan_json(fixture).unwrap();
        // Avoid live model-catalog requirement in unit tests.
        for st in &mut analysis.subtasks {
            st.model = None;
        }
        let goal = create_goal(&conn, "g", None).unwrap();
        let json = plan_to_analysis_json(&analysis).unwrap();
        let plan = save_plan(&conn, &goal.id, &json).unwrap();

        if crate::services::cli_probe::resolve_engine_binary("codex").is_none() {
            // Structural validate still works; dispatch preflight needs CLI.
            let _ = validate_plan(&conn, analysis).unwrap();
            return;
        }

        let result = dispatch_plan(&conn, &plan.id).unwrap();
        assert_eq!(result.nodes.len(), 1);
        let again = dispatch_plan(&conn, &plan.id).unwrap();
        assert_ne!(result.run.id, again.run.id);
    }
}
