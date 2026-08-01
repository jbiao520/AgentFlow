//! Per-model token pricing used to estimate cost when the CLI does not report it.
//! OpenCode reports a real `cost`; Codex and cursor-agent report token counts
//! only, so we fall back to these published-ish rates (USD per 1M tokens). All
//! values are heuristic estimates and the UI labels them as such.
use crate::engines::adapter::TokenUsage;

#[derive(Debug, Clone, Copy)]
pub struct Price {
    pub input_1m: f64,
    pub output_1m: f64,
    pub cache_read_1m: f64,
    pub cache_write_1m: f64,
}

const PRICE_FALLBACK: Price = Price {
    input_1m: 2.00,
    output_1m: 8.00,
    cache_read_1m: 0.25,
    cache_write_1m: 2.50,
};

const FREE: Price = Price {
    input_1m: 0.0,
    output_1m: 0.0,
    cache_read_1m: 0.0,
    cache_write_1m: 0.0,
};

/// Curated model pricing keyed by normalized model id. Prefix keys match any
/// model under that family (e.g. `openai/gpt-5.4` matches `openai/gpt-5.4-high`).
fn lookup_price(model: &str) -> Option<Price> {
    let m = model.trim().to_ascii_lowercase();

    if m.contains("-free") || m.ends_with("-free") {
        return Some(FREE);
    }

    // OpenAI mini / nano class
    for key in [
        "gpt-5.4-mini",
        "gpt-5.6-luna-mini",
        "openai/gpt-5.4-mini",
        "gpt-5-nano",
        "codex-mini",
    ] {
        if m.starts_with(key) {
            return Some(Price {
                input_1m: 0.25,
                output_1m: 2.0,
                cache_read_1m: 0.03125,
                cache_write_1m: 0.3125,
            });
        }
    }

    // OpenAI frontier / Codex class
    for key in [
        "gpt-5.3-codex",
        "gpt-5.4",
        "gpt-5.4-high",
        "gpt-5.5",
        "gpt-5.6-sol",
        "gpt-5.6-luna",
        "openai/gpt-5.3-codex",
        "openai/gpt-5.4",
        "openai/gpt-5.5",
        "openai/gpt-5.6",
    ] {
        if m.starts_with(key) {
            return Some(Price {
                input_1m: 1.25,
                output_1m: 10.0,
                cache_read_1m: 0.15625,
                cache_write_1m: 1.5625,
            });
        }
    }

    // DeepSeek
    if m.starts_with("deepseek") {
        let (input, output) = if m.contains("reasoner") {
            (0.55, 2.19)
        } else {
            (0.27, 1.10)
        };
        return Some(Price {
            input_1m: input,
            output_1m: output,
            cache_read_1m: 0.07,
            cache_write_1m: 0.27,
        });
    }

    // Anthropic
    for (key, p) in [
        ("claude-opus", Price { input_1m: 15.0, output_1m: 75.0, cache_read_1m: 1.50, cache_write_1m: 18.75 }),
        ("claude-sonnet", Price { input_1m: 3.0, output_1m: 15.0, cache_read_1m: 0.30, cache_write_1m: 3.75 }),
        ("claude-haiku", Price { input_1m: 1.0, output_1m: 5.0, cache_read_1m: 0.10, cache_write_1m: 1.25 }),
    ] {
        if m.contains(key) {
            return Some(p);
        }
    }

    // Gemini
    for (key, p) in [
        ("gemini-2.5-pro", Price { input_1m: 1.25, output_1m: 10.0, cache_read_1m: 0.3125, cache_write_1m: 1.5625 }),
        ("gemini-2.5-flash", Price { input_1m: 0.30, output_1m: 2.50, cache_read_1m: 0.075, cache_write_1m: 0.375 }),
    ] {
        if m.starts_with(key) {
            return Some(p);
        }
    }

    None
}

