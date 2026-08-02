use crate::db::{format_unix_as_iso8601, now_iso8601, now_unix, parse_iso8601_unix};
use chrono::{DateTime, Local, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleMode {
    Once,
    Interval,
    Cron,
}

impl ScheduleMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ScheduleMode::Once => "once",
            ScheduleMode::Interval => "interval",
            ScheduleMode::Cron => "cron",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "once" => Ok(ScheduleMode::Once),
            "interval" => Ok(ScheduleMode::Interval),
            "cron" => Ok(ScheduleMode::Cron),
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
    pub cron_expr: Option<String>,
    pub window_start: Option<String>,
    pub window_end: Option<String>,
    pub overlap_policy: String,
    pub max_retries: i64,
    pub retry_delay_secs: i64,
    pub retry_attempt: i64,
    #[serde(default)]
    pub consecutive_failures: i64,
}

/// Auto-pause after this many consecutive terminal failures (instantiate or run).
pub const AUTO_PAUSE_AFTER_FAILURES: i64 = 3;

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
    #[serde(default)]
    pub cron_expr: Option<String>,
    #[serde(default)]
    pub window_start: Option<String>,
    #[serde(default)]
    pub window_end: Option<String>,
    #[serde(default = "default_overlap_policy")]
    pub overlap_policy: String,
    #[serde(default)]
    pub max_retries: i64,
    #[serde(default = "default_retry_delay_secs")]
    pub retry_delay_secs: i64,
}

fn default_enabled() -> bool {
    true
}

fn default_overlap_policy() -> String {
    "queue".into()
}

fn default_retry_delay_secs() -> i64 {
    300
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
    pub cron_expr: Option<Option<String>>,
    pub window_start: Option<Option<String>>,
    pub window_end: Option<Option<String>>,
    pub overlap_policy: Option<String>,
    pub max_retries: Option<i64>,
    pub retry_delay_secs: Option<i64>,
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
        cron_expr: row.get(14)?,
        window_start: row.get(15)?,
        window_end: row.get(16)?,
        overlap_policy: row.get(17)?,
        max_retries: row.get(18)?,
        retry_delay_secs: row.get(19)?,
        retry_attempt: row.get(20)?,
        consecutive_failures: row.get(21).unwrap_or(0),
    })
}

const SELECT_COLS: &str = "id, name, template_id, values_json, mode, interval_secs, enabled, \
    next_run_at, last_run_at, last_run_id, last_error, run_count, created_at, updated_at, \
    cron_expr, window_start, window_end, overlap_policy, max_retries, retry_delay_secs, retry_attempt, \
    consecutive_failures";

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

fn normalize_time(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = value else { return Ok(None); };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let mut parts = raw.split(':');
    let hour: u32 = parts
        .next()
        .ok_or_else(|| format!("invalid window time: {raw}"))?
        .parse()
        .map_err(|_| format!("invalid window time: {raw}"))?;
    let minute: u32 = parts
        .next()
        .ok_or_else(|| format!("invalid window time: {raw}"))?
        .parse()
        .map_err(|_| format!("invalid window time: {raw}"))?;
    if parts.next().is_some() || hour > 23 || minute > 59 {
        return Err(format!("invalid window time: {raw}; expected HH:MM"));
    }
    Ok(Some(format!("{hour:02}:{minute:02}")))
}

fn normalize_cron(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = value else { return Ok(None); };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    validate_cron_expr(raw)?;
    Ok(Some(raw.to_string()))
}

fn validate_options(
    mode: &ScheduleMode,
    cron_expr: Option<&str>,
    window_start: Option<&str>,
    window_end: Option<&str>,
    overlap_policy: &str,
    max_retries: i64,
    retry_delay_secs: i64,
) -> Result<(Option<String>, Option<String>, Option<String>, String, i64, i64), String> {
    let cron = normalize_cron(cron_expr)?;
    if matches!(mode, ScheduleMode::Cron) && cron.is_none() {
        return Err("cron_expr is required for cron mode".into());
    }
    let start = normalize_time(window_start)?;
    let end = normalize_time(window_end)?;
    if start.is_some() != end.is_some() {
        return Err("window_start and window_end must be provided together".into());
    }
    let overlap = overlap_policy.trim().to_ascii_lowercase();
    if !matches!(overlap.as_str(), "allow" | "skip" | "queue") {
        return Err("overlap_policy must be allow, skip, or queue".into());
    }
    if !(0..=20).contains(&max_retries) {
        return Err("max_retries must be between 0 and 20".into());
    }
    if !(60..=86_400).contains(&retry_delay_secs) {
        return Err("retry_delay_secs must be between 60 and 86400".into());
    }
    Ok((cron, start, end, overlap, max_retries, retry_delay_secs))
}

