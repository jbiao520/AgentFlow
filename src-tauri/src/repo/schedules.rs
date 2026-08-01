use crate::db::{format_unix_as_iso8601, now_iso8601, now_unix, parse_iso8601_unix};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleMode {
    Once,
    Interval,
}

impl ScheduleMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ScheduleMode::Once => "once",
            ScheduleMode::Interval => "interval",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "once" => Ok(ScheduleMode::Once),
            "interval" => Ok(ScheduleMode::Interval),
            other => Err(format!("invalid schedule mode: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub template_id: String,
    pub values_json: String,
    pub mode: String,
    pub interval_secs: Option<i64>,
    pub enabled: bool,
    pub next_run_at: String,
    pub last_run_at: Option<String>,
    pub last_run_id: Option<String>,
    pub last_error: Option<String>,
    pub run_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleCreate {
    pub name: String,
    pub template_id: String,
    pub values_json: String,
    pub mode: String,
    pub interval_secs: Option<i64>,
    /// First / only fire time (ISO-8601 UTC).
    pub next_run_at: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleUpdate {
    pub name: Option<String>,
    pub template_id: Option<String>,
    pub values_json: Option<String>,
    pub mode: Option<String>,
    pub interval_secs: Option<Option<i64>>,
    pub next_run_at: Option<String>,
    pub enabled: Option<bool>,
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Schedule> {
    let enabled_i: i64 = row.get(6)?;
    Ok(Schedule {
        id: row.get(0)?,
        name: row.get(1)?,
        template_id: row.get(2)?,
        values_json: row.get(3)?,
        mode: row.get(4)?,
        interval_secs: row.get(5)?,
        enabled: enabled_i != 0,
        next_run_at: row.get(7)?,
        last_run_at: row.get(8)?,
        last_run_id: row.get(9)?,
        last_error: row.get(10)?,
        run_count: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

const SELECT_COLS: &str = "id, name, template_id, values_json, mode, interval_secs, enabled, \
    next_run_at, last_run_at, last_run_id, last_error, run_count, created_at, updated_at";

fn validate_values_json(raw: &str) -> Result<String, String> {
    let trimmed = if raw.trim().is_empty() {
        "{}".to_string()
    } else {
        raw.to_string()
    };
    let v: serde_json::Value =
        serde_json::from_str(&trimmed).map_err(|e| format!("values_json invalid: {e}"))?;
    if !v.is_object() {
        return Err("values_json must be a JSON object".into());
    }
    Ok(trimmed)
}

fn validate_create(input: &ScheduleCreate) -> Result<(ScheduleMode, String, Option<i64>), String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("schedule name must not be empty".into());
    }
    if input.template_id.trim().is_empty() {
        return Err("template_id must not be empty".into());
    }
    let mode = ScheduleMode::parse(&input.mode)?;
    let _ = parse_iso8601_unix(&input.next_run_at)?;
    let interval = match mode {
        ScheduleMode::Once => None,
        ScheduleMode::Interval => {
            let secs = input
                .interval_secs
                .ok_or_else(|| "interval_secs required for interval mode".to_string())?;
            if secs < 60 {
                return Err("interval_secs must be >= 60".into());
            }
            Some(secs)
        }
    };
    let values = validate_values_json(&input.values_json)?;
    Ok((mode, values, interval))
}

pub fn list_schedules(conn: &Connection) -> Result<Vec<Schedule>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_COLS} FROM schedules ORDER BY next_run_at ASC"
        ))
        .map_err(|e| format!("list schedules prepare: {e}"))?;
    let rows = stmt
        .query_map([], map_row)
        .map_err(|e| format!("list schedules query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("list schedules row: {e}"))?);
    }
    Ok(out)
}

pub fn get_schedule(conn: &Connection, id: &str) -> Result<Option<Schedule>, String> {
    conn.query_row(
        &format!("SELECT {SELECT_COLS} FROM schedules WHERE id = ?1"),
        [id],
        map_row,
    )
    .optional()
    .map_err(|e| format!("get schedule: {e}"))
}

pub fn create_schedule(conn: &Connection, input: ScheduleCreate) -> Result<Schedule, String> {
    let (mode, values, interval) = validate_create(&input)?;
    // Ensure template exists
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM templates WHERE id = ?1",
            [&input.template_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("check template: {e}"))?;
    if exists == 0 {
        return Err(format!("template not found: {}", input.template_id));
    }

    let id = Uuid::new_v4().to_string();
    let now = now_iso8601();
    let next = input.next_run_at.trim().to_string();
    let next = if next.ends_with('Z') {
        next
    } else {
        format!("{next}Z")
    };

    conn.execute(
        "INSERT INTO schedules (
            id, name, template_id, values_json, mode, interval_secs, enabled,
            next_run_at, last_run_at, last_run_id, last_error, run_count, created_at, updated_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,NULL,NULL,0,?9,?10)",
        params![
            id,
            input.name.trim(),
            input.template_id.trim(),
            values,
            mode.as_str(),
            interval,
            if input.enabled { 1 } else { 0 },
            next,
            now,
            now,
        ],
    )
    .map_err(|e| format!("insert schedule: {e}"))?;

    get_schedule(conn, &id)?.ok_or_else(|| "schedule missing after insert".into())
}

pub fn update_schedule(
    conn: &Connection,
    id: &str,
    input: ScheduleUpdate,
) -> Result<Schedule, String> {
    let existing = get_schedule(conn, id)?.ok_or_else(|| format!("schedule not found: {id}"))?;

    let name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(existing.name.as_str())
        .to_string();

    let template_id = input
        .template_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(existing.template_id.as_str())
        .to_string();

    if template_id != existing.template_id {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM templates WHERE id = ?1",
                [&template_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("check template: {e}"))?;
        if exists == 0 {
            return Err(format!("template not found: {template_id}"));
        }
    }

    let mode_str = input
        .mode
        .as_deref()
        .unwrap_or(existing.mode.as_str())
        .to_string();
    let mode = ScheduleMode::parse(&mode_str)?;

    let values = if let Some(ref v) = input.values_json {
        validate_values_json(v)?
    } else {
        existing.values_json.clone()
    };

    let interval = match mode {
        ScheduleMode::Once => None,
        ScheduleMode::Interval => {
            let secs = match &input.interval_secs {
                Some(inner) => *inner,
                None => existing.interval_secs,
            }
            .ok_or_else(|| "interval_secs required for interval mode".to_string())?;
            if secs < 60 {
                return Err("interval_secs must be >= 60".into());
            }
            Some(secs)
        }
    };

    let next_run_at = if let Some(ref n) = input.next_run_at {
        let _ = parse_iso8601_unix(n)?;
        let n = n.trim();
        if n.ends_with('Z') {
            n.to_string()
        } else {
            format!("{n}Z")
        }
    } else {
        existing.next_run_at.clone()
    };

    let enabled = input.enabled.unwrap_or(existing.enabled);
    let now = now_iso8601();

    conn.execute(
        "UPDATE schedules SET
            name=?1, template_id=?2, values_json=?3, mode=?4, interval_secs=?5,
            enabled=?6, next_run_at=?7, updated_at=?8
         WHERE id=?9",
        params![
            name,
            template_id,
            values,
            mode.as_str(),
            interval,
            if enabled { 1 } else { 0 },
            next_run_at,
            now,
            id,
        ],
    )
    .map_err(|e| format!("update schedule: {e}"))?;

    get_schedule(conn, id)?.ok_or_else(|| "schedule missing after update".into())
}

pub fn delete_schedule(conn: &Connection, id: &str) -> Result<(), String> {
    let n = conn
        .execute("DELETE FROM schedules WHERE id = ?1", [id])
        .map_err(|e| format!("delete schedule: {e}"))?;
    if n == 0 {
        return Err(format!("schedule not found: {id}"));
    }
    Ok(())
}

pub fn set_schedule_enabled(
    conn: &Connection,
    id: &str,
    enabled: bool,
) -> Result<Schedule, String> {
    let now = now_iso8601();
    let n = conn
        .execute(
            "UPDATE schedules SET enabled=?1, updated_at=?2 WHERE id=?3",
            params![if enabled { 1 } else { 0 }, now, id],
        )
        .map_err(|e| format!("set enabled: {e}"))?;
    if n == 0 {
        return Err(format!("schedule not found: {id}"));
    }
    get_schedule(conn, id)?.ok_or_else(|| "schedule missing after enable toggle".into())
}

/// Due schedules: enabled and next_run_at <= now.
pub fn list_due_schedules(conn: &Connection) -> Result<Vec<Schedule>, String> {
    let now = now_iso8601();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_COLS} FROM schedules
             WHERE enabled = 1 AND next_run_at <= ?1
             ORDER BY next_run_at ASC"
        ))
        .map_err(|e| format!("list due prepare: {e}"))?;
    let rows = stmt
        .query_map([&now], map_row)
        .map_err(|e| format!("list due query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("list due row: {e}"))?);
    }
    Ok(out)
}

