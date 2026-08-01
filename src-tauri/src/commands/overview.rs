//! Overview aggregation IPC — stats, recent agents usage, running queue from SQLite.
use crate::db::{format_unix_as_iso8601, now_iso8601, now_unix};
use crate::repo::usage::UsageBreakdown;
use crate::repo::{list_agents, summarize_node_usage, Agent};
use crate::state::DbState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

fn with_db<T, F>(state: &State<'_, DbState>, f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    let conn = state
        .conn
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    f(&conn)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverviewStats {
    pub agent_count: i64,
    pub agents_healthy_pct: f64,
    pub running_tasks: i64,
    pub completed_today: i64,
    pub success_rate_today: f64,
    /// All-time tokens reported by CLI streams, grouped by engine/provider/model.
    pub tokens_total: u64,
    /// Sum of real (opencode) + estimated (codex / cursor-agent) cost in USD.
    pub tokens_cost: Option<f64>,
    pub usage_breakdown: Vec<UsageBreakdown>,
}

/// Agent ranked by recent task-node assignments (calls).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentAgentUsage {
    pub agent_id: String,
    pub name: String,
    pub default_cli: String,
    pub status: String,
    pub calls_1d: i64,
    pub calls_7d: i64,
    pub calls_30d: i64,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub run_id: String,
    pub goal_prompt: String,
    pub status: String,
    pub progress: f64,
    pub agent_names: Vec<String>,
    pub cli_engines: Vec<String>,
    pub node_count: i64,
    pub started_at: Option<String>,
    pub elapsed_label: String,
}

fn today_prefix() -> String {
    // now_iso8601 is `YYYY-MM-DDTHH:MM:SSZ`
    now_iso8601().chars().take(10).collect()
}

fn is_agent_healthy(agent: &Agent) -> bool {
    let ws_ok = std::path::Path::new(&agent.workspace_path).is_dir();
    let cli_ok = crate::services::cli_probe::resolve_engine_binary(&agent.default_cli).is_some();
    ws_ok && cli_ok
}

pub fn compute_overview_stats(conn: &Connection) -> Result<OverviewStats, String> {
    let agents = list_agents(conn)?;
    let agent_count = agents.len() as i64;
    let healthy = agents.iter().filter(|a| is_agent_healthy(a)).count() as i64;
    let agents_healthy_pct = if agent_count == 0 {
        100.0
    } else {
        (healthy as f64 / agent_count as f64) * 100.0
    };

    let running_tasks: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM task_runs WHERE status IN ('queued', 'running')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let today = today_prefix();
    let completed_today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM task_runs
             WHERE status = 'success'
               AND finished_at IS NOT NULL
               AND substr(finished_at, 1, 10) = ?1",
            params![today],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let finished_today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM task_runs
             WHERE status IN ('success', 'failed')
               AND finished_at IS NOT NULL
               AND substr(finished_at, 1, 10) = ?1",
            params![today],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let success_rate_today = if finished_today == 0 {
        100.0
    } else {
        (completed_today as f64 / finished_today as f64) * 100.0
    };

    let usage = summarize_node_usage(conn)?;
    let tokens_total: u64 = usage.iter().map(|u| u.total_tokens).sum();
    let cost_sum: f64 = usage.iter().filter_map(|u| u.cost).sum();
    let tokens_cost = if cost_sum > 0.0 { Some(cost_sum) } else { None };

    Ok(OverviewStats {
        agent_count,
        agents_healthy_pct,
        running_tasks,
        completed_today,
        success_rate_today,
        tokens_total,
        tokens_cost,
        usage_breakdown: usage,
    })
}

fn agent_by_id<'a>(agents: &'a [Agent], id: &str) -> Option<&'a Agent> {
    agents.iter().find(|a| a.id == id)
}

/// Event time for a task node assignment — prefer node timestamps, fall back to run.
const NODE_EVENT_TS: &str =
    "COALESCE(n.started_at, n.finished_at, r.started_at, r.finished_at)";

