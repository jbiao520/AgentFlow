//! cursor-agent argv — see CLI_FLAGS.md §1.
use crate::engines::adapter::{EngineRunRequest, PreparedCommand};
use crate::services::cli_probe::resolve_engine_binary;

pub fn prepare(req: &EngineRunRequest) -> Result<PreparedCommand, String> {
    let program = resolve_engine_binary("cursor-agent")
        .ok_or_else(|| "CLI not found: cursor-agent".to_string())?
        .to_string_lossy()
        .to_string();

    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "text".to_string(),
        "--trust".to_string(),
        "--workspace".to_string(),
        req.cwd.clone(),
    ];

    if let Some(model) = req.model.as_ref().filter(|m| !m.trim().is_empty()) {
        let model_arg = match req.reasoning.as_ref().map(|s| s.trim().to_lowercase()) {
            Some(effort) if !effort.is_empty() && !model.contains('[') => {
                format!("{model}[effort={effort}]")
            }
            _ => model.clone(),
        };
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
        // May fail prepare if binary missing — only assert shape when present.
        let req = EngineRunRequest {
            engine: "cursor-agent".into(),
            cwd: "/tmp/ws".into(),
            prompt: "hello".into(),
            model: Some("gpt-5".into()),
            reasoning: Some("high".into()),
            extra_args: vec![],
            env: HashMap::new(),
        };
        match prepare(&req) {
            Ok(cmd) => {
                assert!(cmd.args.iter().any(|a| a == "--print"));
                assert!(cmd.args.iter().any(|a| a == "--workspace"));
                assert!(cmd.args.iter().any(|a| a == "/tmp/ws"));
                assert!(cmd.args.iter().any(|a| a == "gpt-5[effort=high]"));
                assert_eq!(cmd.args.last().map(String::as_str), Some("hello"));
            }
            Err(e) => assert!(e.contains("CLI not found")),
        }
    }
}
