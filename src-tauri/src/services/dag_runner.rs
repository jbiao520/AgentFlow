//! DAG runner: execute ready nodes with depends_on (success-only), concurrency 1 default.
use crate::engines::adapter::{EngineRunRequest, LogEvent};
use crate::engines::runner::{run_engine_unchecked, validate_imported_workspace, CancelToken};
use crate::repo::{
    append_task_log, get_agent, get_plan, get_task_node, get_task_run, set_node_artifact_paths,
    update_node_status, update_run_progress, TaskLogAppend, TaskNode, TaskRun,
};
use crate::services::orchestrate::{parse_plan_json, PlanSubtask};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const DEFAULT_CONCURRENCY: usize = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskLogEvent {
    pub run_id: String,
    pub node_id: Option<String>,
    pub ts: String,
    pub agent_name: Option<String>,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRunUpdatedEvent {
    pub run: TaskRun,
    pub nodes: Vec<TaskNode>,
}

fn parse_deps(node: &TaskNode) -> Vec<String> {
    node.depends_on_json
        .as_ref()
        .and_then(|j| serde_json::from_str(j).ok())
        .unwrap_or_default()
}

/// Dependency satisfied only if predecessor status == success.
pub fn deps_satisfied(node: &TaskNode, by_id: &HashMap<String, TaskNode>) -> bool {
    parse_deps(node).iter().all(|dep| {
        by_id
            .get(dep)
            .map(|n| n.status == "success")
            .unwrap_or(false)
    })
}

pub fn ready_nodes(nodes: &[TaskNode]) -> Vec<TaskNode> {
    let by_id: HashMap<String, TaskNode> =
        nodes.iter().cloned().map(|n| (n.id.clone(), n)).collect();
    nodes
        .iter()
        .filter(|n| n.status == "pending" && deps_satisfied(n, &by_id))
        .cloned()
        .collect()
}

fn progress_of(nodes: &[TaskNode]) -> f64 {
    if nodes.is_empty() {
        return 1.0;
    }
    let finished = nodes
        .iter()
        .filter(|n| matches!(n.status.as_str(), "success" | "failed" | "skipped"))
        .count();
    finished as f64 / nodes.len() as f64
}

fn subtask_for_node<'a>(
    analysis_subtasks: &'a [PlanSubtask],
    node: &TaskNode,
    run_id: &str,
) -> Option<&'a PlanSubtask> {
    let prefix = format!("{run_id}:");
    let local_id = node.id.strip_prefix(&prefix).unwrap_or(node.id.as_str());
    analysis_subtasks.iter().find(|s| s.id == local_id)
}

fn emit_run_updated(app: &AppHandle, conn: &Connection, run_id: &str) {
    if let Ok(Some(full)) = get_task_run(conn, run_id) {
        let _ = app.emit(
            "task-run-updated",
            TaskRunUpdatedEvent {
                run: full.run,
                nodes: full.nodes,
            },
        );
    }
}

fn persist_log(
    conn: &Connection,
    app: &AppHandle,
    run_id: &str,
    node_id: Option<&str>,
    agent_name: Option<&str>,
    level: &str,
    message: &str,
) {
    if message.is_empty() {
        return;
    }
    match append_task_log(
        conn,
        TaskLogAppend {
            run_id: run_id.to_string(),
            node_id: node_id.map(|s| s.to_string()),
            agent_name: agent_name.map(|s| s.to_string()),
            level: level.to_string(),
            message: message.to_string(),
        },
    ) {
        Ok(log) => {
            let _ = app.emit(
                "task-log",
                TaskLogEvent {
                    run_id: log.run_id,
                    node_id: log.node_id,
                    ts: log.ts,
                    agent_name: log.agent_name,
                    level: log.level,
                    message: log.message,
                },
            );
        }
        Err(_) => {}
    }
}

fn extract_artifact_marker(line: &str) -> Option<String> {
    const MARKER: &str = "AGENTMIND_ARTIFACT:";
    line.find(MARKER).map(|i| line[i + MARKER.len()..].trim().to_string())
}