/// After a successful/failed fire: bump counters and advance or disable.
pub fn mark_schedule_fired(
    conn: &Connection,
    id: &str,
    run_id: Option<&str>,
    error: Option<&str>,
) -> Result<Schedule, String> {
    let existing = get_schedule(conn, id)?.ok_or_else(|| format!("schedule not found: {id}"))?;
    let mode = ScheduleMode::parse(&existing.mode)?;
    let now_u = now_unix();
    let now = format_unix_as_iso8601(now_u);
    let run_count = existing.run_count + 1;

    let (enabled, next_run_at) = match mode {
        ScheduleMode::Once => (false, existing.next_run_at.clone()),
        ScheduleMode::Interval => {
            let secs = existing.interval_secs.unwrap_or(3600).max(60) as u64;
            // Advance from "now" so we don't catch up endlessly after downtime
            let next = format_unix_as_iso8601(now_u.saturating_add(secs));
            (true, next)
        }
    };

    conn.execute(
        "UPDATE schedules SET
            enabled=?1, next_run_at=?2, last_run_at=?3, last_run_id=?4,
            last_error=?5, run_count=?6, updated_at=?7
         WHERE id=?8",
        params![
            if enabled { 1 } else { 0 },
            next_run_at,
            now,
            run_id,
            error,
            run_count,
            now,
            id,
        ],
    )
    .map_err(|e| format!("mark schedule fired: {e}"))?;

    get_schedule(conn, id)?.ok_or_else(|| "schedule missing after fire".into())
}

