use crate::db::now_iso8601;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub agent_id: String,
    pub relative_path: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
    pub content_hash: Option<String>,
    pub scanned_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillUpsert {
    pub id: Option<String>,
    pub agent_id: String,
    pub relative_path: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub content_hash: Option<String>,
}

pub fn list_skills_by_agent(conn: &Connection, agent_id: &str) -> Result<Vec<Skill>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, agent_id, relative_path, title, description, enabled, content_hash, scanned_at
             FROM skills WHERE agent_id = ?1 ORDER BY relative_path",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([agent_id], |row| {
            Ok(Skill {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                relative_path: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                enabled: row.get::<_, i64>(5)? != 0,
                content_hash: row.get(6)?,
                scanned_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Upsert many skills for a scanner sync. Matches on (agent_id, relative_path).
pub fn upsert_skills_many(conn: &Connection, skills: &[SkillUpsert]) -> Result<Vec<Skill>, String> {
    let mut out = Vec::with_capacity(skills.len());
    let now = now_iso8601();
    for s in skills {
        let relative_path = s.relative_path.trim().to_string();
        if relative_path.is_empty() {
            return Err("skill relative_path must not be empty".into());
        }
        if s.agent_id.trim().is_empty() {
            return Err("skill agent_id must not be empty".into());
        }
        let enabled = if s.enabled.unwrap_or(true) { 1 } else { 0 };

        // Prefer explicit id; else match existing by agent+path
        let existing_id: Option<String> = if let Some(ref id) = s.id {
            Some(id.clone())
        } else {
            conn.query_row(
                "SELECT id FROM skills WHERE agent_id = ?1 AND relative_path = ?2",
                params![&s.agent_id, &relative_path],
                |row| row.get(0),
            )
            .ok()
        };

        let id = if let Some(id) = existing_id {
            conn.execute(
                "UPDATE skills SET title=?1, description=?2, enabled=?3, content_hash=?4, scanned_at=?5
                 WHERE id=?6",
                params![s.title, s.description, enabled, s.content_hash, now, id],
            )
            .map_err(|e| e.to_string())?;
            id
        } else {
            let id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO skills (id, agent_id, relative_path, title, description, enabled, content_hash, scanned_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    s.agent_id,
                    relative_path,
                    s.title,
                    s.description,
                    enabled,
                    s.content_hash,
                    now
                ],
            )
            .map_err(|e| e.to_string())?;
            id
        };

        let skill = conn
            .query_row(
                "SELECT id, agent_id, relative_path, title, description, enabled, content_hash, scanned_at
                 FROM skills WHERE id = ?1",
                [&id],
                |row| {
                    Ok(Skill {
                        id: row.get(0)?,
                        agent_id: row.get(1)?,
                        relative_path: row.get(2)?,
                        title: row.get(3)?,
                        description: row.get(4)?,
                        enabled: row.get::<_, i64>(5)? != 0,
                        content_hash: row.get(6)?,
                        scanned_at: row.get(7)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?;
        out.push(skill);
    }
    Ok(out)
}

pub fn set_skill_enabled(conn: &Connection, id: &str, enabled: bool) -> Result<Skill, String> {
    let n = conn
        .execute(
            "UPDATE skills SET enabled = ?1 WHERE id = ?2",
            params![if enabled { 1 } else { 0 }, id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("skill not found: {id}"));
    }
    conn.query_row(
        "SELECT id, agent_id, relative_path, title, description, enabled, content_hash, scanned_at
         FROM skills WHERE id = ?1",
        [id],
        |row| {
            Ok(Skill {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                relative_path: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                enabled: row.get::<_, i64>(5)? != 0,
                content_hash: row.get(6)?,
                scanned_at: row.get(7)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_db_at;
    use crate::repo::agents::{upsert_agent, AgentUpsert};
    use tempfile::TempDir;

    #[test]
    fn skill_upsert_and_enable_toggle() {
        let dir = TempDir::new().unwrap();
        let conn = open_db_at(&dir.path().join("t.db")).unwrap();
        let agent = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "sk".into(),
                description: None,
                workspace_path: "/ws".into(),
                git_url: None,
                default_cli: "codex".into(),
                status: None,
            },
        )
        .unwrap();

        let skills = upsert_skills_many(
            &conn,
            &[SkillUpsert {
                id: None,
                agent_id: agent.id.clone(),
                relative_path: ".agent/skills/foo.md".into(),
                title: Some("Foo".into()),
                description: Some("d".into()),
                enabled: Some(true),
                content_hash: Some("abc".into()),
            }],
        )
        .unwrap();
        assert_eq!(skills.len(), 1);
        assert!(skills[0].enabled);

        let toggled = set_skill_enabled(&conn, &skills[0].id, false).unwrap();
        assert!(!toggled.enabled);

        let listed = list_skills_by_agent(&conn, &agent.id).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].enabled);
    }
}