/// Top recently-used agents by task-node assignment counts in 1d / 7d / 30d windows.
pub fn compute_recent_agents(
    conn: &Connection,
    limit: usize,
) -> Result<Vec<RecentAgentUsage>, String> {
    let now = now_unix();
    let cut_1d = format_unix_as_iso8601(now.saturating_sub(86_400));
    let cut_7d = format_unix_as_iso8601(now.saturating_sub(7 * 86_400));
    let cut_30d = format_unix_as_iso8601(now.saturating_sub(30 * 86_400));

    let sql = format!(
        "SELECT n.agent_id,
                MAX({ts}) AS last_used_at,
                SUM(CASE WHEN {ts} >= ?1 THEN 1 ELSE 0 END) AS calls_1d,
                SUM(CASE WHEN {ts} >= ?2 THEN 1 ELSE 0 END) AS calls_7d,
                SUM(CASE WHEN {ts} >= ?3 THEN 1 ELSE 0 END) AS calls_30d
         FROM task_nodes n
         INNER JOIN task_runs r ON r.id = n.run_id
         WHERE n.agent_id IS NOT NULL AND trim(n.agent_id) != ''
           AND {ts} IS NOT NULL
           AND {ts} >= ?3
         GROUP BY n.agent_id
         ORDER BY calls_7d DESC, calls_30d DESC, last_used_at DESC
         LIMIT ?4",
        ts = NODE_EVENT_TS
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let lim = limit.max(1) as i64;
    let rows: Vec<(String, Option<String>, i64, i64, i64)> = stmt
        .query_map(params![cut_1d, cut_7d, cut_30d, lim], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let agents = list_agents(conn)?;
    let mut out = Vec::new();
    for (agent_id, last_used_at, calls_1d, calls_7d, calls_30d) in rows {
        let Some(a) = agent_by_id(&agents, &agent_id) else {
            // Soft-deleted or unknown agent — skip from "recent"
            continue;
        };
        out.push(RecentAgentUsage {
            agent_id,
            name: a.name.clone(),
            default_cli: a.default_cli.clone(),
            status: a.status.clone(),
            calls_1d,
            calls_7d,
            calls_30d,
            last_used_at,
        });
    }
    Ok(out)
}

fn format_elapsed(started_at: Option<&str>) -> String {
    let Some(started) = started_at else {
        return "—".into();
    };
    // Parse `YYYY-MM-DDTHH:MM:SSZ` roughly
    let parts: Vec<&str> = started.trim_end_matches('Z').split('T').collect();
    if parts.len() != 2 {
        return "—".into();
    }
    let date = parts[0];
    let time = parts[1];
    let dp: Vec<&str> = date.split('-').collect();
    let tp: Vec<&str> = time.split(':').collect();
    if dp.len() != 3 || tp.len() < 2 {
        return "—".into();
    }
    let Ok(y) = dp[0].parse::<i64>() else {
        return "—".into();
    };
    let Ok(mo) = dp[1].parse::<i64>() else {
        return "—".into();
    };
    let Ok(d) = dp[2].parse::<i64>() else {
        return "—".into();
    };
    let Ok(h) = tp[0].parse::<i64>() else {
        return "—".into();
    };
    let Ok(mi) = tp[1].parse::<i64>() else {
        return "—".into();
    };
    let s = tp.get(2).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0);

    // Approximate seconds since epoch (enough for elapsed display)
    let start_secs =
        (((y - 1970) * 365 + (y - 1969) / 4) + days_before_month(mo, y) + (d - 1)) * 86400
            + h * 3600
            + mi * 60
            + s;

    let now = now_iso8601();
    let now_parts: Vec<&str> = now.trim_end_matches('Z').split('T').collect();
    if now_parts.len() != 2 {
        return "—".into();
    }
    let nd: Vec<&str> = now_parts[0].split('-').collect();
    let nt: Vec<&str> = now_parts[1].split(':').collect();
    if nd.len() != 3 || nt.len() < 2 {
        return "—".into();
    }
    let Ok(ny) = nd[0].parse::<i64>() else {
        return "—".into();
    };
    let Ok(nmo) = nd[1].parse::<i64>() else {
        return "—".into();
    };
    let Ok(nday) = nd[2].parse::<i64>() else {
        return "—".into();
    };
    let Ok(nh) = nt[0].parse::<i64>() else {
        return "—".into();
    };
    let Ok(nmi) = nt[1].parse::<i64>() else {
        return "—".into();
    };
    let ns = nt.get(2).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0);
    let now_secs =
        (((ny - 1970) * 365 + (ny - 1969) / 4) + days_before_month(nmo, ny) + (nday - 1)) * 86400
            + nh * 3600
            + nmi * 60
            + ns;

    let elapsed = (now_secs - start_secs).max(0);
    let mins = elapsed / 60;
    let secs = elapsed % 60;
    if mins >= 60 {
        let hrs = mins / 60;
        let m = mins % 60;
        format!("{hrs:02}h {m:02}m")
    } else {
        format!("{mins:02}m {secs:02}s")
    }
}

