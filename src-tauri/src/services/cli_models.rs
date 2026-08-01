//! Live model catalogs from local CLIs (cursor-agent / codex / opencode).
use crate::services::cli_probe::resolve_engine_binary;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CACHE_TTL: Duration = Duration::from_secs(10 * 60);

/// Effort suffixes matched longest-first when splitting Cursor model ids.
const CURSOR_EFFORT_SUFFIXES: &[&str] = &["xhigh", "medium", "high", "low", "max"];

/// Preferred display order for Cursor efforts when merging.
const CURSOR_EFFORT_ORDER: &[&str] = &["low", "medium", "high", "xhigh", "max"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EngineModel {
    pub id: String,
    pub display_name: String,
    pub efforts: Vec<String>,
    pub default_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EngineModelCatalog {
    pub engine: String,
    pub models: Vec<EngineModel>,
    pub fetched_at: i64,
}

struct CacheEntry {
    catalog: EngineModelCatalog,
    fetched: Instant,
}

static CACHE: Mutex<Option<HashMap<String, CacheEntry>>> = Mutex::new(None);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// List models for an engine. Uses a 10-minute in-process cache unless `refresh`.
pub fn list_engine_models(engine: &str, refresh: bool) -> Result<EngineModelCatalog, String> {
    let engine = normalize_engine(engine)?;

    if !refresh {
        if let Ok(guard) = CACHE.lock() {
            if let Some(map) = guard.as_ref() {
                if let Some(entry) = map.get(engine) {
                    if entry.fetched.elapsed() < CACHE_TTL {
                        return Ok(entry.catalog.clone());
                    }
                }
            }
        }
    }

    let catalog = fetch_catalog(engine)?;

    if let Ok(mut guard) = CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(
            engine.to_string(),
            CacheEntry {
                catalog: catalog.clone(),
                fetched: Instant::now(),
            },
        );
    }

    Ok(catalog)
}

fn normalize_engine(engine: &str) -> Result<&'static str, String> {
    match engine.trim() {
        "cursor-agent" => Ok("cursor-agent"),
        "codex" => Ok("codex"),
        "opencode" => Ok("opencode"),
        other => Err(format!("unsupported engine: {other}")),
    }
}

fn fetch_catalog(engine: &str) -> Result<EngineModelCatalog, String> {
    let bin = resolve_engine_binary(engine)
        .ok_or_else(|| format!("CLI not found: {engine}"))?;

    let (args, parser): (Vec<&str>, fn(&str) -> Result<Vec<EngineModel>, String>) = match engine {
        "codex" => (vec!["debug", "models"], parse_codex_models),
        "opencode" => (vec!["models", "--verbose"], parse_opencode_models),
        "cursor-agent" => (vec!["models"], parse_cursor_models),
        _ => return Err(format!("unsupported engine: {engine}")),
    };

    let output = Command::new(&bin)
        .args(&args)
        .output()
        .map_err(|e| format!("failed to run {engine}: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let snippet = stderr.trim();
        let snippet = if snippet.is_empty() {
            stdout.trim()
        } else {
            snippet
        };
        let snippet: String = snippet.chars().take(400).collect();
        return Err(format!(
            "{engine} models failed (exit {:?}): {snippet}",
            output.status.code()
        ));
    }

    let models = parser(&stdout).map_err(|e| {
        let snippet: String = stderr.chars().take(200).collect();
        if snippet.trim().is_empty() {
            e
        } else {
            format!("{e}; stderr: {snippet}")
        }
    })?;

    Ok(EngineModelCatalog {
        engine: engine.to_string(),
        models,
        fetched_at: now_ms(),
    })
}

// ---------------------------------------------------------------------------
// Codex: `codex debug models` → JSON { models: [...] }
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct CodexCatalog {
    models: Vec<CodexModel>,
}

#[derive(Debug, Deserialize)]
struct CodexModel {
    slug: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    default_reasoning_level: Option<String>,
    #[serde(default)]
    supported_reasoning_levels: Vec<CodexReasoningLevel>,
}

#[derive(Debug, Deserialize)]
struct CodexReasoningLevel {
    effort: String,
}

fn parse_codex_models(stdout: &str) -> Result<Vec<EngineModel>, String> {
    let trimmed = stdout.trim();
    let start = trimmed
        .find('{')
        .ok_or_else(|| "codex models: no JSON object in output".to_string())?;
    let catalog: CodexCatalog = serde_json::from_str(&trimmed[start..])
        .map_err(|e| format!("codex models: JSON parse error: {e}"))?;

    Ok(catalog
        .models
        .into_iter()
        .filter(|m| !m.slug.trim().is_empty())
        .map(|m| {
            let efforts: Vec<String> = m
                .supported_reasoning_levels
                .into_iter()
                .map(|l| l.effort)
                .filter(|e| !e.trim().is_empty())
                .collect();
            let default_effort = m
                .default_reasoning_level
                .filter(|e| efforts.iter().any(|x| x == e))
                .or_else(|| efforts.first().cloned());
            EngineModel {
                id: m.slug,
                display_name: m
                    .display_name
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| String::new()),
                efforts,
                default_effort,
            }
        })
        .map(|mut m| {
            if m.display_name.is_empty() {
                m.display_name = m.id.clone();
            }
            m
        })
        .collect())
}

