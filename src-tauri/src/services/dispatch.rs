//! Dispatch: create TaskRun + DAG nodes from a validated Plan.
use crate::repo::{
    create_task_run, get_plan, insert_task_nodes, list_agents, TaskNode, TaskNodeInsert, TaskRun,
};
use crate::services::orchestrate::{parse_plan_json, PlanAnalysis};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchResult {
    pub run: TaskRun,
    pub nodes: Vec<TaskNode>,
}

pub fn load_plan_analysis(conn: &Connection, plan_id: &str) -> Result<(String, String, PlanAnalysis), String> {
    let plan = get_plan(conn, plan_id)?
        .ok_or_else(|| format!("plan not found: {plan_id}"))?;
    let analysis = parse_plan_json(&plan.analysis_json)
        .map_err(|e| format!("stored plan JSON invalid: {e}"))?;
    Ok((plan.id, plan.goal_id, analysis))
}

/// Create a new run + pending nodes from plan. Prefer new run each dispatch (idempotent re-dispatch).
pub fn dispatch_plan(conn: &Connection, plan_id: &str) -> Result<DispatchResult, String> {
    let (_plan_id, goal_id, analysis) = load_plan_analysis(conn, plan_id)?;
    let agents = list_agents(conn)?;

    let run = create_task_run(conn, &goal_id, plan_id)?;

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
            // Store plan-local depends_on ids; runner remaps via run_id:subtask_id
            depends_on_json: Some(depends_on_json),
            status: Some("pending".into()),
            artifact_paths_json,
        });
    }

    // Remap depends_on to node ids (run_id:subtask_id)
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
        insert.depends_on_json = Some(serde_json::to_string(&mapped).unwrap_or_else(|_| "[]".into()));
    }

    let nodes = insert_task_nodes(conn, &run.id, &inserts)?;
    Ok(DispatchResult { run, nodes })
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
                name: "research-bot".into(),
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
                agent_id: agent.id,
                relative_path: ".agent/skills/notes.md".into(),
                title: None,
                description: None,
                enabled: Some(true),
                content_hash: None,
            }],
        )
        .unwrap();

        let fixture = include_str!("../../tests/fixtures/plan_dag.json");
        let analysis = crate::services::orchestrate::parse_plan_json(fixture).unwrap();
        let goal = create_goal(&conn, "pipeline", None).unwrap();
        let plan = save_plan(
            &conn,
            &goal.id,
            &plan_to_analysis_json(&analysis).unwrap(),
        )
        .unwrap();

        let result = dispatch_plan(&conn, &plan.id).unwrap();
        assert_eq!(result.nodes.len(), 2);
        assert_eq!(result.nodes[0].status, "pending");
        assert_eq!(result.nodes[1].status, "pending");

        let deps: Vec<String> =
            serde_json::from_str(result.nodes[1].depends_on_json.as_deref().unwrap()).unwrap();
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0], result.nodes[0].id);

        // Re-dispatch creates another run
        let again = dispatch_plan(&conn, &plan.id).unwrap();
        assert_ne!(again.run.id, result.run.id);
        assert_eq!(again.nodes.len(), 2);
    }
}
