use crate::db::now_iso8601;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    pub id: String,
    pub prompt: String,
    pub template_key: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub goal_id: String,
    pub analysis_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRun {
    pub id: String,
    pub goal_id: String,
    pub plan_id: String,
    pub status: String,
    pub progress: f64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRunWithNodes {
    pub run: TaskRun,
    pub nodes: Vec<TaskNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNode {
    pub id: String,
    pub run_id: String,
    pub seq: i64,
    pub title: String,
    pub agent_id: Option<String>,
    pub skill_ids_json: Option<String>,
    pub cli_engine: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub depends_on_json: Option<String>,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub artifact_paths_json: Option<String>,
    pub retry_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNodeInsert {
    pub id: Option<String>,
    pub seq: i64,
    pub title: String,
    pub agent_id: Option<String>,
    pub skill_ids_json: Option<String>,
    pub cli_engine: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub depends_on_json: Option<String>,
    pub status: Option<String>,
    pub artifact_paths_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskLog {
    pub id: String,
    pub run_id: String,
    pub node_id: Option<String>,
    pub ts: String,
    pub agent_name: Option<String>,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskLogAppend {
    pub run_id: String,
    pub node_id: Option<String>,
    pub agent_name: Option<String>,
    pub level: String,
    pub message: String,
}

fn map_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRun> {
    Ok(TaskRun {
        id: row.get(0)?,
        goal_id: row.get(1)?,
        plan_id: row.get(2)?,
        status: row.get(3)?,
        progress: row.get(4)?,
        started_at: row.get(5)?,
        finished_at: row.get(6)?,
        error: row.get(7)?,
    })
}

fn map_node(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskNode> {
    Ok(TaskNode {
        id: row.get(0)?,
        run_id: row.get(1)?,
        seq: row.get(2)?,
        title: row.get(3)?,
        agent_id: row.get(4)?,
        skill_ids_json: row.get(5)?,
        cli_engine: row.get(6)?,
        model: row.get(7)?,
        reasoning_effort: row.get(8)?,
        depends_on_json: row.get(9)?,
        status: row.get(10)?,
        started_at: row.get(11)?,
        finished_at: row.get(12)?,
        artifact_paths_json: row.get(13)?,
        retry_count: row.get(14)?,
    })
}

pub fn create_goal(
    conn: &Connection,
    prompt: &str,
    template_key: Option<&str>,
) -> Result<Goal, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("goal prompt must not be empty".into());
    }
    let id = Uuid::new_v4().to_string();
    let created_at = now_iso8601();
    conn.execute(
        "INSERT INTO goals (id, prompt, template_key, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, prompt, template_key, created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(Goal {
        id,
        prompt: prompt.to_string(),
        template_key: template_key.map(|s| s.to_string()),
        created_at,
    })
}

pub fn save_plan(conn: &Connection, goal_id: &str, analysis_json: &str) -> Result<Plan, String> {
    let exists: bool = conn
        .query_row("SELECT 1 FROM goals WHERE id = ?1", [goal_id], |_| Ok(true))
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if !exists {
        return Err(format!("goal not found: {goal_id}"));
    }
    if analysis_json.trim().is_empty() {
        return Err("analysis_json must not be empty".into());
    }
    let id = Uuid::new_v4().to_string();
    let created_at = now_iso8601();
    conn.execute(
        "INSERT INTO plans (id, goal_id, analysis_json, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, goal_id, analysis_json, created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(Plan {
        id,
        goal_id: goal_id.to_string(),
        analysis_json: analysis_json.to_string(),
        created_at,
    })
}

pub fn create_task_run(conn: &Connection, goal_id: &str, plan_id: &str) -> Result<TaskRun, String> {
    let goal_ok: bool = conn
        .query_row("SELECT 1 FROM goals WHERE id = ?1", [goal_id], |_| Ok(true))
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if !goal_ok {
        return Err(format!("goal not found: {goal_id}"));
    }
    let plan_ok: bool = conn
        .query_row(
            "SELECT 1 FROM plans WHERE id = ?1 AND goal_id = ?2",
            params![plan_id, goal_id],
            |_| Ok(true),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if !plan_ok {
        return Err(format!("plan not found for goal: {plan_id}"));
    }
    let id = Uuid::new_v4().to_string();
    let started_at = now_iso8601();
    conn.execute(
        "INSERT INTO task_runs (id, goal_id, plan_id, status, progress, started_at, finished_at, error)
         VALUES (?1, ?2, ?3, 'queued', 0, ?4, NULL, NULL)",
        params![id, goal_id, plan_id, started_at],
    )
    .map_err(|e| e.to_string())?;
    get_task_run(conn, &id)?
        .map(|r| r.run)
        .ok_or_else(|| "run missing after create".into())
}

pub fn insert_task_nodes(
    conn: &Connection,
    run_id: &str,
    nodes: &[TaskNodeInsert],
) -> Result<Vec<TaskNode>, String> {
    let run_ok: bool = conn
        .query_row("SELECT 1 FROM task_runs WHERE id = ?1", [run_id], |_| Ok(true))
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if !run_ok {
        return Err(format!("task run not found: {run_id}"));
    }
    let mut out = Vec::with_capacity(nodes.len());
    for n in nodes {
        let title = n.title.trim();
        if title.is_empty() {
            return Err("task node title must not be empty".into());
        }
        let id = n
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let status = n
            .status
            .clone()
            .unwrap_or_else(|| "pending".into());
        conn.execute(
            "INSERT INTO task_nodes (
                id, run_id, seq, title, agent_id, skill_ids_json, cli_engine, model,
                reasoning_effort, depends_on_json, status, started_at, finished_at,
                artifact_paths_json, retry_count
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, NULL, ?12, 0)",
            params![
                id,
                run_id,
                n.seq,
                title,
                n.agent_id,
                n.skill_ids_json,
                n.cli_engine,
                n.model,
                n.reasoning_effort,
                n.depends_on_json,
                status,
                n.artifact_paths_json
            ],
        )
        .map_err(|e| e.to_string())?;
        out.push(
            conn.query_row(
                "SELECT id, run_id, seq, title, agent_id, skill_ids_json, cli_engine, model,
                        reasoning_effort, depends_on_json, status, started_at, finished_at,
                        artifact_paths_json, retry_count
                 FROM task_nodes WHERE id = ?1",
                [&id],
                map_node,
            )
            .map_err(|e| e.to_string())?,
        );
    }
    Ok(out)
}

pub fn list_task_runs(conn: &Connection, limit: i64) -> Result<Vec<TaskRun>, String> {
    let limit = if limit <= 0 { 50 } else { limit.min(500) };
    let mut stmt = conn
        .prepare(
            "SELECT id, goal_id, plan_id, status, progress, started_at, finished_at, error
             FROM task_runs ORDER BY started_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit], map_run)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn get_task_run(conn: &Connection, id: &str) -> Result<Option<TaskRunWithNodes>, String> {
    let run = conn
        .query_row(
            "SELECT id, goal_id, plan_id, status, progress, started_at, finished_at, error
             FROM task_runs WHERE id = ?1",
            [id],
            map_run,
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(run) = run else {
        return Ok(None);
    };
    let mut stmt = conn
        .prepare(
            "SELECT id, run_id, seq, title, agent_id, skill_ids_json, cli_engine, model,
                    reasoning_effort, depends_on_json, status, started_at, finished_at,
                    artifact_paths_json, retry_count
             FROM task_nodes WHERE run_id = ?1 ORDER BY seq",
        )
        .map_err(|e| e.to_string())?;
    let nodes = stmt
        .query_map([&run.id], map_node)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Some(TaskRunWithNodes { run, nodes }))
}

pub fn update_node_status(
    conn: &Connection,
    node_id: &str,
    status: &str,
) -> Result<TaskNode, String> {
    let status = status.trim();
    match status {
        "pending" | "running" | "success" | "failed" | "skipped" => {}
        _ => {
            return Err(format!(
                "invalid node status '{status}'; expected pending|running|success|failed|skipped"
            ))
        }
    }
    let now = now_iso8601();
    match status {
        "running" => {
            conn.execute(
                "UPDATE task_nodes SET status = ?1, started_at = COALESCE(started_at, ?2) WHERE id = ?3",
                params![status, now, node_id],
            )
            .map_err(|e| e.to_string())?;
        }
        "success" | "failed" | "skipped" => {
            conn.execute(
                "UPDATE task_nodes SET status = ?1, finished_at = ?2,
                 started_at = COALESCE(started_at, ?2) WHERE id = ?3",
                params![status, now, node_id],
            )
            .map_err(|e| e.to_string())?;
        }
        _ => {
            conn.execute(
                "UPDATE task_nodes SET status = ?1 WHERE id = ?2",
                params![status, node_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    conn.query_row(
        "SELECT id, run_id, seq, title, agent_id, skill_ids_json, cli_engine, model,
                reasoning_effort, depends_on_json, status, started_at, finished_at,
                artifact_paths_json, retry_count
         FROM task_nodes WHERE id = ?1",
        [node_id],
        map_node,
    )
    .map_err(|e| format!("node not found or update failed: {e}"))
}

pub fn append_task_log(conn: &Connection, entry: TaskLogAppend) -> Result<TaskLog, String> {
    if entry.run_id.trim().is_empty() {
        return Err("run_id must not be empty".into());
    }
    if entry.message.is_empty() {
        return Err("log message must not be empty".into());
    }
    let level = if entry.level.trim().is_empty() {
        "info".to_string()
    } else {
        entry.level.trim().to_string()
    };
    let id = Uuid::new_v4().to_string();
    let ts = now_iso8601();
    conn.execute(
        "INSERT INTO task_logs (id, run_id, node_id, ts, agent_name, level, message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            entry.run_id,
            entry.node_id,
            ts,
            entry.agent_name,
            level,
            entry.message
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(TaskLog {
        id,
        run_id: entry.run_id,
        node_id: entry.node_id,
        ts,
        agent_name: entry.agent_name,
        level,
        message: entry.message,
    })
}

pub fn list_task_logs(
    conn: &Connection,
    run_id: &str,
    agent_filter: Option<&str>,
) -> Result<Vec<TaskLog>, String> {
    let mut sql = String::from(
        "SELECT id, run_id, node_id, ts, agent_name, level, message
         FROM task_logs WHERE run_id = ?1",
    );
    if agent_filter.map(|s| !s.is_empty()).unwrap_or(false) {
        sql.push_str(" AND agent_name = ?2");
        sql.push_str(" ORDER BY ts, id");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![run_id, agent_filter.unwrap()], |row| {
                Ok(TaskLog {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    node_id: row.get(2)?,
                    ts: row.get(3)?,
                    agent_name: row.get(4)?,
                    level: row.get(5)?,
                    message: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        return Ok(rows);
    }
    sql.push_str(" ORDER BY ts, id");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([run_id], |row| {
            Ok(TaskLog {
                id: row.get(0)?,
                run_id: row.get(1)?,
                node_id: row.get(2)?,
                ts: row.get(3)?,
                agent_name: row.get(4)?,
                level: row.get(5)?,
                message: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn update_run_progress(
    conn: &Connection,
    run_id: &str,
    progress: f64,
    status: Option<&str>,
) -> Result<TaskRun, String> {
    if !(0.0..=1.0).contains(&progress) && !(0.0..=100.0).contains(&progress) {
        return Err("progress must be between 0 and 1 (or 0–100)".into());
    }
    let progress = if progress > 1.0 {
        progress / 100.0
    } else {
        progress
    };

    if let Some(status) = status {
        let status = status.trim();
        match status {
            "queued" | "running" | "success" | "failed" | "cancelled" => {}
            _ => {
                return Err(format!(
                    "invalid run status '{status}'; expected queued|running|success|failed|cancelled"
                ))
            }
        }
        let now = now_iso8601();
        match status {
            "success" | "failed" | "cancelled" => {
                conn.execute(
                    "UPDATE task_runs SET progress = ?1, status = ?2, finished_at = ?3 WHERE id = ?4",
                    params![progress, status, now, run_id],
                )
                .map_err(|e| e.to_string())?;
            }
            "running" => {
                conn.execute(
                    "UPDATE task_runs SET progress = ?1, status = ?2,
                     started_at = COALESCE(started_at, ?3) WHERE id = ?4",
                    params![progress, status, now, run_id],
                )
                .map_err(|e| e.to_string())?;
            }
            _ => {
                conn.execute(
                    "UPDATE task_runs SET progress = ?1, status = ?2 WHERE id = ?3",
                    params![progress, status, run_id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    } else {
        let n = conn
            .execute(
                "UPDATE task_runs SET progress = ?1 WHERE id = ?2",
                params![progress, run_id],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("task run not found: {run_id}"));
        }
    }

    get_task_run(conn, run_id)?
        .map(|r| r.run)
        .ok_or_else(|| format!("task run not found: {run_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_db_at;
    use tempfile::TempDir;

    #[test]
    fn goal_plan_run_nodes_log_roundtrip() {
        let dir = TempDir::new().unwrap();
        let conn = open_db_at(&dir.path().join("t.db")).unwrap();

        let goal = create_goal(&conn, "Ship persistence", Some("quick")).unwrap();
        let plan = save_plan(
            &conn,
            &goal.id,
            r#"{"intent":{"summary":"persist"},"subtasks":[]}"#,
        )
        .unwrap();
        let run = create_task_run(&conn, &goal.id, &plan.id).unwrap();
        assert_eq!(run.status, "queued");

        let nodes = insert_task_nodes(
            &conn,
            &run.id,
            &[
                TaskNodeInsert {
                    id: None,
                    seq: 0,
                    title: "Scan skills".into(),
                    agent_id: None,
                    skill_ids_json: Some("[]".into()),
                    cli_engine: Some("codex".into()),
                    model: Some("sol".into()),
                    reasoning_effort: Some("medium".into()),
                    depends_on_json: Some("[]".into()),
                    status: None,
                    artifact_paths_json: None,
                },
                TaskNodeInsert {
                    id: None,
                    seq: 1,
                    title: "Write summary".into(),
                    agent_id: None,
                    skill_ids_json: None,
                    cli_engine: None,
                    model: None,
                    reasoning_effort: None,
                    depends_on_json: Some(r#"["t0"]"#.into()),
                    status: Some("pending".into()),
                    artifact_paths_json: None,
                },
            ],
        )
        .unwrap();
        assert_eq!(nodes.len(), 2);

        let updated = update_node_status(&conn, &nodes[0].id, "running").unwrap();
        assert_eq!(updated.status, "running");
        assert!(updated.started_at.is_some());

        let log = append_task_log(
            &conn,
            TaskLogAppend {
                run_id: run.id.clone(),
                node_id: Some(nodes[0].id.clone()),
                agent_name: Some("orchestrator".into()),
                level: "info".into(),
                message: "started".into(),
            },
        )
        .unwrap();
        assert_eq!(log.message, "started");

        let logs = list_task_logs(&conn, &run.id, Some("orchestrator")).unwrap();
        assert_eq!(logs.len(), 1);

        let progress = update_run_progress(&conn, &run.id, 0.5, Some("running")).unwrap();
        assert_eq!(progress.status, "running");
        assert!((progress.progress - 0.5).abs() < f64::EPSILON);

        let listed = list_task_runs(&conn, 10).unwrap();
        assert_eq!(listed.len(), 1);

        let full = get_task_run(&conn, &run.id).unwrap().unwrap();
        assert_eq!(full.nodes.len(), 2);
        assert_eq!(full.run.id, run.id);
    }
}