// ---------------------------------------------------------------------------
// OpenCode: `opencode models --verbose` → provider/id\n{json}\n...
// ---------------------------------------------------------------------------

fn parse_opencode_models(stdout: &str) -> Result<Vec<EngineModel>, String> {
    let mut models = Vec::new();
    let lines: Vec<&str> = stdout.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        i += 1;
        if line.is_empty() || !line.contains('/') {
            continue;
        }
        // Next non-empty line should start a JSON object.
        while i < lines.len() && lines[i].trim().is_empty() {
            i += 1;
        }
        if i >= lines.len() || !lines[i].trim_start().starts_with('{') {
            continue;
        }
        let (json, next_i) = extract_json_object(&lines, i)?;
        i = next_i;

        let value: serde_json::Value = serde_json::from_str(&json)
            .map_err(|e| format!("opencode models: JSON parse error near {line}: {e}"))?;

        let id = value
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let provider = value
            .get("providerID")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if id.is_empty() || provider.is_empty() {
            continue;
        }
        let full_id = format!("{provider}/{id}");
        let display_name = value
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(id)
            .to_string();

        let mut efforts = Vec::new();
        if let Some(variants) = value.get("variants").and_then(|v| v.as_object()) {
            for key in variants.keys() {
                if !key.trim().is_empty() {
                    efforts.push(key.clone());
                }
            }
        }
        // Stable-ish order: known efforts first, then remaining alpha.
        sort_efforts(&mut efforts);

        let default_effort = if efforts.iter().any(|e| e == "medium") {
            Some("medium".into())
        } else {
            efforts.first().cloned()
        };

        models.push(EngineModel {
            id: full_id,
            display_name,
            efforts,
            default_effort,
        });
    }

    if models.is_empty() {
        return Err("opencode models: no models parsed".into());
    }
    Ok(models)
}

fn extract_json_object(lines: &[&str], start: usize) -> Result<(String, usize), String> {
    let mut depth = 0i32;
    let mut buf = String::new();
    for (idx, line) in lines.iter().enumerate().skip(start) {
        if !buf.is_empty() {
            buf.push('\n');
        }
        buf.push_str(line);
        for ch in line.chars() {
            match ch {
                '{' => depth += 1,
                '}' => depth -= 1,
                _ => {}
            }
        }
        if depth == 0 && !buf.trim().is_empty() {
            return Ok((buf, idx + 1));
        }
        if depth < 0 {
            return Err("opencode models: unbalanced JSON".into());
        }
    }
    Err("opencode models: unterminated JSON object".into())
}

fn sort_efforts(efforts: &mut Vec<String>) {
    efforts.sort_by(|a, b| {
        let ia = CURSOR_EFFORT_ORDER
            .iter()
            .position(|x| *x == a.as_str())
            .unwrap_or(100);
        let ib = CURSOR_EFFORT_ORDER
            .iter()
            .position(|x| *x == b.as_str())
            .unwrap_or(100);
        ia.cmp(&ib).then_with(|| a.cmp(b))
    });
    efforts.dedup();
}

