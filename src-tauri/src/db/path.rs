use std::fs;
use std::path::PathBuf;

/// Resolve DB path: `~/Library/Application Support/AgentMind/agentmind.db`
pub fn db_path() -> PathBuf {
    if let Some(proj) = directories::ProjectDirs::from("", "", "AgentMind") {
        return proj.data_dir().join("agentmind.db");
    }
    // Fallback for unusual environments without a home dir resolution
    PathBuf::from("agentmind.db")
}

/// Ensure parent directory exists, then return the DB path.
pub fn ensure_db_dir() -> Result<PathBuf, String> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create app data dir: {e}"))?;
    }
    Ok(path)
}
