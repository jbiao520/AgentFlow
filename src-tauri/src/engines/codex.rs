//! codex argv — see CLI_FLAGS.md §2 (`codex exec`).
use crate::engines::adapter::{EngineRunRequest, PreparedCommand};
use crate::services::cli_probe::resolve_engine_binary;

pub fn prepare(req: &EngineRunRequest) -> Result<PreparedCommand, String> {
    let program = resolve_engine_binary("codex")
        .ok_or_else(|| "CLI not found: codex".to_string())?
        .to_string_lossy()
        .to_string();

    let mut args = vec![
        "exec".to_string(),
        "-C".to_string(),
        req.cwd.clone(),
        "--skip-git-repo-check".to_string(),
        // Full permissions for non-interactive automation. AgentFlow already
        // constrains cwd to the agent workspace (external sandbox).
        "--dangerously-bypass-approvals-and-sandbox".to_string(),
    ];

    if req.stream_output {
        args.push("--json".to_string());
    }

    if let Some(model) = req.model.as_ref().filter(|m| !m.trim().is_empty()) {
        args.push("-m".to_string());
        args.push(model.clone());
    }

    // Reasoning via `-c` is UNVERIFIED in CLI_FLAGS.md — only pass when set.
    if let Some(effort) = req.reasoning.as_ref().filter(|s| !s.trim().is_empty()) {
        args.push("-c".to_string());
        args.push(format!("model_reasoning_effort=\"{}\"", effort.trim()));
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
    fn builds_exec_cd_prompt() {
        let req = EngineRunRequest {
            engine: "codex".into(),
            cwd: "/tmp/ws".into(),
            prompt: "ping".into(),
            model: Some("sol".into()),
            reasoning: None,
            fast: false,
            extra_args: vec![],
            env: HashMap::new(),
            stream_output: false,
        };
        match prepare(&req) {
            Ok(cmd) => {
                assert_eq!(cmd.args.first().map(String::as_str), Some("exec"));
                assert!(cmd.args.windows(2).any(|w| w[0] == "-C" && w[1] == "/tmp/ws"));
                assert!(cmd
                    .args
                    .iter()
                    .any(|a| a == "--dangerously-bypass-approvals-and-sandbox"));
                assert!(!cmd.args.iter().any(|a| a == "--sandbox"));
                assert!(!cmd.args.iter().any(|a| a == "--ask-for-approval"));
                assert!(!cmd.args.iter().any(|a| a == "--json"));
                assert!(cmd.args.windows(2).any(|w| w[0] == "-m" && w[1] == "sol"));
                assert_eq!(cmd.args.last().map(String::as_str), Some("ping"));
            }
            Err(e) => assert!(e.contains("CLI not found")),
        }
    }

    #[test]
    fn stream_mode_adds_json() {
        let req = EngineRunRequest {
            engine: "codex".into(),
            cwd: "/tmp/ws".into(),
            prompt: "ping".into(),
            model: None,
            reasoning: None,
            fast: false,
            extra_args: vec![],
            env: HashMap::new(),
            stream_output: true,
        };
        if let Ok(cmd) = prepare(&req) {
            assert!(cmd.args.iter().any(|a| a == "--json"));
        }
    }
}
