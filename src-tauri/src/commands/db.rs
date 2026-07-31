use crate::db::db_path;
use crate::state::DbState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct DbHealth {
    pub path: String,
    pub ok: bool,
}

#[tauri::command]
pub fn db_health(state: State<'_, DbState>) -> Result<DbHealth, String> {
    let path = db_path().display().to_string();
    let conn = state
        .conn
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    let ok: bool = conn
        .query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
        .map(|v| v == 1)
        .unwrap_or(false);
    Ok(DbHealth { path, ok })
}
