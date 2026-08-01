use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
}

#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "AgentFlow".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: tauri::VERSION.to_string(),
    }
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let p = Path::new(&path);
        if !p.exists() {
            return Err(format!("path does not exist: {path}"));
        }
        std::process::Command::new("open")
            .args(["-R", &path])
            .status()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("reveal_in_finder is only supported on macOS in v1".to_string())
    }
}
