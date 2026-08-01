use rusqlite::Connection;

const SCHEMA_SQL: &str = include_str!("schema.sql");
const SCHEMA_VERSION: i32 = 3;

/// Idempotent schema migration to current version. Seeds orchestrator_settings id=1 if missing.
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

pub fn now_unix() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn now_iso8601() -> String {
    format_unix_as_iso8601(now_unix())
}

/// Parse `YYYY-MM-DDTHH:MM:SSZ` / `YYYY-MM-DDTHH:MM:SS` / with optional fractional seconds.
pub fn parse_iso8601_unix(s: &str) -> Result<u64, String> {
    let t = s.trim();
    if t.is_empty() {
        return Err("empty timestamp".into());
    }
    let t = t.strip_suffix('Z').unwrap_or(t);
    let t = if let Some(i) = t.find('.') {
        &t[..i]
    } else {
        t
    };
    // Also accept space separator
    let t = t.replace(' ', "T");
    let parts: Vec<&str> = t.split('T').collect();
    if parts.len() != 2 {
        return Err(format!("invalid iso8601: {s}"));
    }
    let date: Vec<&str> = parts[0].split('-').collect();
    let time: Vec<&str> = parts[1].split(':').collect();
    if date.len() != 3 || time.len() < 2 {
        return Err(format!("invalid iso8601: {s}"));
    }
    let y: i32 = date[0].parse().map_err(|_| format!("bad year in {s}"))?;
    let m: u32 = date[1].parse().map_err(|_| format!("bad month in {s}"))?;
    let d: u32 = date[2].parse().map_err(|_| format!("bad day in {s}"))?;
    let hh: u64 = time[0].parse().map_err(|_| format!("bad hour in {s}"))?;
    let mm: u64 = time[1].parse().map_err(|_| format!("bad minute in {s}"))?;
    let ss: u64 = if time.len() >= 3 {
        time[2]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .unwrap_or(0)
    } else {
        0
    };
    let days = days_from_civil(y, m, d)? as u64;
    Ok(days * 86400 + hh * 3600 + mm * 60 + ss)
}

pub fn format_unix_as_iso8601(secs: u64) -> String {
    // Approximate civil date from unix seconds (UTC)
    let days = (secs / 86400) as i64;
    let tod = secs % 86400;
    let (y, m, d) = civil_from_days(days + 719468); // shift to civil epoch
    let hh = tod / 3600;
    let mm = (tod % 3600) / 60;
    let ss = tod % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// Inverse of civil_from_days — days since Unix epoch (1970-01-01).
fn days_from_civil(y: i32, m: u32, d: u32) -> Result<i64, String> {
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return Err(format!("invalid date {y}-{m:02}-{d:02}"));
    }
    let y = y as i64;
    let m = m as i64;
    let d = d as i64;
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy as u64;
    Ok(era * 146097 + doe as i64 - 719468)
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
            "templates",
            "schedules",
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
