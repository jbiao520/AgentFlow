//! Engine adapters for cursor-agent / codex / opencode.
//! Argv patterns: see `.planning/phases/04-cli-runtime/CLI_FLAGS.md`.

pub mod adapter;
pub mod codex;
pub mod cursor_agent;
pub mod opencode;
pub mod runner;

pub use adapter::{EngineRunRequest, LogEvent};
pub use runner::{run_engine, CancelToken};
