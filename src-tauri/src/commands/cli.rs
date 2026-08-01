use crate::repo::cli_status::{list_cli_engine_status as repo_list, EngineStatus};
use crate::services::cli_models::{list_engine_models as service_list_models, EngineModelCatalog};
use crate::services::cli_probe::probe_cli_engines as service_probe;
use crate::state::DbState;
use tauri::State;

#[tauri::command]
pub async fn probe_cli_engines(state: State<'_, DbState>) -> Result<Vec<EngineStatus>, String> {
    let conn = state.conn_arc();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        // Individual engine failures are marked unavailable inside the service.
        service_probe(&conn)
    })
    .await
    .map_err(|e| format!("probe_cli_engines join error: {e}"))?
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

#[tauri::command]
pub async fn list_engine_models(
    engine: String,
    refresh: Option<bool>,
) -> Result<EngineModelCatalog, String> {
    let refresh = refresh.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || service_list_models(&engine, refresh))
        .await
        .map_err(|e| format!("list_engine_models join error: {e}"))?
}