fn days_before_month(month: i64, year: i64) -> i64 {
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut total = 0;
    for m in 1..month {
        total += days[m as usize];
        if m == 2 && leap {
            total += 1;
        }
    }
    total
}

pub fn compute_running_queue(conn: &Connection) -> Result<Vec<QueueItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT r.id, r.status, r.progress, r.started_at, g.prompt
             FROM task_runs r
             JOIN goals g ON g.id = r.goal_id
             WHERE r.status IN ('queued', 'running')
             ORDER BY COALESCE(r.started_at, '') DESC, r.id DESC
             LIMIT 20",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, f64, Option<String>, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let agents = list_agents(conn)?;
    let mut items = Vec::new();

    for (run_id, status, progress, started_at, prompt) in rows {
        let mut node_stmt = conn
            .prepare(
                "SELECT agent_id, cli_engine FROM task_nodes WHERE run_id = ?1 ORDER BY seq",
            )
            .map_err(|e| e.to_string())?;
        let node_rows: Vec<(Option<String>, Option<String>)> = node_stmt
            .query_map(params![run_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let node_count = node_rows.len() as i64;
        let mut agent_names = Vec::new();
        let mut seen_agents = std::collections::HashSet::new();
        let mut cli_engines = Vec::new();
        let mut seen_cli = std::collections::HashSet::new();

        for (aid, cli) in &node_rows {
            if let Some(id) = aid {
                if seen_agents.insert(id.clone()) {
                    let name = agent_by_id(&agents, id)
                        .map(|a| a.name.clone())
                        .unwrap_or_else(|| id.clone());
                    agent_names.push(name);
                }
            }
            if let Some(c) = cli {
                let c = c.trim();
                if !c.is_empty() && seen_cli.insert(c.to_string()) {
                    cli_engines.push(c.to_string());
                }
            }
        }

        items.push(QueueItem {
            run_id,
            goal_prompt: prompt,
            status,
            progress,
            agent_names,
            cli_engines,
            node_count,
            started_at: started_at.clone(),
            elapsed_label: format_elapsed(started_at.as_deref()),
        });
    }

    Ok(items)
}

#[tauri::command]
pub fn get_overview_stats(state: State<'_, DbState>) -> Result<OverviewStats, String> {
    with_db(&state, compute_overview_stats)
}

#[tauri::command]
pub fn list_recent_agents(state: State<'_, DbState>) -> Result<Vec<RecentAgentUsage>, String> {
    with_db(&state, |conn| compute_recent_agents(conn, 8))
}

#[tauri::command]
pub fn list_running_queue(state: State<'_, DbState>) -> Result<Vec<QueueItem>, String> {
    with_db(&state, compute_running_queue)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_db_at;
    use crate::repo::{
        create_goal, create_task_run, insert_task_nodes, save_plan, update_run_progress,
        AgentUpsert, NodeUsageInsert, TaskNodeInsert,
    };
    use crate::repo::{record_node_usage, upsert_agent, update_node_status};
    use tempfile::TempDir;

    #[test]
    fn overview_stats_counts_with_fixture_db() {
        let dir = TempDir::new().unwrap();
        let conn = open_db_at(&dir.path().join("t.db")).unwrap();
        let ws_ok = dir.path().join("ws-ok");
        let ws_bad = dir.path().join("ws-missing-never");
        std::fs::create_dir_all(&ws_ok).unwrap();

        upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "alpha".into(),
                description: None,
                workspace_path: ws_ok.to_string_lossy().into(),
                git_url: None,
                default_cli: "codex".into(),
                status: Some("idle".into()),
            },
        )
        .unwrap();
        upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "beta".into(),
                description: None,
                workspace_path: ws_bad.to_string_lossy().into(),
                git_url: None,
                default_cli: "cursor-agent".into(),
                status: Some("error".into()),
            },
        )
        .unwrap();

        let goal = create_goal(&conn, "Test goal", None).unwrap();
        let plan = save_plan(&conn, &goal.id, r#"{"intent":{},"subtasks":[]}"#).unwrap();
        let run = create_task_run(&conn, &goal.id, &plan.id).unwrap();
        update_run_progress(&conn, &run.id, 0.5, Some("running")).unwrap();

        let goal2 = create_goal(&conn, "Done goal", None).unwrap();
        let plan2 = save_plan(&conn, &goal2.id, r#"{"intent":{},"subtasks":[]}"#).unwrap();
        let run2 = create_task_run(&conn, &goal2.id, &plan2.id).unwrap();
        update_run_progress(&conn, &run2.id, 1.0, Some("success")).unwrap();

        let stats = compute_overview_stats(&conn).unwrap();
        assert_eq!(stats.agent_count, 2);
        // Health = workspace dir exists AND CLI binary resolvable.
        let alpha_healthy = crate::services::cli_probe::resolve_engine_binary("codex").is_some();
        let expected_pct = if alpha_healthy { 50.0 } else { 0.0 };
        assert!(
            (stats.agents_healthy_pct - expected_pct).abs() < 0.01,
            "got {} expected {}",
            stats.agents_healthy_pct,
            expected_pct
        );
        assert_eq!(stats.running_tasks, 1);
        assert_eq!(stats.completed_today, 1);
        assert!((stats.success_rate_today - 100.0).abs() < 0.01);
        assert_eq!(stats.tokens_total, 0);
        assert!(stats.tokens_cost.is_none());
        assert!(stats.usage_breakdown.is_empty());

        let queue = compute_running_queue(&conn).unwrap();
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].run_id, run.id);
        assert!(queue[0].goal_prompt.contains("Test goal"));

        // No task_nodes with agents → empty recent list
        let recent = compute_recent_agents(&conn, 8).unwrap();
        assert!(recent.is_empty());
    }

    #[test]
    fn overview_usage_breakdown_aggregates_by_model() {
        let dir = TempDir::new().unwrap();
        let conn = open_db_at(&dir.path().join("t.db")).unwrap();

        let goal = create_goal(&conn, "Usage", None).unwrap();
        let plan = save_plan(&conn, &goal.id, "{}").unwrap();
        let run = create_task_run(&conn, &goal.id, &plan.id).unwrap();
        let nodes = insert_task_nodes(
            &conn,
            &run.id,
            &[TaskNodeInsert {
                id: Some("n0".into()),
                seq: 0,
                title: "Work".into(),
                agent_id: None,
                skill_ids_json: None,
                cli_engine: Some("codex".into()),
                model: Some("gpt-5.4".into()),
                reasoning_effort: None,
                depends_on_json: Some("[]".into()),
                status: None,
                artifact_paths_json: None,
            }],
        )
        .unwrap();

        record_node_usage(
            &conn,
            &NodeUsageInsert {
                run_id: run.id.clone(),
                node_id: nodes[0].id.clone(),
                engine: "codex".into(),
                provider: "openai".into(),
                model: Some("gpt-5.4".into()),
                input_tokens: 100,
                cached_input_tokens: 10,
                cache_write_input_tokens: 0,
                output_tokens: 50,
                reasoning_tokens: 20,
                cost: Some(0.001),
                estimated: false,
            },
        )
        .unwrap();

        let stats = compute_overview_stats(&conn).unwrap();
        assert_eq!(stats.tokens_total, 170);
        assert_eq!(stats.usage_breakdown.len(), 1);
        let b = &stats.usage_breakdown[0];
        assert_eq!(b.provider, "openai");
        assert_eq!(b.model, "gpt-5.4");
        assert_eq!(b.engine, "codex");
        assert_eq!(b.total_tokens, 170);
        assert!((b.cost.unwrap() - 0.001).abs() < 1e-9);
        assert!(stats.tokens_cost.is_some());
    }

    #[test]
    fn recent_agents_counts_calls_by_window() {
        let dir = TempDir::new().unwrap();
        let conn = open_db_at(&dir.path().join("t.db")).unwrap();

        let a = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "scraper".into(),
                description: None,
                workspace_path: "/tmp/s".into(),
                git_url: None,
                default_cli: "codex".into(),
                status: Some("idle".into()),
            },
        )
        .unwrap();
        let b = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "writer".into(),
                description: None,
                workspace_path: "/tmp/w".into(),
                git_url: None,
                default_cli: "opencode".into(),
                status: Some("working".into()),
            },
        )
        .unwrap();

        let goal = create_goal(&conn, "Collab", None).unwrap();
        let plan = save_plan(&conn, &goal.id, "{}").unwrap();
        let run = create_task_run(&conn, &goal.id, &plan.id).unwrap();
        let nodes = insert_task_nodes(
            &conn,
            &run.id,
            &[
                TaskNodeInsert {
                    id: Some("n0".into()),
                    seq: 0,
                    title: "Scrape".into(),
                    agent_id: Some(a.id.clone()),
                    skill_ids_json: None,
                    cli_engine: Some("codex".into()),
                    model: None,
                    reasoning_effort: None,
                    depends_on_json: Some("[]".into()),
                    status: None,
                    artifact_paths_json: None,
                },
                TaskNodeInsert {
                    id: Some("n1".into()),
                    seq: 1,
                    title: "Write A".into(),
                    agent_id: Some(b.id.clone()),
                    skill_ids_json: None,
                    cli_engine: Some("opencode".into()),
                    model: None,
                    reasoning_effort: None,
                    depends_on_json: Some(r#"["n0"]"#.into()),
                    status: None,
                    artifact_paths_json: None,
                },
                TaskNodeInsert {
                    id: Some("n2".into()),
                    seq: 2,
                    title: "Write B".into(),
                    agent_id: Some(b.id.clone()),
                    skill_ids_json: None,
                    cli_engine: Some("opencode".into()),
                    model: None,
                    reasoning_effort: None,
                    depends_on_json: Some(r#"["n1"]"#.into()),
                    status: None,
                    artifact_paths_json: None,
                },
            ],
        )
        .unwrap();
        assert_eq!(nodes.len(), 3);
        update_run_progress(&conn, &run.id, 0.2, Some("running")).unwrap();
        let _ = update_node_status(&conn, "n0", "running");
        let _ = update_node_status(&conn, "n1", "running");
        let _ = update_node_status(&conn, "n2", "running");

        let recent = compute_recent_agents(&conn, 8).unwrap();
        assert_eq!(recent.len(), 2, "expected both agents, got {:?}", recent);
        // writer has 2 nodes → should rank first by calls_7d
        assert_eq!(recent[0].agent_id, b.id);
        assert_eq!(recent[0].name, "writer");
        assert_eq!(recent[0].calls_1d, 2);
        assert_eq!(recent[0].calls_7d, 2);
        assert_eq!(recent[0].calls_30d, 2);
        assert_eq!(recent[1].agent_id, a.id);
        assert_eq!(recent[1].calls_1d, 1);
        assert!(recent[0].last_used_at.is_some());
    }
}
