pub mod migrate;
pub mod path;

use rusqlite::Connection;

pub use migrate::{migrate, now_iso8601};
pub use path::{db_path, ensure_db_dir};

/// Open (or create) the app DB and run migrations.
pub fn open_db() -> Result<Connection, String> {
    let path = ensure_db_dir()?;
    let conn = Connection::open(&path).map_err(|e| format!("open db {}: {e}", path.display()))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("pragma foreign_keys: {e}"))?;
    migrate(&conn)?;
    Ok(conn)
}

/// Open a Connection at an arbitrary path (tests / custom).
#[allow(dead_code)]
pub fn open_db_at(path: &std::path::Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    let conn = Connection::open(path).map_err(|e| format!("open db: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("pragma foreign_keys: {e}"))?;
    migrate(&conn)?;
    Ok(conn)
}
