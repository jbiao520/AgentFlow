use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::engines::runner::CancelToken;

/// Shared SQLite connection for Tauri managed state.
pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
}

impl DbState {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Arc::new(Mutex::new(conn)),
        }
    }

    pub fn conn_arc(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.conn)
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

/// Active DAG run cancel tokens keyed by run_id.
pub struct RunState {
    pub cancels: Arc<Mutex<HashMap<String, CancelToken>>>,
}

impl RunState {
    pub fn new() -> Self {
        Self {
            cancels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn cancels_arc(&self) -> Arc<Mutex<HashMap<String, CancelToken>>> {
        Arc::clone(&self.cancels)
    }
}

impl Default for RunState {
    fn default() -> Self {
        Self::new()
    }
}