fn validate_create(
    input: &ScheduleCreate,
) -> Result<(ScheduleMode, String, Option<i64>, Option<String>, Option<String>, Option<String>, String, i64, i64), String> {
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
        ScheduleMode::Cron => None,
    };
    let values = validate_values_json(&input.values_json)?;
    let (cron, window_start, window_end, overlap_policy, max_retries, retry_delay_secs) =
        validate_options(
            &mode,
            input.cron_expr.as_deref(),
            input.window_start.as_deref(),
            input.window_end.as_deref(),
            &input.overlap_policy,
            input.max_retries,
            input.retry_delay_secs,
        )?;
    Ok((mode, values, interval, cron, window_start, window_end, overlap_policy, max_retries, retry_delay_secs))
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
    let (
        mode,
        values,
        interval,
        cron_expr,
        window_start,
        window_end,
        overlap_policy,
        max_retries,
        retry_delay_secs,
    ) = validate_create(&input)?;
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
    // Cron mode must schedule from the expression. Clients (and the UI default of
    // "now + 5 minutes") often supply a wall-clock next_run_at that does not match
    // the cron — that would fire early before the expression is ever consulted.
    let next = match mode {
        ScheduleMode::Cron => {
            let expr = cron_expr
                .as_deref()
                .ok_or_else(|| "cron_expr is required for cron mode".to_string())?;
            next_cron_run_at(expr, now_unix())?
        }
        _ => {
            let next = input.next_run_at.trim().to_string();
            if next.ends_with('Z') {
                next
            } else {
                format!("{next}Z")
            }
        }
    };

    conn.execute(
        "INSERT INTO schedules (
            id, name, template_id, values_json, mode, interval_secs, enabled,
            next_run_at, last_run_at, last_run_id, last_error, run_count, created_at, updated_at,
            cron_expr, window_start, window_end, overlap_policy, max_retries, retry_delay_secs, retry_attempt
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,NULL,NULL,0,?9,?10,?11,?12,?13,?14,?15,?16,0)",
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
            cron_expr,
            window_start,
            window_end,
            overlap_policy,
            max_retries,
            retry_delay_secs,
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
        ScheduleMode::Cron => None,
    };

    let cron_input = match input.cron_expr.as_ref() {
        Some(Some(value)) => Some(value.as_str()),
        Some(None) => None,
        None => existing.cron_expr.as_deref(),
    };
    let window_start_input = match input.window_start.as_ref() {
        Some(Some(value)) => Some(value.as_str()),
        Some(None) => None,
        None => existing.window_start.as_deref(),
    };
    let window_end_input = match input.window_end.as_ref() {
        Some(Some(value)) => Some(value.as_str()),
        Some(None) => None,
        None => existing.window_end.as_deref(),
    };
    let overlap_input = input
        .overlap_policy
        .as_deref()
        .unwrap_or(existing.overlap_policy.as_str());
    let max_retries = input.max_retries.unwrap_or(existing.max_retries);
    let retry_delay_secs = input
        .retry_delay_secs
        .unwrap_or(existing.retry_delay_secs);
    let (cron_expr, window_start, window_end, overlap_policy, max_retries, retry_delay_secs) =
        validate_options(
            &mode,
            cron_input,
            window_start_input,
            window_end_input,
            overlap_input,
            max_retries,
            retry_delay_secs,
        )?;

    // Cron schedules are expression-driven: always re-align next_run_at so a
    // client-supplied "now+5m" (or a stale once/interval time) cannot fire early.
    let next_run_at = match mode {
        ScheduleMode::Cron => {
            let expr = cron_expr
                .as_deref()
                .ok_or_else(|| "cron_expr is required for cron mode".to_string())?;
            next_cron_run_at(expr, now_unix())?
        }
        _ => {
            if let Some(ref n) = input.next_run_at {
                let _ = parse_iso8601_unix(n)?;
                let n = n.trim();
                if n.ends_with('Z') {
                    n.to_string()
                } else {
                    format!("{n}Z")
                }
            } else {
                existing.next_run_at.clone()
            }
        }
    };

    let enabled = input.enabled.unwrap_or(existing.enabled);
    let now = now_iso8601();

    conn.execute(
        "UPDATE schedules SET
            name=?1, template_id=?2, values_json=?3, mode=?4, interval_secs=?5,
            enabled=?6, next_run_at=?7, updated_at=?8,
            cron_expr=?9, window_start=?10, window_end=?11, overlap_policy=?12,
            max_retries=?13, retry_delay_secs=?14
         WHERE id=?15",
        params![
            name,
            template_id,
            values,
            mode.as_str(),
            interval,
            if enabled { 1 } else { 0 },
            next_run_at,
            now,
            cron_expr,
            window_start,
            window_end,
            overlap_policy,
            max_retries,
            retry_delay_secs,
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

/// After a successful/failed fire: bump counters and advance, retry, or disable.
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

    let retry_attempt = if error.is_some() {
        existing.retry_attempt + 1
    } else {
        existing.retry_attempt
    };
    let should_retry = error.is_some() && retry_attempt <= existing.max_retries;

    // Instantiate failure: bump consecutive_failures. Success start resets only if run later succeeds
    // (handled in record_schedule_run_result). Instant success with run_id leaves count until run ends.
    let consecutive = if error.is_some() {
        existing.consecutive_failures + 1
    } else if run_id.is_none() {
        0
    } else {
        existing.consecutive_failures
    };

    let auto_pause = error.is_some() && consecutive >= AUTO_PAUSE_AFTER_FAILURES;
    let last_error = if auto_pause {
        let base = error.unwrap_or("failed");
        Some(format!("{base} · 已自动暂停（连续失败 {consecutive} 次）"))
    } else {
        error.map(|s| s.to_string())
    };

    let (enabled, next_run_at, next_retry_attempt) = if should_retry && !auto_pause {
        (
            true,
            format_unix_as_iso8601(
                now_u.saturating_add(existing.retry_delay_secs.max(60) as u64),
            ),
            retry_attempt,
        )
    } else if auto_pause {
        (
            false,
            next_run_for_mode(&existing, &mode, now_u)?,
            0,
        )
    } else {
        (
            !matches!(mode, ScheduleMode::Once),
            next_run_for_mode(&existing, &mode, now_u)?,
            0,
        )
    };

    conn.execute(
        "UPDATE schedules SET
            enabled=?1, next_run_at=?2, last_run_at=?3, last_run_id=?4,
            last_error=?5, run_count=?6, updated_at=?7, retry_attempt=?8,
            consecutive_failures=?9
         WHERE id=?10",
        params![
            if enabled { 1 } else { 0 },
            next_run_at,
            now,
            run_id,
            last_error,
            run_count,
            now,
            next_retry_attempt,
            consecutive,
            id,
        ],
    )
    .map_err(|e| format!("mark schedule fired: {e}"))?;

    get_schedule(conn, id)?.ok_or_else(|| "schedule missing after fire".into())
}

fn next_run_for_mode(
    schedule: &Schedule,
    mode: &ScheduleMode,
    now_u: u64,
) -> Result<String, String> {
    match mode {
        ScheduleMode::Once => Ok(schedule.next_run_at.clone()),
        ScheduleMode::Interval => {
            let secs = schedule.interval_secs.unwrap_or(3600).max(60) as u64;
            // Advance from "now" so we don't catch up endlessly after downtime.
            Ok(format_unix_as_iso8601(now_u.saturating_add(secs)))
        }
        ScheduleMode::Cron => {
            let expr = schedule
                .cron_expr
                .as_deref()
                .ok_or_else(|| "cron_expr missing for cron schedule".to_string())?;
            next_cron_run_at(expr, now_u)
        }
    }
}

/// Return true when a timestamp falls outside the configured daily execution window.
/// Window times are interpreted in UTC, matching the persisted schedule timestamps.
pub fn outside_run_window(schedule: &Schedule, unix: u64) -> bool {
    let (Some(start), Some(end)) = (schedule.window_start.as_deref(), schedule.window_end.as_deref())
    else {
        return false;
    };
    let start = minutes_from_hhmm(start).unwrap_or(0);
    let end = minutes_from_hhmm(end).unwrap_or(1440);
    let iso = format_unix_as_iso8601(unix);
    let time = iso.get(11..16).and_then(|s| minutes_from_hhmm(s)).unwrap_or(0);
    if start == end {
        return false;
    }
    if start < end {
        time < start || time >= end
    } else {
        time >= end && time < start
    }
}

/// Move a due schedule to the next opening of its daily execution window.
pub fn next_window_open_at(schedule: &Schedule, unix: u64) -> Option<u64> {
    let start = minutes_from_hhmm(schedule.window_start.as_deref()?)?;
    let end = minutes_from_hhmm(schedule.window_end.as_deref()?)?;
    let day_start = unix / 86_400 * 86_400;
    let minute = format_unix_as_iso8601(unix)
        .get(11..16)
        .and_then(minutes_from_hhmm)?;
    let cross_midnight = start > end;
    let next = if (!cross_midnight && minute < start) || (cross_midnight && minute >= end && minute < start) {
        day_start + start as u64 * 60
    } else {
        day_start + 86_400 + start as u64 * 60
    };
    Some(next)
}

fn minutes_from_hhmm(value: &str) -> Option<u32> {
    let mut parts = value.split(':');
    let hour = parts.next()?.parse::<u32>().ok()?;
    let minute = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_some() || hour > 23 || minute > 59 {
        return None;
    }
    Some(hour * 60 + minute)
}

/// Convert a Unix-style day-of-week number (0/7=Sun … 6=Sat) to Quartz (1=Sun … 7=Sat).
fn unix_dow_num_to_quartz(raw: &str) -> Result<u32, String> {
    let n: u32 = raw
        .parse()
        .map_err(|_| format!("invalid cron day-of-week: {raw}"))?;
    match n {
        0 | 7 => Ok(1),
        1..=6 => Ok(n + 1),
        _ => Err(format!("cron day-of-week {n} outside 0-7")),
    }
}

/// Rewrite a Unix DOW field so numeric ordinals match the `cron` crate (Quartz).
fn unix_dow_field_to_quartz(field: &str) -> Result<String, String> {
    if field == "*" || field == "?" {
        return Ok(field.to_string());
    }
    let mut parts_out = Vec::new();
    for part in field.split(',') {
        let part = part.trim();
        if part.is_empty() {
            return Err(format!("invalid cron day-of-week field: {field}"));
        }
        // Named days (Mon, FRI, …) are already Quartz-compatible.
        if part.chars().any(|c| c.is_ascii_alphabetic()) {
            parts_out.push(part.to_string());
            continue;
        }
        let (range, step) = match part.split_once('/') {
            Some((range, step)) => (range, Some(step)),
            None => (part, None),
        };
        let converted = if range == "*" {
            "*".to_string()
        } else if let Some((start, end)) = range.split_once('-') {
            format!(
                "{}-{}",
                unix_dow_num_to_quartz(start)?,
                unix_dow_num_to_quartz(end)?
            )
        } else {
            unix_dow_num_to_quartz(range)?.to_string()
        };
        match step {
            Some(step) => parts_out.push(format!("{converted}/{step}")),
            None => parts_out.push(converted),
        }
    }
    Ok(parts_out.join(","))
}

/// Normalize UI/stored expressions into the Quartz form expected by `cron::Schedule`.
///
/// Accepts:
/// - `@hourly` / `@daily` / … macros (passed through)
/// - 5-field Unix (`min hour dom month dow`) — DOW numbers converted, seconds set to `0`
/// - 6/7-field Quartz (passed through)
fn normalize_cron_expr(expr: &str) -> Result<String, String> {
    let expr = expr.trim();
    if expr.is_empty() {
        return Err("cron_expr is empty".into());
    }
    if expr.starts_with('@') {
        return Ok(expr.to_string());
    }
    let fields: Vec<&str> = expr.split_whitespace().collect();
    match fields.len() {
        5 => {
            let dow = unix_dow_field_to_quartz(fields[4])?;
            Ok(format!(
                "0 {} {} {} {} {}",
                fields[0], fields[1], fields[2], fields[3], dow
            ))
        }
        6 | 7 => Ok(fields.join(" ")),
        _ => Err(
            "cron_expr must be a 5-field Unix expression, a 6/7-field Quartz expression, or an @macro"
                .into(),
        ),
    }
}

fn parse_cron_schedule(expr: &str) -> Result<cron::Schedule, String> {
    let normalized = normalize_cron_expr(expr)?;
    cron::Schedule::from_str(&normalized).map_err(|e| format!("invalid cron_expr: {e}"))
}

fn validate_cron_expr(expr: &str) -> Result<(), String> {
    parse_cron_schedule(expr).map(|_| ())
}

/// Find the next fire time after `after_unix` for a Cron expression (Unix 5-field or Quartz).
///
/// Hour/minute/day fields are evaluated in the **system local timezone**, matching the
/// Schedules UI (e.g. `0 9 * * 1-5` = weekdays 09:00 local). The returned ISO-8601
/// timestamp is still stored in UTC (`…Z`).
pub fn next_cron_run_at(expr: &str, after_unix: u64) -> Result<String, String> {
    let schedule = parse_cron_schedule(expr)?;
    let after_utc = DateTime::<Utc>::from_timestamp(after_unix as i64, 0)
        .ok_or_else(|| "invalid timestamp for cron schedule".to_string())?;
    let after = after_utc.with_timezone(&Local);
    let next = schedule
        .after(&after)
        .next()
        .ok_or_else(|| "cron expression has no upcoming occurrence".to_string())?;
    let ts = next.timestamp();
    if ts < 0 {
        return Err("cron next run is before the unix epoch".into());
    }
    Ok(format_unix_as_iso8601(ts as u64))
}

/// Recompute `next_run_at` for every cron schedule from its expression in local time.
/// Call on scheduler start so existing rows (previously UTC-evaluated) realign immediately.
pub fn realign_cron_next_runs(conn: &Connection) -> Result<usize, String> {
    let schedules = list_schedules(conn)?;
    let now_u = now_unix();
    let now = format_unix_as_iso8601(now_u);
    let mut updated = 0usize;
    for schedule in schedules {
        if schedule.mode != ScheduleMode::Cron.as_str() {
            continue;
        }
        let Some(expr) = schedule.cron_expr.as_deref() else {
            continue;
        };
        let next = match next_cron_run_at(expr, now_u) {
            Ok(n) => n,
            Err(e) => {
                eprintln!(
                    "[AgentFlow] skip realign cron schedule {}: {e}",
                    schedule.id
                );
                continue;
            }
        };
        if next == schedule.next_run_at {
            continue;
        }
        conn.execute(
            "UPDATE schedules SET next_run_at=?1, updated_at=?2 WHERE id=?3",
            params![next, now, schedule.id],
        )
        .map_err(|e| format!("realign cron next_run_at: {e}"))?;
        updated += 1;
    }
    Ok(updated)
}

/// Check whether a schedule already owns a queued/running task run.
pub fn has_active_schedule_run(conn: &Connection, schedule_id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM task_runs
             WHERE schedule_id = ?1 AND status IN ('queued', 'running')
         )",
        [schedule_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|v| v != 0)
    .map_err(|e| format!("check active schedule run: {e}"))
}

