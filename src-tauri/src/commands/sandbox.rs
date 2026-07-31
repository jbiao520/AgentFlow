use crate::engines::adapter::{EngineRunRequest, LogEvent};
use crate::engines::runner::{
    run_engine_unchecked, validate_imported_workspace, CancelToken,
};
use crate::repo::{get_agent, get_agent_profile, list_cli_engine_status};
use crate::state::{DbState, SandboxState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxRunArgs {
    pub agent_id: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxRunResult {
    pub exit_code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxLogPayload {
    pub ts: String,
    pub stream: String,
    pub line: String,
}

#[tauri::command]
pub fn sandbox_run(
    app: AppHandle,
    db: State<'_, DbState>,
    sandbox: State<'_, SandboxState>,
    args: SandboxRunArgs,
) -> Result<SandboxRunResult, String> {
    let prompt = args.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("prompt must not be empty".into());
    }

    let req = {
        let conn = db
            .conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;

        let agent = get_agent(&conn, &args.agent_id)?
            .ok_or_else(|| format!("agent not found: {}", args.agent_id))?;
        let profile = get_agent_profile(&conn, &args.agent_id)?;

        let engine = agent.default_cli.trim().to_string();
        if engine.is_empty() {
            return Err("agent has no default_cli".into());
        }

        let statuses = list_cli_engine_status(&conn)?;
        let available = statuses
            .iter()
            .find(|s| s.engine == engine)
            .map(|s| s.available)
            .unwrap_or(false);
        if !available {
            let soft = crate::services::cli_probe::resolve_engine_binary(&engine).is_some();
            if !soft {
                return Err(format!("CLI engine unavailable: {engine}"));
            }
        }

        let cwd = validate_imported_workspace(&conn, &agent.workspace_path)?;

        let model = profile
            .as_ref()
            .and_then(|p| p.preferred_model.clone())
            .filter(|m| !m.trim().is_empty());
        let reasoning = profile
            .as_ref()
            .and_then(|p| p.reasoning_effort.clone())
            .filter(|r| !r.trim().is_empty());

        EngineRunRequest {
            engine,
            cwd,
            prompt,
            model,
            reasoning,
            extra_args: vec![],
            env: HashMap::new(),
        }
    }; // DB lock released before long-running spawn

    let cancel = CancelToken::new();
    {
        let mut slot = sandbox
            .cancel
            .lock()
            .map_err(|e| format!("sandbox lock poisoned: {e}"))?;
        if let Some(prev) = slot.take() {
            prev.cancel();
        }
        *slot = Some(cancel.clone());
    }

    let app_for_log = app.clone();
    let result = run_engine_unchecked(&req, &cancel, |ev: LogEvent| {
        let payload = SandboxLogPayload {
            ts: ev.ts,
            stream: ev.stream,
            line: ev.line,
        };
        let _ = app_for_log.emit("sandbox-log", payload);
    });

    {
        let mut slot = sandbox
            .cancel
            .lock()
            .map_err(|e| format!("sandbox lock poisoned: {e}"))?;
        *slot = None;
    }

    match result {
        Ok(exit_code) => Ok(SandboxRunResult { exit_code }),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn sandbox_cancel(sandbox: State<'_, SandboxState>) -> Result<(), String> {
    let slot = sandbox
        .cancel
        .lock()
        .map_err(|e| format!("sandbox lock poisoned: {e}"))?;
    if let Some(token) = slot.as_ref() {
        token.cancel();
        Ok(())
    } else {
        Err("no sandbox run in progress".into())
    }
}
