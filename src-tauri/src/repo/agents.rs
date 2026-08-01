use crate::db::now_iso8601;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub workspace_path: String,
    pub git_url: Option<String>,
    pub default_cli: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    /// Set (non-NULL) for soft-deleted agents. Kept so historical runs/DAGs
    /// that reference the id can still resolve the row.
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentUpsert {
    pub id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub workspace_path: String,
    pub git_url: Option<String>,
    pub default_cli: String,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentModelProfile {
    pub agent_id: String,
    pub preferred_model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub engine_options_json: Option<String>,
}

fn map_agent(row: &rusqlite::Row<'_>) -> rusqlite::Result<Agent> {
    Ok(Agent {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        workspace_path: row.get(3)?,
        git_url: row.get(4)?,
        default_cli: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        deleted_at: row.get(9)?,
    })
}

pub fn list_agents(conn: &Connection) -> Result<Vec<Agent>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, workspace_path, git_url, default_cli, status, created_at, updated_at, deleted_at
             FROM agents WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([], map_agent)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Derive Working from active DAG nodes (persisted status alone is never updated at runtime).
    let working: std::collections::HashSet<String> = {
        let mut wstmt = conn
            .prepare(
                "SELECT DISTINCT agent_id FROM task_nodes
                 WHERE status = 'running' AND agent_id IS NOT NULL AND agent_id != ''",
            )
            .map_err(|e| e.to_string())?;
        let rows = wstmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<std::collections::HashSet<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    for agent in &mut rows {
        if working.contains(&agent.id) {
            agent.status = "working".into();
        } else if matches!(agent.status.to_lowercase().as_str(), "working" | "running") {
            agent.status = "idle".into();
        }
    }
    Ok(rows)
}

pub fn get_agent(conn: &Connection, id: &str) -> Result<Option<Agent>, String> {
    conn.query_row(
        "SELECT id, name, description, workspace_path, git_url, default_cli, status, created_at, updated_at, deleted_at
         FROM agents WHERE id = ?1",
        [id],
        map_agent,
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn upsert_agent(conn: &Connection, input: AgentUpsert) -> Result<Agent, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("agent name must not be empty".into());
    }
    let workspace_path = input.workspace_path.trim().to_string();
    if workspace_path.is_empty() {
        return Err("workspace_path must not be empty".into());
    }
    let default_cli = input.default_cli.trim().to_string();
    if default_cli.is_empty() {
        return Err("default_cli must not be empty".into());
    }
    let status = input
        .status
        .unwrap_or_else(|| "idle".into())
        .trim()
        .to_string();
    let now = now_iso8601();

    let id = if let Some(ref existing_id) = input.id {
        // Update existing
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM agents WHERE id = ?1",
                [existing_id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        if !exists {
            return Err(format!("agent not found: {existing_id}"));
        }
        // Unique name check excluding self (and soft-deleted rows)
        let conflict: Option<String> = conn
            .query_row(
                "SELECT id FROM agents WHERE name = ?1 AND id != ?2 AND deleted_at IS NULL",
                params![name, existing_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if conflict.is_some() {
            return Err(format!("agent name already exists: {name}"));
        }
        conn.execute(
            "UPDATE agents SET name=?1, description=?2, workspace_path=?3, git_url=?4,
             default_cli=?5, status=?6, deleted_at=NULL, updated_at=?7 WHERE id=?8",
            params![
                name,
                input.description,
                workspace_path,
                input.git_url,
                default_cli,
                status,
                now,
                existing_id
            ],
        )
        .map_err(|e| e.to_string())?;
        existing_id.clone()
    } else {
        // If a soft-deleted row owns this name, revive it (same id) so
        // historical runs/DAGs that reference the id keep resolving.
        let existing: Option<(String, Option<String>)> = conn
            .query_row(
                "SELECT id, deleted_at FROM agents WHERE name = ?1",
                [&name],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let id = match existing {
            Some((existing_id, Some(_))) => {
                conn.execute(
                    "UPDATE agents SET name=?1, description=?2, workspace_path=?3, git_url=?4,
                     default_cli=?5, status=?6, deleted_at=NULL, updated_at=?7 WHERE id=?8",
                    params![
                        name,
                        input.description,
                        workspace_path,
                        input.git_url,
                        default_cli,
                        status,
                        now,
                        existing_id
                    ],
                )
                .map_err(|e| e.to_string())?;
                existing_id
            }
            Some(_) => return Err(format!("agent name already exists: {name}")),
            None => {
                let id = Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO agents (id, name, description, workspace_path, git_url, default_cli, status, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        id,
                        name,
                        input.description,
                        workspace_path,
                        input.git_url,
                        default_cli,
                        status,
                        now,
                        now
                    ],
                )
                .map_err(|e| e.to_string())?;
                id
            }
        };
        id
    };

    get_agent(conn, &id)?.ok_or_else(|| "agent missing after upsert".into())
}

/// Soft-delete an agent (tombstone). The row is kept so historical
/// task_nodes / runs that reference the id still resolve for display.
pub fn delete_agent(conn: &Connection, id: &str) -> Result<(), String> {
    let n = conn
        .execute(
            "UPDATE agents SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now_iso8601(), id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("agent not found: {id}"));
    }
    Ok(())
}

pub fn get_agent_profile(
    conn: &Connection,
    agent_id: &str,
) -> Result<Option<AgentModelProfile>, String> {
    // temperature / auto_route columns remain in SQLite but are unused dead fields.
    conn.query_row(
        "SELECT agent_id, preferred_model, reasoning_effort, engine_options_json
         FROM agent_model_profiles WHERE agent_id = ?1",
        [agent_id],
        |row| {
            Ok(AgentModelProfile {
                agent_id: row.get(0)?,
                preferred_model: row.get(1)?,
                reasoning_effort: row.get(2)?,
                engine_options_json: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn upsert_agent_profile(
    conn: &Connection,
    profile: AgentModelProfile,
) -> Result<AgentModelProfile, String> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM agents WHERE id = ?1",
            [&profile.agent_id],
            |_| Ok(true),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if !exists {
        return Err(format!("agent not found: {}", profile.agent_id));
    }
    // Leave temperature/auto_route at schema defaults; do not update them.
    conn.execute(
        "INSERT INTO agent_model_profiles (agent_id, preferred_model, reasoning_effort, engine_options_json)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(agent_id) DO UPDATE SET
           preferred_model=excluded.preferred_model,
           reasoning_effort=excluded.reasoning_effort,
           engine_options_json=excluded.engine_options_json",
        params![
            profile.agent_id,
            profile.preferred_model,
            profile.reasoning_effort,
            profile.engine_options_json
        ],
    )
    .map_err(|e| e.to_string())?;
    get_agent_profile(conn, &profile.agent_id)?
        .ok_or_else(|| "profile missing after upsert".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_db_at;
    use tempfile::TempDir;

    fn test_conn() -> (TempDir, Connection) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.db");
        let conn = open_db_at(&path).unwrap();
        (dir, conn)
    }

    #[test]
    fn insert_agent_and_list() {
        let (_dir, conn) = test_conn();
        let agent = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "web-ops".into(),
                description: Some("desc".into()),
                workspace_path: "/tmp/ws".into(),
                git_url: None,
                default_cli: "codex".into(),
                status: None,
            },
        )
        .unwrap();
        assert!(!agent.id.is_empty());
        let list = list_agents(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "web-ops");
    }

    #[test]
    fn profile_upsert_and_unique_name() {
        let (_dir, conn) = test_conn();
        let agent = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "a1".into(),
                description: None,
                workspace_path: "/ws".into(),
                git_url: None,
                default_cli: "cursor-agent".into(),
                status: None,
            },
        )
        .unwrap();
        let profile = upsert_agent_profile(
            &conn,
            AgentModelProfile {
                agent_id: agent.id.clone(),
                preferred_model: Some("sol".into()),
                reasoning_effort: Some("high".into()),
                engine_options_json: Some("{}".into()),
            },
        )
        .unwrap();
        assert_eq!(profile.preferred_model.as_deref(), Some("sol"));
        assert_eq!(profile.reasoning_effort.as_deref(), Some("high"));

        let err = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "a1".into(),
                description: None,
                workspace_path: "/other".into(),
                git_url: None,
                default_cli: "codex".into(),
                status: None,
            },
        )
        .unwrap_err();
        assert!(err.contains("already exists"));
    }

    #[test]
    fn delete_is_soft_and_revives_on_reimport() {
        let (_dir, conn) = test_conn();
        let agent = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "soft".into(),
                description: None,
                workspace_path: "/ws".into(),
                git_url: None,
                default_cli: "codex".into(),
                status: None,
            },
        )
        .unwrap();
        upsert_agent_profile(
            &conn,
            AgentModelProfile {
                agent_id: agent.id.clone(),
                preferred_model: Some("m".into()),
                reasoning_effort: None,
                engine_options_json: None,
            },
        )
        .unwrap();

        delete_agent(&conn, &agent.id).unwrap();
        // Hidden from the live list, but the row + profile stay resolvable
        // so historical runs/DAGs still render.
        assert!(list_agents(&conn).unwrap().is_empty());
        assert!(get_agent(&conn, &agent.id).unwrap().is_some());
        assert!(get_agent_profile(&conn, &agent.id).unwrap().is_some());

        // Re-importing the same name revives the SAME id → history keeps resolving.
        let revived = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "soft".into(),
                description: None,
                workspace_path: "/ws2".into(),
                git_url: None,
                default_cli: "opencode".into(),
                status: None,
            },
        )
        .unwrap();
        assert_eq!(revived.id, agent.id);
        assert_eq!(list_agents(&conn).unwrap().len(), 1);
        assert!(get_agent(&conn, &agent.id).unwrap().is_some());

        // Deleting a missing id errors.
        assert!(delete_agent(&conn, "no-such-id").unwrap_err().contains("not found"));
        // Re-deleting the revived agent works again.
        delete_agent(&conn, &agent.id).unwrap();
        assert!(list_agents(&conn).unwrap().is_empty());
    }

    #[test]
    fn delete_does_not_touch_other_agents() {
        let (_dir, conn) = test_conn();
        let a = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "keep".into(),
                description: None,
                workspace_path: "/ws".into(),
                git_url: None,
                default_cli: "codex".into(),
                status: None,
            },
        )
        .unwrap();
        let b = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "drop".into(),
                description: None,
                workspace_path: "/ws".into(),
                git_url: None,
                default_cli: "codex".into(),
                status: None,
            },
        )
        .unwrap();
        delete_agent(&conn, &b.id).unwrap();
        let list = list_agents(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, a.id);
        assert!(list[0].deleted_at.is_none());
    }
}