/// Execute node with Arc Mutex DB for log persistence during stream.
pub fn execute_node_with_db(
    db: &Arc<Mutex<Connection>>,
    app: &AppHandle,
    run_id: &str,
    node_id: &str,
    cancel: &CancelToken,
) -> Result<bool, String> {
    let (agent_name, req, artifacts, prompt_title) = {
        let conn = db.lock().map_err(|e| format!("db lock: {e}"))?;
        let node = get_task_node(&conn, node_id)?
            .ok_or_else(|| format!("node not found: {node_id}"))?;
        let full = get_task_run(&conn, run_id)?
            .ok_or_else(|| format!("run not found: {run_id}"))?;
        let plan = get_plan(&conn, &full.run.plan_id)?
            .ok_or_else(|| format!("plan not found: {}", full.run.plan_id))?;
        let analysis = parse_plan_json(&plan.analysis_json).unwrap_or_else(|_| {
            crate::services::orchestrate::PlanAnalysis {
                intent: crate::services::orchestrate::PlanIntent {
                    summary: String::new(),
                    tags: vec![],
                },
                subtasks: vec![],
            }
        });
        let subtask = subtask_for_node(&analysis.subtasks, &node, run_id);

        let agent_id = node
            .agent_id
            .as_ref()
            .ok_or_else(|| format!("node {node_id} missing agent_id"))?;
        let agent = get_agent(&conn, agent_id)?
            .ok_or_else(|| format!("agent not found: {agent_id}"))?;
        let engine = node
            .cli_engine
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| agent.default_cli.clone());
        let cwd = validate_imported_workspace(&conn, &agent.workspace_path)?;
        let prompt = subtask
            .and_then(|s| s.prompt.clone())
            .filter(|p| !p.trim().is_empty())
            .unwrap_or_else(|| node.title.clone());
        let skills_hint = subtask
            .map(|s| s.skills.join(", "))
            .unwrap_or_default();
        let full_prompt = if skills_hint.is_empty() {
            prompt
        } else {
            format!("{prompt}\n\nEnabled skills: {skills_hint}")
        };
        let artifacts = subtask
            .map(|s| s.artifact_paths.clone())
            .unwrap_or_default();
        let prompt_title = node.title.clone();

        update_node_status(&conn, node_id, "running")?;
        emit_run_updated(app, &conn, run_id);
        persist_log(
            &conn,
            app,
            run_id,
            Some(node_id),
            Some(&agent.name),
            "info",
            &format!("starting node: {}", node.title),
        );

        let req = EngineRunRequest {
            engine,
            cwd,
            prompt: full_prompt,
            model: node.model.clone().filter(|m| !m.trim().is_empty()),
            reasoning: node
                .reasoning_effort
                .clone()
                .filter(|r| !r.trim().is_empty()),
            extra_args: vec![],
            env: HashMap::new(),
        };
        (agent.name.clone(), req, artifacts, prompt_title)
    }; // DB unlocked before spawn

    let db_log = Arc::clone(db);
    let app_log = app.clone();
    let run_id_owned = run_id.to_string();
    let node_id_owned = node_id.to_string();
    let agent_name_log = agent_name.clone();
    let artifacts_buf = Arc::new(Mutex::new(artifacts));
    let artifacts_for_cb = Arc::clone(&artifacts_buf);

    let run_result = run_engine_unchecked(&req, cancel, move |ev: LogEvent| {
        if let Some(path) = extract_artifact_marker(&ev.line) {
            if !path.is_empty() {
                if let Ok(mut arts) = artifacts_for_cb.lock() {
                    if !arts.contains(&path) {
                        arts.push(path);
                    }
                }
            }
        }
        let level = if ev.stream == "stderr" { "warn" } else { "info" };
        if let Ok(conn) = db_log.lock() {
            persist_log(
                &conn,
                &app_log,
                &run_id_owned,
                Some(&node_id_owned),
                Some(&agent_name_log),
                level,
                &ev.line,
            );
        }
    });

    let artifacts = artifacts_buf.lock().map(|g| g.clone()).unwrap_or_default();
    let conn = db.lock().map_err(|e| format!("db lock: {e}"))?;

    if !artifacts.is_empty() {
        let json = serde_json::to_string(&artifacts).unwrap_or_else(|_| "[]".into());
        let _ = set_node_artifact_paths(&conn, node_id, &json);
    }

    match run_result {
        Ok(0) => {
            update_node_status(&conn, node_id, "success")?;
            persist_log(
                &conn,
                app,
                run_id,
                Some(node_id),
                Some(&agent_name),
                "info",
                &format!("node success: {prompt_title}"),
            );
            emit_run_updated(app, &conn, run_id);
            Ok(true)
        }
        Ok(code) => {
            update_node_status(&conn, node_id, "failed")?;
            persist_log(
                &conn,
                app,
                run_id,
                Some(node_id),
                Some(&agent_name),
                "error",
                &format!("node failed exit_code={code}"),
            );
            emit_run_updated(app, &conn, run_id);
            Ok(false)
        }
        Err(e) => {
            update_node_status(&conn, node_id, "failed")?;
            persist_log(
                &conn,
                app,
                run_id,
                Some(node_id),
                Some(&agent_name),
                "error",
                &format!("node error: {e}"),
            );
            emit_run_updated(app, &conn, run_id);
            if cancel.is_cancelled() {
                Err(e)
            } else {
                Ok(false)
            }
        }
    }
}

