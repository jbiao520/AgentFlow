use crate::db::now_iso8601;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorSettings {
    pub id: i64,
    pub cli_engine: String,
    pub model: String,
    pub reasoning_effort: String,
    #[serde(default)]
    pub use_fast: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorSettingsUpdate {
    pub cli_engine: String,
    pub model: String,
    pub reasoning_effort: String,
    #[serde(default)]
    pub use_fast: bool,
}

pub fn get_orchestrator_settings(conn: &Connection) -> Result<OrchestratorSettings, String> {
    conn.query_row(
        "SELECT id, cli_engine, model, reasoning_effort, COALESCE(use_fast, 0), updated_at
         FROM orchestrator_settings WHERE id = 1",
        [],
        |row| {
            let use_fast_i: i64 = row.get(4)?;
            Ok(OrchestratorSettings {
                id: row.get(0)?,
                cli_engine: row.get(1)?,
                model: row.get(2)?,
                reasoning_effort: row.get(3)?,
                use_fast: use_fast_i != 0,
                updated_at: row.get(5)?,
            })
        },
    )
    .map_err(|e| format!("orchestrator_settings missing: {e}"))
}

pub fn update_orchestrator_settings(
    conn: &Connection,
    update: OrchestratorSettingsUpdate,
) -> Result<OrchestratorSettings, String> {
    let cli = update.cli_engine.trim().to_string();
    let model = update.model.trim().to_string();
    // Empty effort is allowed: some models (e.g. Cursor composer) have no reasoning levels.
    let effort = update.reasoning_effort.trim().to_string();
    if cli.is_empty() || model.is_empty() {
        return Err("cli_engine and model must not be empty".into());
    }
    let now = now_iso8601();
    let use_fast = if update.use_fast { 1i64 } else { 0 };
    let n = conn
        .execute(
            "UPDATE orchestrator_settings
             SET cli_engine=?1, model=?2, reasoning_effort=?3, use_fast=?4, updated_at=?5
             WHERE id=1",
            params![cli, model, effort, use_fast, now],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("orchestrator_settings row id=1 missing".into());
    }
    get_orchestrator_settings(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_db_at;
    use tempfile::TempDir;

    #[test]
    fn get_and_update_orchestrator_settings() {
        let dir = TempDir::new().unwrap();
        let conn = open_db_at(&dir.path().join("t.db")).unwrap();
        let s = get_orchestrator_settings(&conn).unwrap();
        assert_eq!(s.cli_engine, "codex");
        assert_eq!(s.model, "sol");
        assert!(!s.use_fast);

        let updated = update_orchestrator_settings(
            &conn,
            OrchestratorSettingsUpdate {
                cli_engine: "cursor-agent".into(),
                model: "claude".into(),
                reasoning_effort: "high".into(),
                use_fast: true,
            },
        )
        .unwrap();
        assert_eq!(updated.cli_engine, "cursor-agent");
        assert_eq!(updated.model, "claude");
        assert_eq!(updated.reasoning_effort, "high");
        assert!(updated.use_fast);

        // Models without reasoning levels may save empty effort.
        let no_effort = update_orchestrator_settings(
            &conn,
            OrchestratorSettingsUpdate {
                cli_engine: "cursor-agent".into(),
                model: "composer-2.5".into(),
                reasoning_effort: "".into(),
                use_fast: false,
            },
        )
        .unwrap();
        assert_eq!(no_effort.model, "composer-2.5");
        assert_eq!(no_effort.reasoning_effort, "");
        assert!(!no_effort.use_fast);
    }
}