// ---------------------------------------------------------------------------
// Cursor Agent: `cursor-agent models` → "id - Display Name" lines
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct CursorRow {
    base: String,
    effort: Option<String>,
    fast: bool,
    display: String,
}

/// Split a Cursor model id into (base, effort?, was_fast).
pub fn split_cursor_model_id(raw: &str) -> (String, Option<String>, bool) {
    let mut s = raw.trim();
    let mut fast = false;
    if let Some(rest) = s.strip_suffix("-fast") {
        if !rest.is_empty() {
            s = rest;
            fast = true;
        }
    }
    for effort in CURSOR_EFFORT_SUFFIXES {
        let suffix = format!("-{effort}");
        if let Some(stem) = s.strip_suffix(suffix.as_str()) {
            if !stem.is_empty() {
                return (stem.to_string(), Some((*effort).to_string()), fast);
            }
        }
    }
    (s.to_string(), None, fast)
}

/// Compose Cursor `--model` id from base + effort (suffix form).
pub fn compose_cursor_model_id(base: &str, effort: Option<&str>) -> String {
    let base = base.trim();
    let (stem, existing, _) = split_cursor_model_id(base);
    if existing.is_some() {
        // Already has an effort suffix — leave as-is.
        return base.to_string();
    }
    match effort.map(str::trim).filter(|e| !e.is_empty()) {
        Some(e) => format!("{stem}-{e}"),
        None => stem,
    }
}

fn parse_cursor_models(stdout: &str) -> Result<Vec<EngineModel>, String> {
    let mut rows: Vec<CursorRow> = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() || line.eq_ignore_ascii_case("Available models") {
            continue;
        }
        let (id, display) = match line.split_once(" - ") {
            Some((id, display)) => (id.trim(), display.trim()),
            None => continue,
        };
        if id.is_empty() {
            continue;
        }
        let (base, effort, fast) = split_cursor_model_id(id);
        rows.push(CursorRow {
            base,
            effort,
            fast,
            display: if display.is_empty() {
                id.to_string()
            } else {
                display.to_string()
            },
        });
    }

    if rows.is_empty() {
        return Err("cursor-agent models: no models parsed".into());
    }

    // Preserve first-seen base order.
    let mut order: Vec<String> = Vec::new();
    let mut by_base: HashMap<String, Vec<CursorRow>> = HashMap::new();
    for row in rows {
        if !by_base.contains_key(&row.base) {
            order.push(row.base.clone());
        }
        by_base.entry(row.base.clone()).or_default().push(row);
    }

    let mut models = Vec::with_capacity(order.len());
    for base in order {
        let group = by_base.remove(&base).unwrap_or_default();
        let mut efforts: Vec<String> = group
            .iter()
            .filter_map(|r| r.effort.clone())
            .collect();
        sort_efforts(&mut efforts);

        let display_name = pick_cursor_display_name(&group, &base);
        let default_effort = if efforts.iter().any(|e| e == "high") {
            Some("high".into())
        } else if efforts.iter().any(|e| e == "medium") {
            Some("medium".into())
        } else {
            efforts.first().cloned()
        };

        models.push(EngineModel {
            id: base,
            display_name,
            efforts,
            default_effort,
        });
    }

    Ok(models)
}

