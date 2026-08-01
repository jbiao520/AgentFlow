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
