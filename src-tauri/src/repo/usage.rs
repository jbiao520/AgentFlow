//! Token usage persistence + aggregation for overview dashboards.
use crate::db::now_iso8601;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// One recorded execution's token usage (node_usage row).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeUsageInsert {
    pub run_id: String,
    pub node_id: String,
    pub engine: String,
    pub provider: String,
    pub model: Option<String>,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_write_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
    pub cost: Option<f64>,
    pub estimated: bool,
}

/// Aggregated usage grouped by engine/provider/model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageBreakdown {
    pub engine: String,
    pub provider: String,
    pub model: String,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_write_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
    pub total_tokens: u64,
    pub cost: Option<f64>,
    pub estimated: bool,
    pub runs: u64,
}

pub fn record_node_usage(conn: &Connection, u: &NodeUsageInsert) -> Result<(), String> {
    conn.execute(
        "INSERT INTO node_usage (
            run_id, node_id, engine, provider, model,
            input_tokens, cached_input_tokens, cache_write_input_tokens,
            output_tokens, reasoning_tokens, cost, estimated, recorded_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            u.run_id,
            u.node_id,
            u.engine,
            u.provider,
            u.model,
            u.input_tokens as i64,
            u.cached_input_tokens as i64,
            u.cache_write_input_tokens as i64,
            u.output_tokens as i64,
            u.reasoning_tokens as i64,
            u.cost,
            u.estimated as i64,
            now_iso8601(),
        ],
    )
    .map_err(|e| format!("record_node_usage: {e}"))?;
    Ok(())
}

/// Aggregate all recorded usage by engine/provider/model, most tokens first.
pub fn summarize_node_usage(conn: &Connection) -> Result<Vec<UsageBreakdown>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT
                engine,
                COALESCE(NULLIF(provider, ''), engine) AS provider,
                COALESCE(NULLIF(model, ''), 'unknown') AS model,
                SUM(input_tokens) AS input_tokens,
                SUM(cached_input_tokens) AS cached_input_tokens,
                SUM(cache_write_input_tokens) AS cache_write_input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(reasoning_tokens) AS reasoning_tokens,
                SUM(COALESCE(cost, 0)) AS cost,
                MAX(estimated) AS estimated,
                COUNT(*) AS runs
             FROM node_usage
             GROUP BY engine, provider, model
             ORDER BY SUM(input_tokens + output_tokens + reasoning_tokens) DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let engine: String = r.get(0)?;
            let input: i64 = r.get(3)?;
            let cached: i64 = r.get(4)?;
            let cache_write: i64 = r.get(5)?;
            let output: i64 = r.get(6)?;
            let reasoning: i64 = r.get(7)?;
            let cost: f64 = r.get(8)?;
            let estimated: i64 = r.get(9)?;
            let runs: i64 = r.get(10)?;
            let total = (input as u64)
                .saturating_add(output as u64)
                .saturating_add(reasoning as u64)
                .saturating_add(if engine == "codex" {
                    0
                } else {
                    (cached as u64).saturating_add(cache_write as u64)
                });
            Ok(UsageBreakdown {
                engine,
                provider: r.get(1)?,
                model: r.get(2)?,
                input_tokens: input as u64,
                cached_input_tokens: cached as u64,
                cache_write_input_tokens: cache_write as u64,
                output_tokens: output as u64,
                reasoning_tokens: reasoning as u64,
                total_tokens: total,
                cost: if cost > 0.0 { Some(cost) } else { None },
                estimated: estimated > 0,
                runs: runs as u64,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
