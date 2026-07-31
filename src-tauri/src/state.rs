use rusqlite::Connection;
use std::sync::Mutex;

use crate::engines::runner::CancelToken;

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

/// Active sandbox cancel token (ephemeral; not persisted).
pub struct SandboxState {
    pub cancel: Mutex<Option<CancelToken>>,
}

impl SandboxState {
    pub fn new() -> Self {
        Self {
            cancel: Mutex::new(None),
        }
    }
}

impl Default for SandboxState {
    fn default() -> Self {
        Self::new()
    }
}
