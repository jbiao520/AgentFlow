use crate::db::now_iso8601;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStatus {
    pub engine: String,
    pub available: bool,
    pub version: Option<String>,
    pub last_checked_at: Option<String>,
}

pub const ENGINE_NAMES: &[&str] = &["cursor-agent", "codex", "opencode"];

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EngineStatus> {
    let available_i: i64 = row.get(1)?;
    Ok(EngineStatus {
        engine: row.get(0)?,
        available: available_i != 0,
        version: row.get(2)?,
        last_checked_at: row.get(3)?,
    })
}

pub fn list_cli_engine_status(conn: &Connection) -> Result<Vec<EngineStatus>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT engine, available, version, last_checked_at
             FROM cli_engine_status
             ORDER BY CASE engine
               WHEN 'cursor-agent' THEN 1
               WHEN 'codex' THEN 2
               WHEN 'opencode' THEN 3
               ELSE 99
             END",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn upsert_cli_engine_status(
    conn: &Connection,
    engine: &str,
    available: bool,
    version: Option<&str>,
) -> Result<EngineStatus, String> {
    let now = now_iso8601();
    conn.execute(
        "INSERT INTO cli_engine_status (engine, available, version, last_checked_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(engine) DO UPDATE SET
           available = excluded.available,
           version = excluded.version,
           last_checked_at = excluded.last_checked_at",
        params![engine, available as i64, version, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(EngineStatus {
        engine: engine.to_string(),
        available,
        version: version.map(|s| s.to_string()),
        last_checked_at: Some(now),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use tempfile::NamedTempFile;

    #[test]
    fn upsert_and_list_cli_status() {
        let tmp = NamedTempFile::new().expect("tempfile");
        let conn = Connection::open(tmp.path()).expect("open");
        migrate(&conn).expect("migrate");

        upsert_cli_engine_status(&conn, "codex", true, Some("0.145.0")).expect("upsert");
        upsert_cli_engine_status(&conn, "cursor-agent", false, None).expect("upsert");
        upsert_cli_engine_status(&conn, "opencode", true, Some("1.18.7")).expect("upsert");

        let list = list_cli_engine_status(&conn).expect("list");
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].engine, "cursor-agent");
        assert!(!list[0].available);
        assert_eq!(list[1].engine, "codex");
        assert!(list[1].available);
        assert_eq!(list[1].version.as_deref(), Some("0.145.0"));
        assert_eq!(list[2].engine, "opencode");
    }
}
