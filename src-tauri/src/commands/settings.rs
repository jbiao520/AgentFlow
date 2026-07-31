use crate::repo::{
    get_orchestrator_settings as repo_get, update_orchestrator_settings as repo_update,
    OrchestratorSettings, OrchestratorSettingsUpdate,
};
use crate::state::DbState;
use tauri::State;

#[tauri::command]
pub fn get_orchestrator_settings(
    state: State<'_, DbState>,
) -> Result<OrchestratorSettings, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    repo_get(&conn)
}

#[tauri::command]
pub fn update_orchestrator_settings(
    state: State<'_, DbState>,
    settings: OrchestratorSettingsUpdate,
) -> Result<OrchestratorSettings, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    repo_update(&conn, settings)
}