/// Provider label for a node execution, derived from engine + model id.
pub fn provider_for(engine: &str, model: Option<&str>) -> String {
    match engine {
        "opencode" => model
            .and_then(|m| m.split_once('/'))
            .map(|(p, _)| p.to_string())
            .filter(|p| !p.trim().is_empty())
            .unwrap_or_else(|| "opencode".into()),
        "codex" => "openai".into(),
        "cursor-agent" => "cursor".into(),
        other => other.to_string(),
    }
}

/// Estimate USD cost for a node execution. Returns `None` only when there are
/// no tokens recorded at all.
pub fn estimate_cost(engine: &str, model: &str, usage: &TokenUsage) -> Option<f64> {
    if usage.total_tokens_for_engine(engine) == 0 {
        return None;
    }
    let price = lookup_price(model).unwrap_or(PRICE_FALLBACK);
    // codex reports input_tokens *including* cached; opencode / cursor-agent exclude them.
    let uncached = if engine == "codex" {
        usage
            .input_tokens
            .saturating_sub(usage.cached_input_tokens + usage.cache_write_input_tokens)
    } else {
        usage.input_tokens
    };
    let cost = uncached as f64 / 1e6 * price.input_1m
        + usage.cached_input_tokens as f64 / 1e6 * price.cache_read_1m
        + usage.cache_write_input_tokens as f64 / 1e6 * price.cache_write_1m
        + (usage.output_tokens + usage.reasoning_tokens) as f64 / 1e6 * price.output_1m;
    Some(cost)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_from_opencode_model_prefix() {
        assert_eq!(provider_for("opencode", Some("deepseek/deepseek-v4-flash")), "deepseek");
        assert_eq!(provider_for("opencode", Some("openai/gpt-5.4")), "openai");
        assert_eq!(provider_for("opencode", None), "opencode");
        assert_eq!(provider_for("codex", Some("gpt-5.4")), "openai");
        assert_eq!(provider_for("cursor-agent", Some("auto")), "cursor");
    }

    #[test]
    fn estimates_frontier_cost() {
        let usage = TokenUsage {
            input_tokens: 1_000_000,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 100_000,
            reasoning_tokens: 0,
            cost: None,
        };
        let cost = estimate_cost("codex", "gpt-5.4", &usage).unwrap();
        assert!((cost - 1.25 - 1.0).abs() < 1e-6, "got {cost}");
    }

    #[test]
    fn estimates_mini_cost_before_frontier_prefix() {
        let usage = TokenUsage {
            input_tokens: 1_000_000,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 100_000,
            reasoning_tokens: 0,
            cost: None,
        };
        let cost = estimate_cost("opencode", "openai/gpt-5.4-mini", &usage).unwrap();
        assert!((cost - 0.25 - 0.2).abs() < 1e-6, "got {cost}");
    }

    #[test]
    fn codex_uncached_excludes_cached_input() {
        let usage = TokenUsage {
            input_tokens: 1_000_000,
            cached_input_tokens: 200_000,
            cache_write_input_tokens: 0,
            output_tokens: 0,
            reasoning_tokens: 0,
            cost: None,
        };
        // 800k uncached @1.25 + 200k cached @0.15625
        let cost = estimate_cost("codex", "gpt-5.4", &usage).unwrap();
        assert!((cost - 1.0 - 0.03125).abs() < 1e-6, "got {cost}");
    }

    #[test]
    fn free_opencode_models_cost_nothing() {
        let usage = TokenUsage {
            input_tokens: 5000,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 100,
            reasoning_tokens: 0,
            cost: None,
        };
        let cost = estimate_cost("opencode", "opencode/mimo-v2.5-free", &usage).unwrap();
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn unknown_model_falls_back() {
        let usage = TokenUsage {
            input_tokens: 1_000_000,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 1_000_000,
            reasoning_tokens: 0,
            cost: None,
        };
        let cost = estimate_cost("opencode", "acme/future-model", &usage).unwrap();
        assert!((cost - 2.0 - 8.0).abs() < 1e-6);
    }

    #[test]
    fn zero_usage_has_no_cost() {
        let usage = TokenUsage::default();
        assert!(estimate_cost("codex", "gpt-5.4", &usage).is_none());
    }
}
