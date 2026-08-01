//! opencode argv — see CLI_FLAGS.md §3 (`opencode run`).
use crate::engines::adapter::{EngineRunRequest, PreparedCommand};
use crate::services::cli_probe::resolve_engine_binary;

pub fn prepare(req: &EngineRunRequest) -> Result<PreparedCommand, String> {
    let program = resolve_engine_binary("opencode")
        .ok_or_else(|| "CLI not found: opencode".to_string())?
        .to_string_lossy()
        .to_string();

    let mut args = vec![
        "run".to_string(),
        "--dir".to_string(),
        req.cwd.clone(),
        // Auto-approve all tool permissions not explicitly denied (full automation).
        "--auto".to_string(),
    ];

    if req.stream_output {
        args.push("--format".to_string());
        args.push("json".to_string());
    }

    if let Some(model) = req.model.as_ref().filter(|m| !m.trim().is_empty()) {
        args.push("-m".to_string());
        args.push(model.clone());
    }

    if let Some(variant) = req.reasoning.as_ref().filter(|s| !s.trim().is_empty()) {
        args.push("--variant".to_string());
        args.push(variant.trim().to_string());
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
    fn builds_run_dir_prompt() {
        let req = EngineRunRequest {
            engine: "opencode".into(),
            cwd: "/tmp/ws".into(),
            prompt: "hi".into(),
            model: Some("openai/gpt-5".into()),
            reasoning: Some("high".into()),
            fast: false,
            extra_args: vec![],
            env: HashMap::new(),
            stream_output: false,
        };
        match prepare(&req) {
            Ok(cmd) => {
                assert_eq!(cmd.args.first().map(String::as_str), Some("run"));
                assert!(cmd.args.windows(2).any(|w| w[0] == "--dir" && w[1] == "/tmp/ws"));
                assert!(cmd.args.iter().any(|a| a == "--auto"));
                assert!(!cmd.args.iter().any(|a| a == "--format"));
                assert!(cmd
                    .args
                    .windows(2)
                    .any(|w| w[0] == "-m" && w[1] == "openai/gpt-5"));
                assert!(cmd
                    .args
                    .windows(2)
                    .any(|w| w[0] == "--variant" && w[1] == "high"));
                assert_eq!(cmd.args.last().map(String::as_str), Some("hi"));
            }
            Err(e) => assert!(e.contains("CLI not found")),
        }
    }

    #[test]
    fn stream_mode_uses_json_format() {
        let req = EngineRunRequest {
            engine: "opencode".into(),
            cwd: "/tmp/ws".into(),
            prompt: "hi".into(),
            model: None,
            reasoning: None,
            fast: false,
            extra_args: vec![],
            env: HashMap::new(),
            stream_output: true,
        };
        if let Ok(cmd) = prepare(&req) {
            assert!(cmd
                .args
                .windows(2)
                .any(|w| w[0] == "--format" && w[1] == "json"));
        }
    }
}
