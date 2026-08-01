//! Live model catalogs from local CLIs (cursor-agent / codex / opencode).
use crate::services::cli_probe::resolve_engine_binary;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CACHE_TTL: Duration = Duration::from_secs(10 * 60);

/// Effort suffixes matched longest-first when splitting Cursor model ids.
/// `extra-high` is Cursor's spelling of xhigh on some families (e.g. gpt-5.5).
/// `minimal` appears on Gemini flash variants.
const CURSOR_EFFORT_SUFFIXES: &[&str] = &[
    "extra-high",
    "xhigh",
    "medium",
    "high",
    "low",
    "max",
    "none",
    "minimal",
];

/// Preferred display order for Cursor efforts when merging.
const CURSOR_EFFORT_ORDER: &[&str] = &[
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "extra-high",
    "max",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EngineModel {
    pub id: String,
    pub display_name: String,
    pub efforts: Vec<String>,
    pub default_effort: Option<String>,
    /// Cursor only: base model has at least one `-fast` variant in the live catalog.
    #[serde(default)]
    pub supports_fast: bool,
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
                supports_fast: false,
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
            supports_fast: false,
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

/// Compose Cursor `--model` id from base + effort + optional `-fast`.
///
/// Cursor catalogs often have no bare base id (only `-none`/`-low`/… variants),
/// so an explicit `none` effort becomes the `-none` suffix.
pub fn compose_cursor_model_id(base: &str, effort: Option<&str>, fast: bool) -> String {
    let base = base.trim();
    let (stem, existing, had_fast) = split_cursor_model_id(base);
    let use_fast = fast || had_fast;
    let with_effort = if existing.is_some() {
        // Already has an effort suffix — keep stem as-is (ignore effort override).
        base.trim()
            .strip_suffix("-fast")
            .filter(|s| !s.is_empty())
            .unwrap_or(base.trim())
            .to_string()
    } else {
        match effort.map(str::trim).filter(|e| !e.is_empty()) {
            Some(e) => format!("{stem}-{e}"),
            None => stem,
        }
    };
    if use_fast {
        format!("{with_effort}-fast")
    } else {
        with_effort
    }
}

/// Parse `{"fast": true}` from agent `engine_options_json`.
pub fn engine_options_fast(json: Option<&str>) -> bool {
    let raw = json.map(str::trim).unwrap_or("");
    if raw.is_empty() {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| v.get("fast").and_then(|f| f.as_bool()))
        .unwrap_or(false)
}

/// Build minimal engine_options_json for the Fast toggle.
pub fn engine_options_with_fast(fast: bool) -> String {
    if fast {
        r#"{"fast":true}"#.to_string()
    } else {
        "{}".to_string()
    }
}

/// Resolve the effort that should actually be sent to a CLI.
///
/// Models that advertise **no** efforts (e.g. Cursor `composer-2.5`, `auto`)
/// must never receive a suffix / variant / `-c model_reasoning_effort` — a
/// leftover profile default like `medium` would break the run.
///
/// `none` is only kept when the live catalog lists it (Cursor `-none` variants).
/// Other engines treat `none` as "omit the effort flag".
///
/// When the live catalog cannot be loaded, the requested effort is passed
/// through unchanged (caller may still have validated earlier) — except bare
/// `none`, which still means omit.
pub fn effective_reasoning_effort(
    engine: &str,
    model: Option<&str>,
    requested: Option<&str>,
) -> Option<String> {
    let effort = requested?.trim();
    if effort.is_empty() {
        return None;
    }
    let is_none = effort.eq_ignore_ascii_case("none");
    let model = match model.map(str::trim).filter(|m| !m.is_empty()) {
        Some(m) => m,
        None => {
            return if is_none {
                None
            } else {
                Some(effort.to_string())
            };
        }
    };
    match list_engine_models(engine, false) {
        Ok(catalog) => {
            if let Some(m) = catalog.models.iter().find(|m| m.id == model) {
                if m.efforts.is_empty() {
                    return None;
                }
                if is_none {
                    return if m.efforts.iter().any(|e| e.eq_ignore_ascii_case("none")) {
                        Some("none".into())
                    } else {
                        None
                    };
                }
            } else if is_none {
                return None;
            }
            Some(effort.to_string())
        }
        Err(_) => {
            if is_none {
                None
            } else {
                Some(effort.to_string())
            }
        }
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
        let supports_fast = group.iter().any(|r| r.fast);

        models.push(EngineModel {
            id: base,
            display_name,
            efforts,
            default_effort,
            supports_fast,
        });
    }

    Ok(models)
}

fn pick_cursor_display_name(group: &[CursorRow], base: &str) -> String {
    // Prefer names that are already effort-neutral (bare / medium), then high.
    let preference = [
        None,
        Some("medium"),
        Some("high"),
        Some("xhigh"),
        Some("extra-high"),
        Some("max"),
        Some("low"),
        Some("minimal"),
        Some("none"),
    ];
    let mut raw = None;
    for want in preference {
        if let Some(row) = group
            .iter()
            .find(|r| !r.fast && r.effort.as_deref() == want)
        {
            raw = Some(row.display.clone());
            break;
        }
    }
    if raw.is_none() {
        if let Some(row) = group.iter().find(|r| !r.fast) {
            raw = Some(row.display.clone());
        } else {
            raw = group.first().map(|r| r.display.clone());
        }
    }
    let raw = raw.unwrap_or_else(|| base.to_string());
    strip_effort_from_display(&raw)
}

/// Remove effort / Fast adjectives from Cursor catalog display names so the
/// model dropdown stays effort-neutral (effort is chosen via pills).
fn strip_effort_from_display(display: &str) -> String {
    let mut s = display.trim().to_string();
    if let Some(rest) = s.strip_suffix(" Fast") {
        if !rest.is_empty() {
            s = rest.trim_end().to_string();
        }
    }

    // Longest phrases first so "Extra High" wins over "High".
    const PHRASES: &[&str] = &[
        " Extra High",
        " Extra-High",
        " Medium",
        " High",
        " Low",
        " Max",
        " None",
        " Minimal",
        " Xhigh",
        " XHigh",
    ];

    for phrase in PHRASES {
        if let Some(rest) = s.strip_suffix(phrase) {
            if !rest.is_empty() {
                s = rest.trim_end().to_string();
                break;
            }
        }
        // e.g. "Opus 5 1M Low Thinking" / "Fable 5 1M Extra High Thinking (NO ZDR)"
        let before_thinking = format!("{phrase} Thinking");
        if let Some(idx) = s.find(&before_thinking) {
            s = format!("{} Thinking{}", &s[..idx], &s[idx + before_thinking.len()..]);
            break;
        }
        // e.g. "Fable 5 1M High (NO ZDR)"
        let before_paren = format!("{phrase} (");
        if let Some(idx) = s.find(&before_paren) {
            s = format!("{} ({}", &s[..idx], &s[idx + before_paren.len()..]);
            break;
        }
    }

    while s.contains("  ") {
        s = s.replace("  ", " ");
    }
    s.trim().to_string()
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
            split_cursor_model_id("gpt-5.6-sol-none"),
            ("gpt-5.6-sol".into(), Some("none".into()), false)
        );
        assert_eq!(
            split_cursor_model_id("gpt-5.5-extra-high"),
            ("gpt-5.5".into(), Some("extra-high".into()), false)
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
            compose_cursor_model_id("gpt-5.6-sol", Some("high"), false),
            "gpt-5.6-sol-high"
        );
        assert_eq!(
            compose_cursor_model_id("gpt-5.6-sol", Some("high"), true),
            "gpt-5.6-sol-high-fast"
        );
        assert_eq!(compose_cursor_model_id("auto", None, false), "auto");
        assert_eq!(compose_cursor_model_id("auto", None, true), "auto-fast");
        assert_eq!(
            compose_cursor_model_id("gpt-5.6-sol-high", Some("low"), false),
            "gpt-5.6-sol-high"
        );
        assert_eq!(
            compose_cursor_model_id("composer-2.5-fast", None, false),
            "composer-2.5-fast"
        );
        assert_eq!(
            compose_cursor_model_id("composer-2.5", None, true),
            "composer-2.5-fast"
        );
        // Empty effort → bare base. Explicit `none` → `-none` (Cursor catalog).
        assert_eq!(
            compose_cursor_model_id("composer-2.5", Some(""), false),
            "composer-2.5"
        );
        assert_eq!(
            compose_cursor_model_id("gpt-5.6-sol", Some("none"), false),
            "gpt-5.6-sol-none"
        );
        assert_eq!(
            compose_cursor_model_id("gpt-5.5", Some("extra-high"), false),
            "gpt-5.5-extra-high"
        );
    }

    #[test]
    fn effective_reasoning_drops_when_model_has_no_efforts() {
        let catalog = EngineModelCatalog {
            engine: "cursor-agent".into(),
            models: vec![
                EngineModel {
                    id: "composer-2.5".into(),
                    display_name: "Composer 2.5".into(),
                    efforts: vec![],
                    default_effort: None,
                    supports_fast: true,
                },
                EngineModel {
                    id: "gpt-5.6-sol".into(),
                    display_name: "Sol".into(),
                    efforts: vec![
                        "none".into(),
                        "medium".into(),
                        "high".into(),
                    ],
                    default_effort: Some("high".into()),
                    supports_fast: true,
                },
            ],
            fetched_at: 0,
        };
        {
            let mut guard = CACHE.lock().unwrap();
            let map = guard.get_or_insert_with(HashMap::new);
            map.insert(
                "cursor-agent".into(),
                CacheEntry {
                    catalog: catalog.clone(),
                    fetched: Instant::now(),
                },
            );
        }

        assert_eq!(
            effective_reasoning_effort(
                "cursor-agent",
                Some("composer-2.5"),
                Some("medium")
            ),
            None,
            "composer must not keep a leftover medium"
        );
        assert_eq!(
            effective_reasoning_effort("cursor-agent", Some("gpt-5.6-sol"), Some("high")),
            Some("high".into())
        );
        assert_eq!(
            effective_reasoning_effort("cursor-agent", Some("gpt-5.6-sol"), Some("none")),
            Some("none".into()),
            "Cursor -none is a real catalog effort"
        );
        assert_eq!(
            effective_reasoning_effort("cursor-agent", Some("composer-2.5"), Some("none")),
            None,
            "composer has no efforts — drop none"
        );
        assert_eq!(
            effective_reasoning_effort("cursor-agent", Some("composer-2.5"), None),
            None
        );
    }

    #[test]
    fn engine_options_fast_roundtrip() {
        assert!(!engine_options_fast(None));
        assert!(!engine_options_fast(Some("{}")));
        assert!(!engine_options_fast(Some(r#"{"fast":false}"#)));
        assert!(engine_options_fast(Some(r#"{"fast":true}"#)));
        assert_eq!(engine_options_with_fast(true), r#"{"fast":true}"#);
        assert_eq!(engine_options_with_fast(false), "{}");
    }

    #[test]
    fn parse_cursor_merges_efforts() {
        let stdout = r#"
Available models

auto - Auto (default)
gpt-5.6-sol-high - GPT-5.6 Sol 1M High
gpt-5.6-sol-high-fast - GPT-5.6 Sol High Fast
gpt-5.6-sol-xhigh - GPT-5.6 Sol 1M Extra High
gpt-5.6-sol-medium - GPT-5.6 Sol 1M
gpt-5.6-sol-none - GPT-5.6 Sol 1M None
gpt-5.5-high - GPT-5.5 1M High
gpt-5.5-extra-high - GPT-5.5 1M Extra High
gpt-5.5-medium - GPT-5.5 1M
composer-2.5 - Composer 2.5
composer-2.5-fast - Composer 2.5 Fast
kimi-k3-high - Kimi K3 High
kimi-k3-low - Kimi K3 Low
kimi-k3-max - Kimi K3
"#;
        let models = parse_cursor_models(stdout).expect("parse");
        let sol = models.iter().find(|m| m.id == "gpt-5.6-sol").unwrap();
        assert_eq!(sol.efforts, vec!["none", "medium", "high", "xhigh"]);
        assert_eq!(sol.default_effort.as_deref(), Some("high"));
        assert_eq!(sol.display_name, "GPT-5.6 Sol 1M");
        assert!(sol.supports_fast);

        let gpt55 = models.iter().find(|m| m.id == "gpt-5.5").unwrap();
        assert_eq!(gpt55.efforts, vec!["medium", "high", "extra-high"]);
        assert_eq!(gpt55.display_name, "GPT-5.5 1M");
        assert!(
            models.iter().all(|m| m.id != "gpt-5.5-extra"),
            "extra-high must not split into a separate base"
        );

        let kimi = models.iter().find(|m| m.id == "kimi-k3").unwrap();
        assert_eq!(kimi.efforts, vec!["low", "high", "max"]);
        assert_eq!(kimi.display_name, "Kimi K3");

        let composer = models.iter().find(|m| m.id == "composer-2.5").unwrap();
        assert!(composer.efforts.is_empty());
        assert_eq!(composer.display_name, "Composer 2.5");
        assert!(composer.supports_fast);

        let auto = models.iter().find(|m| m.id == "auto").unwrap();
        assert!(auto.efforts.is_empty());
        assert!(!auto.supports_fast);
    }

    #[test]
    fn strip_effort_words_from_display() {
        assert_eq!(
            strip_effort_from_display("GPT-5.6 Sol 1M High"),
            "GPT-5.6 Sol 1M"
        );
        assert_eq!(
            strip_effort_from_display("GPT-5.6 Sol 1M Extra High"),
            "GPT-5.6 Sol 1M"
        );
        assert_eq!(
            strip_effort_from_display("Opus 5 1M Low Thinking"),
            "Opus 5 1M Thinking"
        );
        assert_eq!(
            strip_effort_from_display("Fable 5 1M Extra High Thinking (NO ZDR)"),
            "Fable 5 1M Thinking (NO ZDR)"
        );
        assert_eq!(strip_effort_from_display("Kimi K3 High"), "Kimi K3");
        assert_eq!(
            strip_effort_from_display("Cursor Grok 4.5"),
            "Cursor Grok 4.5"
        );
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
