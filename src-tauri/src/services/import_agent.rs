use crate::db::path::db_path;
use crate::repo::{
    get_agent_profile, upsert_agent, upsert_agent_profile, Agent, AgentModelProfile, AgentUpsert,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Deserialize)]
pub struct ImportAgentRequest {
    pub name: String,
    pub workspace_path_or_git: String,
    pub default_cli: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportAgentResult {
    pub agent: Agent,
    pub cloned: bool,
    pub workspace_path: String,
}

/// Application Support workspaces root: `…/AgentMind/workspaces`
pub fn workspaces_root() -> Result<PathBuf, String> {
    let db = db_path();
    let parent = db
        .parent()
        .ok_or_else(|| "cannot resolve AgentMind data dir".to_string())?;
    let root = parent.join("workspaces");
    fs::create_dir_all(&root).map_err(|e| format!("create workspaces dir: {e}"))?;
    Ok(root)
}

fn looks_like_git_url(s: &str) -> bool {
    let t = s.trim();
    if t.is_empty() {
        return false;
    }
    t.starts_with("git@")
        || t.starts_with("ssh://")
        || t.starts_with("https://")
        || t.starts_with("http://")
        || t.starts_with("git://")
        || t.ends_with(".git")
}

fn sanitize_agent_dir_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("agent name must not be empty".into());
    }
    // Keep filesystem-safe identifier; reject traversal-ish names.
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("agent name must not contain path separators or '..'".into());
    }
    let safe: String = trimmed
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() || safe == "." || safe == ".." {
        return Err("agent name is not a valid directory name".into());
    }
    Ok(safe)
}

/// Reject `..` components and require a canonical absolute path under home
/// (or under AgentMind workspaces), unless the path already exists as a dir
/// that the user explicitly selected (still must be absolute + no `..`).
pub fn validate_local_workspace_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("workspace path must not be empty".into());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("workspace path must be absolute".into());
    }
    if path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("workspace path must not contain '..'".into());
    }

    let canonical = if path.exists() {
        fs::canonicalize(&path).map_err(|e| format!("resolve workspace path: {e}"))?
    } else {
        return Err(format!("workspace path does not exist: {trimmed}"));
    };

    if !canonical.is_dir() {
        return Err(format!("workspace path is not a directory: {trimmed}"));
    }

    let home = dirs_home().ok_or_else(|| "cannot resolve user home directory".to_string())?;
    let under_home = canonical.starts_with(&home);
    let under_workspaces = workspaces_root()
        .ok()
        .map(|w| canonical.starts_with(&w))
        .unwrap_or(false);

    if !under_home && !under_workspaces {
        return Err(
            "workspace path must be under your home directory (or AgentMind workspaces)".into(),
        );
    }

    Ok(canonical)
}

fn dirs_home() -> Option<PathBuf> {
    directories::UserDirs::new().map(|u| u.home_dir().to_path_buf())
}

fn clone_git_repo(git_url: &str, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        return Err(format!(
            "clone destination already exists: {}",
            dest.display()
        ));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create clone parent: {e}"))?;
    }

    let git = which_git()?;
    let output = Command::new(&git)
        .args(["clone", "--", git_url])
        .arg(dest)
        .output()
        .map_err(|e| format!("failed to run git clone (is git installed?): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            stdout.trim().to_string()
        };
        // Best-effort cleanup of partial clone
        let _ = fs::remove_dir_all(dest);
        return Err(format!("git clone failed: {detail}"));
    }
    Ok(())
}

fn which_git() -> Result<PathBuf, String> {
    which_bin("git").ok_or_else(|| "git is not installed or not on PATH".into())
}

