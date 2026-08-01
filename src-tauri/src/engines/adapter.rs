use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Unified engine run input (SPEC §7.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineRunRequest {
    pub engine: String,
    pub cwd: String,
    pub prompt: String,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    #[serde(default)]
    pub extra_args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// Prefer JSONL streaming output so the UI can show live agent text.
    /// Orchestrate keeps this false (needs a single final text/JSON blob).
    #[serde(default)]
    pub stream_output: bool,
}

/// One streamed log line from a child process.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEvent {
    pub ts: String,
    /// `stdout` | `stderr` | `agent` | `think` | `status` | `tool`
    pub stream: String,
    pub line: String,
}

/// Token usage parsed from engine JSONL streams (codex `turn.completed`,
/// opencode `step_finish`). `cost` is set when the CLI reports it (opencode);
/// otherwise the caller estimates it from per-model pricing.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_write_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
    pub cost: Option<f64>,
}

impl TokenUsage {
    /// Total tokens when `input_tokens` already includes cache tokens, as in
    /// Codex usage payloads.
    pub fn total_tokens(&self) -> u64 {
        self.input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.reasoning_tokens)
    }

    /// Total tokens using the accounting convention of the given engine.
    /// OpenCode reports cache tokens separately from input tokens.
    pub fn total_tokens_for_engine(&self, engine: &str) -> u64 {
        let total = self.total_tokens();
        if engine == "codex" {
            total
        } else {
            total
                .saturating_add(self.cached_input_tokens)
                .saturating_add(self.cache_write_input_tokens)
        }
    }

    pub fn merge(&mut self, other: &TokenUsage) {
        self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
        self.cached_input_tokens = self
            .cached_input_tokens
            .saturating_add(other.cached_input_tokens);
        self.cache_write_input_tokens = self
            .cache_write_input_tokens
            .saturating_add(other.cache_write_input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
        self.reasoning_tokens = self
            .reasoning_tokens
            .saturating_add(other.reasoning_tokens);
        self.cost = match (self.cost, other.cost) {
            (Some(a), Some(b)) => Some(a + b),
            (None, Some(b)) => Some(b),
            (Some(a), None) => Some(a),
            (None, None) => None,
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn total_tokens_does_not_double_count_codex_cache_tokens() {
        let usage = TokenUsage {
            input_tokens: 100,
            cached_input_tokens: 20,
            cache_write_input_tokens: 5,
            output_tokens: 30,
            reasoning_tokens: 10,
            cost: None,
        };

        assert_eq!(usage.total_tokens(), 140);
        assert_eq!(usage.total_tokens_for_engine("codex"), 140);
        assert_eq!(usage.total_tokens_for_engine("opencode"), 165);
    }
}

/// Built argv for a specific engine binary.
#[derive(Debug, Clone)]
pub struct PreparedCommand {
    pub program: String,
    pub args: Vec<String>,
}

pub fn prepare_command(req: &EngineRunRequest) -> Result<PreparedCommand, String> {
    match req.engine.as_str() {
        "cursor-agent" => crate::engines::cursor_agent::prepare(req),
        "codex" => crate::engines::codex::prepare(req),
        "opencode" => crate::engines::opencode::prepare(req),
        other => Err(format!("unsupported engine: {other}")),
    }
}
