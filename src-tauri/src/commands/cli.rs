use crate::repo::cli_status::{list_cli_engine_status as repo_list, EngineStatus};
use crate::services::cli_probe::probe_cli_engines as service_probe;
use crate::state::DbState;
use tauri::State;

#[tauri::command]
pub fn probe_cli_engines(state: State<'_, DbState>) -> Result<Vec<EngineStatus>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    // Individual engine failures are marked unavailable inside the service.
    service_probe(&conn)
}

#[tauri::command]
pub fn list_cli_engine_status(state: State<'_, DbState>) -> Result<Vec<EngineStatus>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    let list = repo_list(&conn)?;
    if list.is_empty() {
        return service_probe(&conn);
    }
    Ok(list)
}
