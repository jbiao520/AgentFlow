//! Overview aggregation IPC — stats, topology, running queue from SQLite.
use crate::db::now_iso8601;
use crate::repo::{list_agents, Agent};
use crate::state::DbState;
use rusqlite::{params, Connection, OptionalExtension};
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
    /// Token usage not tracked in v1 — always "n/a".
    pub tokens_display: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyNode {
    pub id: String,
    pub kind: String, // "orchestrator" | "agent"
    pub label: String,
    pub sublabel: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyEdge {
    pub from_id: String,
    pub to_id: String,
    pub style: String, // "solid" | "dashed"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverviewTopology {
    pub nodes: Vec<TopologyNode>,
    pub edges: Vec<TopologyEdge>,
    pub caption: String,
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

    Ok(OverviewStats {
        agent_count,
        agents_healthy_pct,
        running_tasks,
        completed_today,
        success_rate_today,
        tokens_display: "n/a".into(),
    })
}

fn agent_by_id<'a>(agents: &'a [Agent], id: &str) -> Option<&'a Agent> {
    agents.iter().find(|a| a.id == id)
}

fn recent_collaboration_agent_ids(conn: &Connection) -> Result<(Option<String>, Vec<String>), String> {
    // Prefer an active run; else most recent run with nodes.
    let active_run_id: Option<String> = conn
        .query_row(
            "SELECT id FROM task_runs
             WHERE status IN ('queued', 'running')
             ORDER BY COALESCE(started_at, '') DESC, id DESC
             LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let run_id = if let Some(id) = active_run_id {
        Some(id)
    } else {
        conn.query_row(
            "SELECT id FROM task_runs ORDER BY COALESCE(started_at, finished_at, '') DESC, id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    let Some(run_id) = run_id else {
        return Ok((None, vec![]));
    };

    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT agent_id FROM task_nodes
             WHERE run_id = ?1 AND agent_id IS NOT NULL AND trim(agent_id) != ''
             ORDER BY seq",
        )
        .map_err(|e| e.to_string())?;
    let ids = stmt
        .query_map(params![run_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok((Some(run_id), ids))
}

fn collaboration_edges(
    conn: &Connection,
    run_id: &str,
) -> Result<Vec<(String, String)>, String> {
    // Edges between agents based on depends_on between nodes in the same run.
    let mut stmt = conn
        .prepare(
            "SELECT id, agent_id, depends_on_json FROM task_nodes
             WHERE run_id = ?1 ORDER BY seq",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, Option<String>, Option<String>)> = stmt
        .query_map(params![run_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let id_to_agent: std::collections::HashMap<String, String> = rows
        .iter()
        .filter_map(|(nid, aid, _)| {
            aid.as_ref()
                .filter(|a| !a.trim().is_empty())
                .map(|a| (nid.clone(), a.clone()))
        })
        .collect();

    let mut edges = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (nid, aid, deps_json) in &rows {
        let Some(to_agent) = aid.as_ref().filter(|a| !a.trim().is_empty()) else {
            continue;
        };
        let deps: Vec<String> = deps_json
            .as_ref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        for dep in deps {
            // depends_on may reference node id or seq label — try node id first
            let from_agent = id_to_agent.get(&dep).cloned().or_else(|| {
                // also allow matching by title-less seq keys stored as node ids only
                None
            });
            let Some(from_agent) = from_agent else {
                continue;
            };
            if from_agent == *to_agent {
                continue;
            }
            let key = (from_agent.clone(), to_agent.clone());
            if seen.insert(key.clone()) {
                edges.push(key);
            }
        }
        let _ = nid;
    }
    Ok(edges)
}

pub fn compute_overview_topology(conn: &Connection) -> Result<OverviewTopology, String> {
    let agents = list_agents(conn)?;
    let (run_id, collab_ids) = recent_collaboration_agent_ids(conn)?;

    let mut nodes = vec![TopologyNode {
        id: "orchestrator".into(),
        kind: "orchestrator".into(),
        label: "Dispatch Hub".into(),
        sublabel: "调度中枢".into(),
        status: "idle".into(),
    }];

    for a in &agents {
        nodes.push(TopologyNode {
            id: a.id.clone(),
            kind: "agent".into(),
            label: a.name.clone(),
            sublabel: a.default_cli.clone(),
            status: a.status.clone(),
        });
    }

    let mut edges = Vec::new();
    let collab_set: std::collections::HashSet<&str> =
        collab_ids.iter().map(|s| s.as_str()).collect();

    // Hub → agents involved in current/recent run (or all agents if no run edges)
    let hub_targets: Vec<&Agent> = if collab_ids.is_empty() {
        agents.iter().collect()
    } else {
        agents
            .iter()
            .filter(|a| collab_set.contains(a.id.as_str()))
            .collect()
    };

    for (i, a) in hub_targets.iter().enumerate() {
        edges.push(TopologyEdge {
            from_id: "orchestrator".into(),
            to_id: a.id.clone(),
            style: if i % 2 == 0 {
                "solid".into()
            } else {
                "dashed".into()
            },
        });
    }

    if let Some(rid) = &run_id {
        for (from, to) in collaboration_edges(conn, rid)? {
            // only keep edges between registered agents
            if agent_by_id(&agents, &from).is_some() && agent_by_id(&agents, &to).is_some() {
                edges.push(TopologyEdge {
                    from_id: from,
                    to_id: to,
                    style: "solid".into(),
                });
            }
        }
    }

    let caption = if agents.is_empty() {
        "尚未注册 Agent — 从矩阵导入工作区".into()
    } else if run_id.is_some() && !collab_ids.is_empty() {
        format!("{} 个 Agent 参与近期协作", collab_ids.len())
    } else {
        format!("{} 个已注册 Agent", agents.len())
    };

    Ok(OverviewTopology {
        nodes,
        edges,
        caption,
    })
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
pub fn get_overview_topology(state: State<'_, DbState>) -> Result<OverviewTopology, String> {
    with_db(&state, compute_overview_topology)
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
        AgentUpsert, TaskNodeInsert,
    };
    use crate::repo::{upsert_agent, update_node_status};
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
        assert_eq!(stats.tokens_display, "n/a");

        let queue = compute_running_queue(&conn).unwrap();
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].run_id, run.id);
        assert!(queue[0].goal_prompt.contains("Test goal"));

        let topo = compute_overview_topology(&conn).unwrap();
        assert!(topo.nodes.iter().any(|n| n.kind == "orchestrator"));
        assert_eq!(topo.nodes.iter().filter(|n| n.kind == "agent").count(), 2);
    }

    #[test]
    fn topology_includes_collab_edges_from_depends_on() {
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
                default_cli: "codex".into(),
                status: Some("idle".into()),
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
                    title: "Write".into(),
                    agent_id: Some(b.id.clone()),
                    skill_ids_json: None,
                    cli_engine: Some("codex".into()),
                    model: None,
                    reasoning_effort: None,
                    depends_on_json: Some(r#"["n0"]"#.into()),
                    status: None,
                    artifact_paths_json: None,
                },
            ],
        )
        .unwrap();
        assert_eq!(nodes.len(), 2);
        update_run_progress(&conn, &run.id, 0.2, Some("running")).unwrap();
        let _ = update_node_status(&conn, "n0", "running");

        let topo = compute_overview_topology(&conn).unwrap();
        assert!(
            topo.edges
                .iter()
                .any(|e| e.from_id == a.id && e.to_id == b.id),
            "expected scraper→writer edge, got {:?}",
            topo.edges
        );
    }
}