/// Manual "run now" — record result without changing schedule cadence / enabled.
pub fn mark_schedule_manual_run(
    conn: &Connection,
    id: &str,
    run_id: Option<&str>,
    error: Option<&str>,
) -> Result<Schedule, String> {
    let existing = get_schedule(conn, id)?.ok_or_else(|| format!("schedule not found: {id}"))?;
    let now = now_iso8601();
    let run_count = existing.run_count + 1;
    conn.execute(
        "UPDATE schedules SET
            last_run_at=?1, last_run_id=?2, last_error=?3, run_count=?4, updated_at=?5
         WHERE id=?6",
        params![now, run_id, error, run_count, now, id],
    )
    .map_err(|e| format!("mark schedule manual run: {e}"))?;
    get_schedule(conn, id)?.ok_or_else(|| "schedule missing after manual run".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::repo::templates::{create_template, TemplateCreate};
    use tempfile::NamedTempFile;

    fn setup() -> (NamedTempFile, Connection) {
        let tmp = NamedTempFile::new().expect("temp");
        let conn = Connection::open(tmp.path()).expect("open");
        migrate(&conn).expect("migrate");
        let _ = create_template(
            &conn,
            TemplateCreate {
                name: "t1".into(),
                description: None,
                source_goal_id: None,
                source_plan_id: None,
                source_run_id: None,
                goal_prompt: "do {{topic}}".into(),
                plan_json: r#"{"intent":{"summary":"x"},"subtasks":[]}"#.into(),
                variables_json: r#"[{"key":"topic","label":"Topic","required":true}]"#.into(),
            },
        )
        .expect("template");
        (tmp, conn)
    }

    #[test]
    fn create_once_and_list() {
        let (_tmp, conn) = setup();
        let tmpl = crate::repo::templates::list_templates(&conn).unwrap();
        let s = create_schedule(
            &conn,
            ScheduleCreate {
                name: "daily".into(),
                template_id: tmpl[0].id.clone(),
                values_json: r#"{"topic":"news"}"#.into(),
                mode: "once".into(),
                interval_secs: None,
                next_run_at: "2099-01-01T00:00:00Z".into(),
                enabled: true,
            },
        )
        .expect("create");
        assert_eq!(s.mode, "once");
        assert!(s.enabled);
        assert_eq!(list_schedules(&conn).unwrap().len(), 1);
    }
}