/// Main DAG loop. Runs until no pending/running work or cancelled.
pub fn run_dag_loop(
    db: Arc<Mutex<Connection>>,
    app: AppHandle,
    run_id: String,
    cancel: CancelToken,
    concurrency: usize,
) -> Result<TaskRun, String> {
    let concurrency = concurrency.max(1);

    {
        let conn = db.lock().map_err(|e| format!("db lock: {e}"))?;
        update_run_progress(&conn, &run_id, 0.0, Some("running"))?;
        emit_run_updated(&app, &conn, &run_id);
    }

    loop {
        if cancel.is_cancelled() {
            let conn = db.lock().map_err(|e| format!("db lock: {e}"))?;
            let full = get_task_run(&conn, &run_id)?.ok_or("run missing")?;
            let run = update_run_progress(
                &conn,
                &run_id,
                progress_of(&full.nodes),
                Some("cancelled"),
            )?;
            emit_run_updated(&app, &conn, &run_id);
            return Ok(run);
        }

        let (ready, nodes, any_running, any_pending) = {
            let conn = db.lock().map_err(|e| format!("db lock: {e}"))?;
            let full = get_task_run(&conn, &run_id)?
                .ok_or_else(|| format!("run not found: {run_id}"))?;
            let any_running = full.nodes.iter().any(|n| n.status == "running");
            let any_pending = full.nodes.iter().any(|n| n.status == "pending");
            let ready = ready_nodes(&full.nodes);
            (ready, full.nodes, any_running, any_pending)
        };

        if !any_pending && !any_running {
            let conn = db.lock().map_err(|e| format!("db lock: {e}"))?;
            let any_failed = nodes.iter().any(|n| n.status == "failed");
            let status = if any_failed { "failed" } else { "success" };
            let run = update_run_progress(&conn, &run_id, progress_of(&nodes), Some(status))?;
            emit_run_updated(&app, &conn, &run_id);
            return Ok(run);
        }

        // If nothing ready and nothing running but pending remain → blocked (failed/skipped deps)
        if ready.is_empty() && !any_running && any_pending {
            let conn = db.lock().map_err(|e| format!("db lock: {e}"))?;
            let run = update_run_progress(&conn, &run_id, progress_of(&nodes), Some("failed"))?;
            persist_log(
                &conn,
                &app,
                &run_id,
                None,
                None,
                "error",
                "no ready nodes; remaining pending blocked by unsuccessful deps",
            );
            emit_run_updated(&app, &conn, &run_id);
            return Ok(run);
        }

        let slots = concurrency.saturating_sub(
            nodes.iter().filter(|n| n.status == "running").count(),
        );
        let batch: Vec<TaskNode> = ready.into_iter().take(slots).collect();

        if batch.is_empty() {
            thread::sleep(Duration::from_millis(80));
            continue;
        }

        // concurrency 1 default: execute sequentially in this loop iteration
        for node in batch {
            if cancel.is_cancelled() {
                break;
            }
            let _ = execute_node_with_db(&db, &app, &run_id, &node.id, &cancel);
            let conn = db.lock().map_err(|e| format!("db lock: {e}"))?;
            if let Ok(Some(full)) = get_task_run(&conn, &run_id) {
                let _ = update_run_progress(
                    &conn,
                    &run_id,
                    progress_of(&full.nodes),
                    Some("running"),
                );
                emit_run_updated(&app, &conn, &run_id);
            }
        }
    }
}

/// Resume after retry: set run to running if it was failed/success terminal with pending nodes.
pub fn ensure_run_resumable(conn: &Connection, run_id: &str) -> Result<TaskRun, String> {
    let full = get_task_run(conn, run_id)?
        .ok_or_else(|| format!("run not found: {run_id}"))?;
    if full.nodes.iter().any(|n| n.status == "pending" || n.status == "running") {
        update_run_progress(conn, run_id, progress_of(&full.nodes), Some("running"))
    } else {
        Ok(full.run)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, status: &str, deps: &[&str]) -> TaskNode {
        TaskNode {
            id: id.into(),
            run_id: "r".into(),
            seq: 0,
            title: id.into(),
            agent_id: None,
            skill_ids_json: None,
            cli_engine: None,
            model: None,
            reasoning_effort: None,
            depends_on_json: Some(serde_json::to_string(deps).unwrap()),
            status: status.into(),
            started_at: None,
            finished_at: None,
            artifact_paths_json: None,
            retry_count: 0,
        }
    }

    #[test]
    fn ready_requires_success_deps_not_skipped() {
        let nodes = vec![
            node("a", "skipped", &[]),
            node("b", "pending", &["a"]),
            node("c", "success", &[]),
            node("d", "pending", &["c"]),
        ];
        let ready = ready_nodes(&nodes);
        let ids: Vec<_> = ready.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains(&"d"));
        assert!(!ids.contains(&"b"), "skipped predecessor must block dependents");
    }

    #[test]
    #[ignore = "e2e: requires live CLI + imported agent workspaces; run via UI Dispatch"]
    fn e2e_dag_runner_note() {
        // Documented ignored e2e — live verification via Task Center UI.
    }
}
