//! Recover orphaned task runs left in queued/running after process exit.
use crate::db::now_iso8601;
use crate::repo::{append_task_log, update_node_status, update_run_progress, TaskLogAppend};
use rusqlite::{params, Connection};

/// Mark any queued/running runs as cancelled and settle their nodes.
/// Safe to call at app startup — there is no in-memory runner after restart.
pub fn interrupt_orphaned_runs(conn: &Connection) -> Result<usize, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id FROM task_runs WHERE status IN ('queued', 'running') ORDER BY started_at",
        )
        .map_err(|e| e.to_string())?;
    let run_ids: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut count = 0usize;
    for run_id in &run_ids {
        finalize_interrupted_run(
            conn,
            run_id,
            "run interrupted: application restarted while task was still active",
        )?;
        count += 1;
    }
    Ok(count)
}

/// Settle a single run that has no active in-memory runner (cancel or orphan).
pub fn finalize_interrupted_run(
    conn: &Connection,
    run_id: &str,
    reason: &str,
) -> Result<(), String> {
    let node_ids: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, status FROM task_nodes WHERE run_id = ?1 AND status IN ('pending', 'running')",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![run_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    for (node_id, status) in &node_ids {
        let next = if status == "running" { "failed" } else { "skipped" };
        update_node_status(conn, node_id, next)?;
    }

    let progress: f64 = conn
        .query_row(
            "SELECT CASE WHEN COUNT(*) = 0 THEN 1.0
                        ELSE CAST(SUM(CASE WHEN status IN ('success','failed','skipped') THEN 1 ELSE 0 END) AS REAL) / COUNT(*)
                   END
             FROM task_nodes WHERE run_id = ?1",
            params![run_id],
            |r| r.get(0),
        )
        .unwrap_or(1.0);

    update_run_progress(conn, run_id, progress, Some("cancelled"))?;

    let _ = append_task_log(
        conn,
        TaskLogAppend {
            run_id: run_id.to_string(),
            node_id: None,
            agent_name: None,
            level: "warn".into(),
            message: format!("{reason} ({})", now_iso8601()),
        },
    );

    Ok(())
}

/// Mark pending → skipped and running → failed for an in-flight cancel.
pub fn settle_nodes_on_cancel(conn: &Connection, run_id: &str) -> Result<(), String> {
    finalize_interrupted_run(conn, run_id, "run cancelled by user")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_db_at;
    use crate::repo::{
        create_goal, create_task_run, get_task_run, insert_task_nodes, save_plan, TaskNodeInsert,
    };
    use tempfile::TempDir;

    #[test]
    fn interrupt_marks_orphaned_run_cancelled() {
        let dir = TempDir::new().unwrap();
        let conn = open_db_at(&dir.path().join("t.db")).unwrap();
        let goal = create_goal(&conn, "g", None).unwrap();
        let plan = save_plan(&conn, &goal.id, r#"{"intent":{"summary":"s","tags":[]},"subtasks":[]}"#).unwrap();
        let run = create_task_run(&conn, &goal.id, &plan.id).unwrap();
        update_run_progress(&conn, &run.id, 0.0, Some("running")).unwrap();
        let _ = insert_task_nodes(
            &conn,
            &run.id,
            &[
                TaskNodeInsert {
                    id: Some(format!("{}:a", run.id)),
                    seq: 0,
                    title: "a".into(),
                    agent_id: None,
                    skill_ids_json: None,
                    cli_engine: None,
                    model: None,
                    reasoning_effort: None,
                    depends_on_json: None,
                    status: Some("running".into()),
                    artifact_paths_json: None,
                },
                TaskNodeInsert {
                    id: Some(format!("{}:b", run.id)),
                    seq: 1,
                    title: "b".into(),
                    agent_id: None,
                    skill_ids_json: None,
                    cli_engine: None,
                    model: None,
                    reasoning_effort: None,
                    depends_on_json: None,
                    status: Some("pending".into()),
                    artifact_paths_json: None,
                },
            ],
        )
        .unwrap();

        let n = interrupt_orphaned_runs(&conn).unwrap();
        assert_eq!(n, 1);
        let full = get_task_run(&conn, &run.id).unwrap().unwrap();
        assert_eq!(full.run.status, "cancelled");
        assert_eq!(full.nodes[0].status, "failed");
        assert_eq!(full.nodes[1].status, "skipped");
    }
}