/// Advance a skipped due occurrence without treating it as an execution.
pub fn mark_schedule_skipped(conn: &Connection, id: &str, reason: &str) -> Result<Schedule, String> {
    let existing = get_schedule(conn, id)?.ok_or_else(|| format!("schedule not found: {id}"))?;
    let now_u = now_unix();
    let mode = ScheduleMode::parse(&existing.mode)?;
    let next = next_run_for_mode(&existing, &mode, now_u)?;
    let now = format_unix_as_iso8601(now_u);
    conn.execute(
        "UPDATE schedules SET next_run_at=?1, last_error=?2, updated_at=?3 WHERE id=?4",
        params![next, reason, now, id],
    )
    .map_err(|e| format!("mark schedule skipped: {e}"))?;
    get_schedule(conn, id)?.ok_or_else(|| "schedule missing after skip".into())
}

/// Reschedule a failed scheduled run, or clear retry state after success.
/// Manual "run now" results must not change cadence, enabled, or retry state.
pub fn record_schedule_run_result(
    conn: &Connection,
    run_id: &str,
    status: &str,
    error: Option<&str>,
) -> Result<(), String> {
    let row: Option<(Option<String>, i64)> = conn
        .query_row(
            "SELECT schedule_id, COALESCE(is_manual, 0) FROM task_runs WHERE id = ?1",
            [run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| format!("find schedule for run: {e}"))?;
    let Some((schedule_id, is_manual)) = row else {
        return Ok(());
    };
    let Some(schedule_id) = schedule_id else {
        return Ok(());
    };
    let schedule = get_schedule(conn, &schedule_id)?
        .ok_or_else(|| format!("schedule not found for run: {run_id}"))?;
    let now_u = now_unix();
    let now = format_unix_as_iso8601(now_u);

    if is_manual != 0 {
        // Keep association/telemetry only — never re-enable or invent retries.
        if status == "failed" {
            let consecutive = schedule.consecutive_failures + 1;
            let auto_pause = consecutive >= AUTO_PAUSE_AFTER_FAILURES;
            let err = if auto_pause {
                format!(
                    "{} · 已自动暂停（连续失败 {consecutive} 次）",
                    error.unwrap_or("执行失败")
                )
            } else {
                error.unwrap_or("执行失败").to_string()
            };
            conn.execute(
                "UPDATE schedules SET last_error=?1, consecutive_failures=?2,
                 enabled=CASE WHEN ?3 THEN 0 ELSE enabled END, updated_at=?4 WHERE id=?5",
                params![err, consecutive, if auto_pause { 1 } else { 0 }, now, schedule_id],
            )
            .map_err(|e| format!("schedule manual failure update: {e}"))?;
        } else if status == "success" {
            conn.execute(
                "UPDATE schedules SET last_error=NULL, consecutive_failures=0, updated_at=?1 WHERE id=?2",
                params![now, schedule_id],
            )
            .map_err(|e| format!("schedule manual success update: {e}"))?;
        }
        return Ok(());
    }

    if status == "failed" {
        let consecutive = schedule.consecutive_failures + 1;
        let auto_pause = consecutive >= AUTO_PAUSE_AFTER_FAILURES;
        let err_msg = if auto_pause {
            format!(
                "{} · 已自动暂停（连续失败 {consecutive} 次）",
                error.unwrap_or("执行失败")
            )
        } else {
            error.unwrap_or("执行失败").to_string()
        };

        if !auto_pause && schedule.retry_attempt < schedule.max_retries {
            let next = format_unix_as_iso8601(
                now_u.saturating_add(schedule.retry_delay_secs.max(60) as u64),
            );
            conn.execute(
                "UPDATE schedules SET enabled=1, next_run_at=?1, last_error=?2,
                 retry_attempt=retry_attempt+1, consecutive_failures=?3, updated_at=?4 WHERE id=?5",
                params![next, err_msg, consecutive, now, schedule_id],
            )
            .map_err(|e| format!("schedule retry update: {e}"))?;
        } else {
            conn.execute(
                "UPDATE schedules SET enabled=?1, last_error=?2, consecutive_failures=?3,
                 retry_attempt=0, updated_at=?4 WHERE id=?5",
                params![
                    if auto_pause { 0 } else { if schedule.enabled { 1 } else { 0 } },
                    err_msg,
                    consecutive,
                    now,
                    schedule_id,
                ],
            )
            .map_err(|e| format!("schedule failure update: {e}"))?;
        }
    } else if status == "success" {
        conn.execute(
            "UPDATE schedules SET retry_attempt=0, last_error=NULL, consecutive_failures=0, updated_at=?1 WHERE id=?2",
            params![now, schedule_id],
        )
        .map_err(|e| format!("schedule success update: {e}"))?;
    }
    Ok(())
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
    use crate::repo::tasks::{create_goal, create_task_run_for_schedule, save_plan};
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
                cron_expr: None,
                window_start: None,
                window_end: None,
                overlap_policy: "queue".into(),
                max_retries: 0,
                retry_delay_secs: 300,
            },
        )
        .expect("create");
        assert_eq!(s.mode, "once");
        assert!(s.enabled);
        assert_eq!(list_schedules(&conn).unwrap().len(), 1);
    }

    fn cron_next_as_local(expr: &str, after_unix: u64) -> chrono::DateTime<Local> {
        let iso = next_cron_run_at(expr, after_unix).unwrap();
        let ts = parse_iso8601_unix(&iso).unwrap() as i64;
        DateTime::<Utc>::from_timestamp(ts, 0)
            .unwrap()
            .with_timezone(&Local)
    }

    #[test]
    fn cron_expression_advances_to_the_next_matching_minute() {
        use chrono::Timelike;

        let next = cron_next_as_local("*/5 * * * *", 0);
        assert_eq!(next.minute() % 5, 0);
        assert_eq!(next.second(), 0);
        assert!(next.timestamp() > 0);
        assert!(next_cron_run_at("bad cron", 0).is_err());
    }

    #[test]
    fn unix_weekday_range_maps_to_quartz_monday_through_friday() {
        use chrono::{Datelike, Timelike, Weekday};

        // Fields are local wall time: 09:00 on a weekday in the system timezone.
        let next = cron_next_as_local("0 9 * * 1-5", 0);
        assert_eq!(next.hour(), 9);
        assert_eq!(next.minute(), 0);
        assert!(matches!(
            next.weekday(),
            Weekday::Mon | Weekday::Tue | Weekday::Wed | Weekday::Thu | Weekday::Fri
        ));

        // Unix `1` = Monday. Without Quartz remapping, `1` would mean Sunday.
        let next_mon = cron_next_as_local("0 9 * * 1", 0);
        assert_eq!(next_mon.weekday(), Weekday::Mon);
        assert_eq!(next_mon.hour(), 9);

        let next_mon_named = cron_next_as_local("0 9 * * Mon", 0);
        assert_eq!(next_mon_named.weekday(), Weekday::Mon);
        assert_eq!(next_mon_named.hour(), 9);
    }

    #[test]
    fn cron_nine_am_is_local_wall_clock_not_utc() {
        use chrono::{Datelike, TimeZone, Timelike, Weekday};

        // Monday 08:00 local → next weekday 09:00 must be the same local day.
        let after = Local
            .with_ymd_and_hms(2026, 8, 3, 8, 0, 0)
            .single()
            .expect("valid local datetime");
        let next = cron_next_as_local("0 9 * * 1-5", after.timestamp() as u64);
        assert_eq!(next.date_naive(), after.date_naive());
        assert_eq!(next.weekday(), Weekday::Mon);
        assert_eq!(next.hour(), 9);
        assert_eq!(next.minute(), 0);

        // Proves we are not evaluating in UTC: the stored UTC hour equals local 09:00
        // converted to UTC (differs from 09 unless offset is zero).
        let utc_hour = next.with_timezone(&Utc).hour();
        let offset_secs = next.offset().local_minus_utc();
        let expected_utc_hour = ((9 * 3600 - offset_secs) / 3600).rem_euclid(24) as u32;
        assert_eq!(utc_hour, expected_utc_hour);
    }

    #[test]
    fn realign_cron_next_runs_updates_stale_utc_based_rows() {
        let (_tmp, conn) = setup();
        let tmpl = crate::repo::templates::list_templates(&conn).unwrap();
        let expr = "0 9 * * 1-5";
        let expected = next_cron_run_at(expr, now_unix()).unwrap();
        // Insert with a deliberately wrong next_run_at (pretend old UTC semantics).
        let s = create_schedule(
            &conn,
            ScheduleCreate {
                name: "stale cron".into(),
                template_id: tmpl[0].id.clone(),
                values_json: "{}".into(),
                mode: "cron".into(),
                interval_secs: None,
                next_run_at: "2099-01-01T00:00:00Z".into(),
                enabled: true,
                cron_expr: Some(expr.into()),
                window_start: None,
                window_end: None,
                overlap_policy: "queue".into(),
                max_retries: 0,
                retry_delay_secs: 300,
            },
        )
        .unwrap();
        // create_schedule already aligns cron; force a stale value to simulate pre-fix rows.
        conn.execute(
            "UPDATE schedules SET next_run_at=?1 WHERE id=?2",
            params!["2099-06-01T09:00:00Z", s.id],
        )
        .unwrap();

        let n = realign_cron_next_runs(&conn).unwrap();
        assert!(n >= 1);
        let after = get_schedule(&conn, &s.id).unwrap().unwrap();
        assert_eq!(after.next_run_at, expected);
    }

    #[test]
    fn create_cron_ignores_client_next_run_and_uses_expression() {
        let (_tmp, conn) = setup();
        let tmpl = crate::repo::templates::list_templates(&conn).unwrap();
        // UI-style trap: next_run_at = now + 5 minutes (does not match the cron).
        let soon = format_unix_as_iso8601(now_unix().saturating_add(300));
        let expr = "0 9 * * 1-5";
        let expected = next_cron_run_at(expr, now_unix()).unwrap();
        let s = create_schedule(
            &conn,
            ScheduleCreate {
                name: "weekday 9am".into(),
                template_id: tmpl[0].id.clone(),
                values_json: "{}".into(),
                mode: "cron".into(),
                interval_secs: None,
                next_run_at: soon.clone(),
                enabled: true,
                cron_expr: Some(expr.into()),
                window_start: None,
                window_end: None,
                overlap_policy: "queue".into(),
                max_retries: 0,
                retry_delay_secs: 300,
            },
        )
        .expect("create cron");
        assert_eq!(s.mode, "cron");
        assert_eq!(s.next_run_at, expected);
        // Unless the cron happens to land exactly on "soon", they must differ.
        if soon != expected {
            assert_ne!(s.next_run_at, soon);
        }
    }

    #[test]
    fn update_to_cron_realigns_next_run_to_expression() {
        let (_tmp, conn) = setup();
        let tmpl = crate::repo::templates::list_templates(&conn).unwrap();
        let soon = format_unix_as_iso8601(now_unix().saturating_add(300));
        let s = create_schedule(
            &conn,
            ScheduleCreate {
                name: "once then cron".into(),
                template_id: tmpl[0].id.clone(),
                values_json: "{}".into(),
                mode: "once".into(),
                interval_secs: None,
                next_run_at: soon.clone(),
                enabled: true,
                cron_expr: None,
                window_start: None,
                window_end: None,
                overlap_policy: "queue".into(),
                max_retries: 0,
                retry_delay_secs: 300,
            },
        )
        .unwrap();
        assert_eq!(s.next_run_at, soon);

        let expr = "0 9 * * 1-5";
        let expected = next_cron_run_at(expr, now_unix()).unwrap();
        let updated = update_schedule(
            &conn,
            &s.id,
            ScheduleUpdate {
                name: None,
                template_id: None,
                values_json: None,
                mode: Some("cron".into()),
                interval_secs: None,
                next_run_at: Some(soon.clone()),
                enabled: None,
                cron_expr: Some(Some(expr.into())),
                window_start: None,
                window_end: None,
                overlap_policy: None,
                max_retries: None,
                retry_delay_secs: None,
            },
        )
        .unwrap();
        assert_eq!(updated.mode, "cron");
        assert_eq!(updated.next_run_at, expected);
    }

    #[test]
    fn failed_once_schedule_retries_before_disabling() {
        let (_tmp, conn) = setup();
        let template = crate::repo::templates::list_templates(&conn).unwrap();
        let schedule = create_schedule(
            &conn,
            ScheduleCreate {
                name: "retry once".into(),
                template_id: template[0].id.clone(),
                values_json: "{}".into(),
                mode: "once".into(),
                interval_secs: None,
                next_run_at: "2099-01-01T00:00:00Z".into(),
                enabled: true,
                cron_expr: None,
                window_start: None,
                window_end: None,
                overlap_policy: "queue".into(),
                max_retries: 1,
                retry_delay_secs: 60,
            },
        )
        .unwrap();

        let first = mark_schedule_fired(&conn, &schedule.id, None, Some("boom")).unwrap();
        assert!(first.enabled);
        assert_eq!(first.retry_attempt, 1);
        assert_eq!(first.last_error.as_deref(), Some("boom"));

        let final_attempt = mark_schedule_fired(&conn, &schedule.id, None, Some("boom")).unwrap();
        assert!(!final_attempt.enabled);
        assert_eq!(final_attempt.retry_attempt, 0);
    }

    fn insert_schedule_linked_run(
        conn: &Connection,
        schedule_id: &str,
        is_manual: bool,
    ) -> String {
        let goal = create_goal(conn, "goal", None).expect("goal");
        let plan = save_plan(conn, &goal.id, r#"{"intent":{"summary":"x"},"subtasks":[]}"#)
            .expect("plan");
        let run = create_task_run_for_schedule(
            conn,
            &goal.id,
            &plan.id,
            Some(schedule_id),
            is_manual,
        )
        .expect("run");
        run.id
    }

    #[test]
    fn failed_manual_run_does_not_reenable_or_retry_paused_schedule() {
        let (_tmp, conn) = setup();
        let template = crate::repo::templates::list_templates(&conn).unwrap();
        let schedule = create_schedule(
            &conn,
            ScheduleCreate {
                name: "paused manual".into(),
                template_id: template[0].id.clone(),
                values_json: "{}".into(),
                mode: "interval".into(),
                interval_secs: Some(3600),
                next_run_at: "2099-01-01T00:00:00Z".into(),
                enabled: false,
                cron_expr: None,
                window_start: None,
                window_end: None,
                overlap_policy: "queue".into(),
                max_retries: 2,
                retry_delay_secs: 60,
            },
        )
        .unwrap();
        let next_before = schedule.next_run_at.clone();
        let run_id = insert_schedule_linked_run(&conn, &schedule.id, true);

        record_schedule_run_result(&conn, &run_id, "failed", Some("manual boom")).unwrap();

        let after = get_schedule(&conn, &schedule.id).unwrap().unwrap();
        assert!(!after.enabled, "paused schedule must stay disabled");
        assert_eq!(after.next_run_at, next_before, "manual failure must not change cadence");
        assert_eq!(after.retry_attempt, 0, "manual failure must not invent retries");
        assert_eq!(after.last_error.as_deref(), Some("manual boom"));
    }

    #[test]
    fn failed_scheduled_run_still_retries_when_enabled() {
        let (_tmp, conn) = setup();
        let template = crate::repo::templates::list_templates(&conn).unwrap();
        let schedule = create_schedule(
            &conn,
            ScheduleCreate {
                name: "auto retry".into(),
                template_id: template[0].id.clone(),
                values_json: "{}".into(),
                mode: "interval".into(),
                interval_secs: Some(3600),
                next_run_at: "2099-01-01T00:00:00Z".into(),
                enabled: true,
                cron_expr: None,
                window_start: None,
                window_end: None,
                overlap_policy: "queue".into(),
                max_retries: 2,
                retry_delay_secs: 60,
            },
        )
        .unwrap();
        let run_id = insert_schedule_linked_run(&conn, &schedule.id, false);

        record_schedule_run_result(&conn, &run_id, "failed", Some("auto boom")).unwrap();

        let after = get_schedule(&conn, &schedule.id).unwrap().unwrap();
        assert!(after.enabled);
        assert_eq!(after.retry_attempt, 1);
        assert_ne!(after.next_run_at, "2099-01-01T00:00:00Z");
        assert_eq!(after.last_error.as_deref(), Some("auto boom"));
    }
}
