//! cursor-agent argv — see CLI_FLAGS.md §1.
use crate::engines::adapter::{EngineRunRequest, PreparedCommand};
use crate::services::cli_models::compose_cursor_model_id;
use crate::services::cli_probe::resolve_engine_binary;

pub fn prepare(req: &EngineRunRequest) -> Result<PreparedCommand, String> {
    let program = resolve_engine_binary("cursor-agent")
        .ok_or_else(|| "CLI not found: cursor-agent".to_string())?
        .to_string_lossy()
        .to_string();

    let mut args = vec![
        "--print".to_string(),
        "--trust".to_string(),
        // Auto-approve shell/tool commands in non-interactive runs (unless explicitly denied).
        // `--trust` alone only skips the workspace trust prompt — shell still gets rejected.
        "--force".to_string(),
        "--workspace".to_string(),
        req.cwd.clone(),
    ];

    if req.stream_output {
        args.push("--output-format".to_string());
        args.push("stream-json".to_string());
        args.push("--stream-partial-output".to_string());
    } else {
        args.push("--output-format".to_string());
        args.push("text".to_string());
    }

    if let Some(model) = req.model.as_ref().filter(|m| !m.trim().is_empty()) {
        let effort = req
            .reasoning
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let model_arg = compose_cursor_model_id(model, effort);
        args.push("--model".to_string());
        args.push(model_arg);
    }

    args.extend(req.extra_args.iter().cloned());
    args.push(req.prompt.clone());

    Ok(PreparedCommand { program, args })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn builds_print_workspace_prompt() {
        let req = EngineRunRequest {
            engine: "cursor-agent".into(),
            cwd: "/tmp/ws".into(),
            prompt: "hello".into(),
            model: Some("gpt-5.6-sol".into()),
            reasoning: Some("high".into()),
            extra_args: vec![],
            env: HashMap::new(),
            stream_output: false,
        };
        match prepare(&req) {
            Ok(cmd) => {
                assert!(cmd.args.iter().any(|a| a == "--print"));
                assert!(cmd.args.iter().any(|a| a == "--trust"));
                assert!(cmd.args.iter().any(|a| a == "--force"));
                assert!(cmd.args.iter().any(|a| a == "--workspace"));
                assert!(cmd.args.iter().any(|a| a == "/tmp/ws"));
                assert!(cmd.args.iter().any(|a| a == "gpt-5.6-sol-high"));
                assert!(cmd.args.windows(2).any(|w| w[0] == "--output-format" && w[1] == "text"));
                assert_eq!(cmd.args.last().map(String::as_str), Some("hello"));
            }
            Err(e) => assert!(e.contains("CLI not found")),
        }
    }

    #[test]
    fn stream_mode_uses_stream_json() {
        let req = EngineRunRequest {
            engine: "cursor-agent".into(),
            cwd: "/tmp/ws".into(),
            prompt: "hello".into(),
            model: Some("auto".into()),
            reasoning: None,
            extra_args: vec![],
            env: HashMap::new(),
            stream_output: true,
        };
        if let Ok(cmd) = prepare(&req) {
            assert!(cmd
                .args
                .windows(2)
                .any(|w| w[0] == "--output-format" && w[1] == "stream-json"));
            assert!(cmd.args.iter().any(|a| a == "--stream-partial-output"));
        }
    }

    #[test]
    fn skips_effort_when_empty() {
        let req = EngineRunRequest {
            engine: "cursor-agent".into(),
            cwd: "/tmp/ws".into(),
            prompt: "hello".into(),
            model: Some("auto".into()),
            reasoning: Some("".into()),
            extra_args: vec![],
            env: HashMap::new(),
            stream_output: false,
        };
        if let Ok(cmd) = prepare(&req) {
            assert!(cmd.args.iter().any(|a| a == "auto"));
        }
    }
}