fn pick_cursor_display_name(group: &[CursorRow], base: &str) -> String {
    // Prefer non-fast + high.
    if let Some(row) = group
        .iter()
        .find(|r| !r.fast && r.effort.as_deref() == Some("high"))
    {
        return row.display.clone();
    }
    // Prefer any non-fast with an effort, else any non-fast, else first.
    if let Some(row) = group.iter().find(|r| !r.fast && r.effort.is_some()) {
        return row.display.clone();
    }
    if let Some(row) = group.iter().find(|r| !r.fast) {
        return row.display.clone();
    }
    group
        .first()
        .map(|r| r.display.clone())
        .unwrap_or_else(|| base.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_cursor_effort_and_fast() {
        assert_eq!(
            split_cursor_model_id("gpt-5.6-sol-high-fast"),
            ("gpt-5.6-sol".into(), Some("high".into()), true)
        );
        assert_eq!(
            split_cursor_model_id("gpt-5.6-sol-xhigh"),
            ("gpt-5.6-sol".into(), Some("xhigh".into()), false)
        );
        assert_eq!(
            split_cursor_model_id("composer-2.5"),
            ("composer-2.5".into(), None, false)
        );
        assert_eq!(
            split_cursor_model_id("composer-2.5-fast"),
            ("composer-2.5".into(), None, true)
        );
        assert_eq!(
            split_cursor_model_id("claude-opus-5-thinking-medium"),
            ("claude-opus-5-thinking".into(), Some("medium".into()), false)
        );
    }

    #[test]
    fn compose_cursor_model_id_suffix() {
        assert_eq!(
            compose_cursor_model_id("gpt-5.6-sol", Some("high")),
            "gpt-5.6-sol-high"
        );
        assert_eq!(compose_cursor_model_id("auto", None), "auto");
        assert_eq!(
            compose_cursor_model_id("gpt-5.6-sol-high", Some("low")),
            "gpt-5.6-sol-high"
        );
    }

    #[test]
    fn parse_cursor_merges_efforts() {
        let stdout = r#"
Available models

auto - Auto (default)
gpt-5.6-sol-high - GPT-5.6 Sol 1M High
gpt-5.6-sol-high-fast - GPT-5.6 Sol High Fast
gpt-5.6-sol-xhigh - GPT-5.6 Sol 1M Extra High
composer-2.5 - Composer 2.5
composer-2.5-fast - Composer 2.5 Fast
"#;
        let models = parse_cursor_models(stdout).expect("parse");
        let sol = models.iter().find(|m| m.id == "gpt-5.6-sol").unwrap();
        assert_eq!(sol.efforts, vec!["high", "xhigh"]);
        assert_eq!(sol.default_effort.as_deref(), Some("high"));
        assert_eq!(sol.display_name, "GPT-5.6 Sol 1M High");

        let composer = models.iter().find(|m| m.id == "composer-2.5").unwrap();
        assert!(composer.efforts.is_empty());
        assert_eq!(composer.display_name, "Composer 2.5");

        let auto = models.iter().find(|m| m.id == "auto").unwrap();
        assert!(auto.efforts.is_empty());
    }

    #[test]
    fn parse_codex_catalog() {
        let stdout = r#"{
  "models": [
    {
      "slug": "gpt-5.6-sol",
      "display_name": "GPT-5.6-Sol",
      "default_reasoning_level": "low",
      "supported_reasoning_levels": [
        {"effort": "low", "description": "Fast"},
        {"effort": "high", "description": "Deep"}
      ]
    }
  ]
}"#;
        let models = parse_codex_models(stdout).expect("parse");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-5.6-sol");
        assert_eq!(models[0].efforts, vec!["low", "high"]);
        assert_eq!(models[0].default_effort.as_deref(), Some("low"));
    }

    #[test]
    fn parse_opencode_verbose() {
        let stdout = r#"opencode/laguna-s-2.1-free
{
  "id": "laguna-s-2.1-free",
  "providerID": "opencode",
  "name": "Laguna S 2.1 Free",
  "variants": {
    "high": { "reasoningEffort": "high" },
    "low": { "reasoningEffort": "low" },
    "medium": { "reasoningEffort": "medium" }
  }
}
opencode/mimo-v2.5-free
{
  "id": "mimo-v2.5-free",
  "providerID": "opencode",
  "name": "MiMo V2.5 Free",
  "variants": {}
}
"#;
        let models = parse_opencode_models(stdout).expect("parse");
        assert_eq!(models.len(), 2);
        let laguna = &models[0];
        assert_eq!(laguna.id, "opencode/laguna-s-2.1-free");
        assert_eq!(laguna.efforts, vec!["low", "medium", "high"]);
        assert_eq!(laguna.default_effort.as_deref(), Some("medium"));
        assert!(models[1].efforts.is_empty());
    }
}