fn which_bin(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn normalize_cli(raw: &str) -> Result<String, String> {
    let t = raw.trim().to_lowercase();
    let cli = if t.contains("cursor") {
        "cursor-agent"
    } else if t.contains("codex") {
        "codex"
    } else if t.contains("opencode") || t.contains("open-code") {
        "opencode"
    } else if t == "cursor-agent" || t == "codex" || t == "opencode" {
        return Ok(t);
    } else if !t.is_empty() {
        return Ok(raw.trim().to_string());
    } else {
        return Err("default_cli must not be empty".into());
    };
    Ok(cli.into())
}

/// Resolve workspace (local bind or git clone), upsert agent + empty profile.
pub fn import_agent(conn: &Connection, req: ImportAgentRequest) -> Result<ImportAgentResult, String> {
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err("agent name must not be empty".into());
    }
    let default_cli = normalize_cli(&req.default_cli)?;
    let source = req.workspace_path_or_git.trim().to_string();
    if source.is_empty() {
        return Err("workspace_path_or_git must not be empty".into());
    }

    let (workspace_path, git_url, cloned) = if looks_like_git_url(&source) {
        let dir_name = sanitize_agent_dir_name(&name)?;
        let dest = workspaces_root()?.join(&dir_name);
        clone_git_repo(&source, &dest)?;
        let canonical = fs::canonicalize(&dest).map_err(|e| format!("resolve clone path: {e}"))?;
        (canonical, Some(source), true)
    } else if Path::new(&source).exists() {
        let path = validate_local_workspace_path(&source)?;
        (path, None, false)
    } else {
        return Err(format!(
            "path does not exist and does not look like a git URL: {source}"
        ));
    };

    let workspace_str = workspace_path.to_string_lossy().to_string();
    let agent = upsert_agent(
        conn,
        AgentUpsert {
            id: None,
            name,
            description: req.description,
            workspace_path: workspace_str.clone(),
            git_url,
            default_cli,
            status: Some("idle".into()),
        },
    )?;

    // Default empty profile if missing
    if get_agent_profile(conn, &agent.id)?.is_none() {
        upsert_agent_profile(
            conn,
            AgentModelProfile {
                agent_id: agent.id.clone(),
                preferred_model: None,
                reasoning_effort: Some("medium".into()),
                temperature: Some(0.2),
                auto_route: true,
                engine_options_json: Some(r#"{"playwright_mode":"headless"}"#.into()),
            },
        )?;
    }

    Ok(ImportAgentResult {
        agent,
        cloned,
        workspace_path: workspace_str,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_db_at;
    use crate::repo::list_agents;
    use tempfile::TempDir;

    #[test]
    fn import_local_temp_dir() {
        let home_ws = TempDir::new().unwrap();
        // Place workspace under a fake home by using the temp dir itself as path —
        // validate_local_workspace_path requires under $HOME. Skip if temp is not under home.
        let home = dirs_home().expect("home");
        let ws = home.join(".agentmind-test-import-ws");
        let _ = fs::remove_dir_all(&ws);
        fs::create_dir_all(&ws).unwrap();

        let db_dir = TempDir::new().unwrap();
        let conn = open_db_at(&db_dir.path().join("t.db")).unwrap();

        let result = import_agent(
            &conn,
            ImportAgentRequest {
                name: "local-demo".into(),
                workspace_path_or_git: ws.to_string_lossy().to_string(),
                default_cli: "codex".into(),
                description: Some("test agent".into()),
            },
        );
        let _ = fs::remove_dir_all(&ws);

        let result = result.expect("import local");
        assert!(!result.cloned);
        assert_eq!(result.agent.name, "local-demo");
        assert_eq!(result.agent.default_cli, "codex");
        assert!(get_agent_profile(&conn, &result.agent.id).unwrap().is_some());
        assert_eq!(list_agents(&conn).unwrap().len(), 1);

        // silence unused in case
        let _ = home_ws;
    }

    #[test]
    fn reject_relative_and_traversal() {
        assert!(validate_local_workspace_path("relative/path").is_err());
        let err = validate_local_workspace_path("/Users/../etc").unwrap_err();
        assert!(err.contains(".."));
    }

    #[test]
    fn git_url_detection() {
        assert!(looks_like_git_url("https://github.com/user/repo.git"));
        assert!(looks_like_git_url("git@github.com:user/repo.git"));
        assert!(!looks_like_git_url("/Users/me/projects/foo"));
    }

    #[test]
    fn sanitize_name_rejects_traversal() {
        assert!(sanitize_agent_dir_name("../evil").is_err());
        assert!(sanitize_agent_dir_name("good-name").is_ok());
    }
}
