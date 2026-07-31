use rusqlite::Connection;

const SCHEMA_SQL: &str = include_str!("schema.sql");
const SCHEMA_VERSION: i32 = 1;

/// Idempotent schema migration to v1. Seeds orchestrator_settings id=1 if missing.
pub fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("enable foreign_keys: {e}"))?;

    let current: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // schema_migrations may not exist yet — create via full schema
    if current < SCHEMA_VERSION {
        conn.execute_batch(SCHEMA_SQL)
            .map_err(|e| format!("apply schema: {e}"))?;
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (?1)",
            [SCHEMA_VERSION],
        )
        .map_err(|e| format!("record migration: {e}"))?;
    }

    seed_orchestrator_settings(conn)?;
    Ok(())
}

fn seed_orchestrator_settings(conn: &Connection) -> Result<(), String> {
    let now = now_iso8601();
    conn.execute(
        "INSERT OR IGNORE INTO orchestrator_settings (id, cli_engine, model, reasoning_effort, updated_at)
         VALUES (1, 'codex', 'sol', 'medium', ?1)",
        [&now],
    )
    .map_err(|e| format!("seed orchestrator_settings: {e}"))?;
    Ok(())
}

pub fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Simple UTC ISO-8601 without chrono dep
    format_unix_as_iso8601(secs)
}

fn format_unix_as_iso8601(secs: u64) -> String {
    // Approximate civil date from unix seconds (UTC)
    let days = (secs / 86400) as i64;
    let tod = secs % 86400;
    let (y, m, d) = civil_from_days(days + 719468); // shift to civil epoch
    let hh = tod / 3600;
    let mm = (tod % 3600) / 60;
    let ss = tod % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// Howard Hinnant civil_from_days (proleptic Gregorian).
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::NamedTempFile;

    fn expected_tables() -> &'static [&'static str] {
        &[
            "schema_migrations",
            "agents",
            "agent_model_profiles",
            "skills",
            "orchestrator_settings",
            "goals",
            "plans",
            "task_runs",
            "task_nodes",
            "task_logs",
            "cli_engine_status",
        ]
    }

    #[test]
    fn migrate_creates_tables_and_seeds_orchestrator() {
        let tmp = NamedTempFile::new().expect("tempfile");
        let conn = Connection::open(tmp.path()).expect("open");
        migrate(&conn).expect("migrate");

        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .expect("prepare");
        let names: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("rows");

        for table in expected_tables() {
            assert!(
                names.iter().any(|n| n == table),
                "missing table {table}; have {names:?}"
            );
        }

        let (cli, model, effort): (String, String, String) = conn
            .query_row(
                "SELECT cli_engine, model, reasoning_effort FROM orchestrator_settings WHERE id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("seeded settings");
        assert_eq!(cli, "codex");
        assert_eq!(model, "sol");
        assert_eq!(effort, "medium");
    }

    #[test]
    fn migrate_is_idempotent() {
        let tmp = NamedTempFile::new().expect("tempfile");
        let conn = Connection::open(tmp.path()).expect("open");
        migrate(&conn).expect("migrate 1");
        migrate(&conn).expect("migrate 2");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM orchestrator_settings WHERE id=1",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 1);
    }
}
