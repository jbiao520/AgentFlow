use std::fs;
use std::path::PathBuf;

/// Resolve DB path: `~/Library/Application Support/AgentFlow/agentflow.db`
pub fn db_path() -> PathBuf {
    if let Some(proj) = directories::ProjectDirs::from("", "", "AgentFlow") {
        return proj.data_dir().join("agentflow.db");
    }
    // Fallback for unusual environments without a home dir resolution
    PathBuf::from("agentflow.db")
}

/// Ensure parent directory exists, then return the DB path.
pub fn ensure_db_dir() -> Result<PathBuf, String> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create app data dir: {e}"))?;
    }
    Ok(path)
}
