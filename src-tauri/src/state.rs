use rusqlite::Connection;
use std::sync::Mutex;

/// Shared SQLite connection for Tauri managed state.
pub struct DbState {
    pub conn: Mutex<Connection>,
}

impl DbState {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}
