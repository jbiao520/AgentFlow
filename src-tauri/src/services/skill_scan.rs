use crate::repo::{
    delete_skills_missing_paths, get_agent, get_skill_by_path, list_skills_by_agent,
    upsert_skills_many, SkillUpsert,
};
use hex::encode as hex_encode;
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct SyncSkillsResult {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
}

#[derive(Debug, Clone)]
struct ScannedSkill {
    relative_path: String,
    title: String,
    description: Option<String>,
    content_hash: String,
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_encode(hasher.finalize())
}

/// Parse optional YAML frontmatter `description` or first non-empty paragraph.
pub fn parse_skill_meta(content: &str, stem: &str) -> (String, Option<String>) {
    let title = stem.to_string();
    let trimmed = content.trim_start_matches('\u{feff}');

    if let Some(rest) = trimmed.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let fm = &rest[..end];
            for line in fm.lines() {
                let line = line.trim();
                if let Some(val) = line.strip_prefix("description:") {
                    let desc = val.trim().trim_matches('"').trim_matches('\'').to_string();
                    if !desc.is_empty() {
                        return (title, Some(desc));
                    }
                }
            }
            // Fall through to body after frontmatter
            let body = rest[end + 4..].trim();
            if let Some(desc) = first_paragraph(body) {
                return (title, Some(desc));
            }
            return (title, None);
        }
    }

    (title, first_paragraph(trimmed))
}

fn first_paragraph(body: &str) -> Option<String> {
    let mut buf = String::new();
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() {
            if !buf.is_empty() {
                break;
            }
            continue;
        }
        // Skip markdown headings / horizontal rules as description
        if t.starts_with('#') || t == "---" || t.starts_with("```") {
            if !buf.is_empty() {
                break;
            }
            continue;
        }
        if !buf.is_empty() {
            buf.push(' ');
        }
        buf.push_str(t);
    }
    let desc = buf.trim().to_string();
    if desc.is_empty() {
        None
    } else {
        Some(desc)
    }
}

fn walk_skill_mds(skills_root: &Path, base: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    if !skills_root.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(skills_root).map_err(|e| format!("read skills dir: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read skills entry: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            walk_skill_mds(&path, base, out)?;
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
    Ok(())
}

fn relative_to_workspace(workspace: &Path, file: &Path) -> Result<String, String> {
    let rel = file
        .strip_prefix(workspace)
        .map_err(|_| format!("skill path outside workspace: {}", file.display()))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

fn scan_workspace_skills(workspace: &Path) -> Result<Vec<ScannedSkill>, String> {
    let skills_dir = workspace.join(".agent").join("skills");
    let mut files = Vec::new();
    walk_skill_mds(&skills_dir, workspace, &mut files)?;
    files.sort();

    let mut scanned = Vec::with_capacity(files.len());
    for file in files {
        let bytes = fs::read(&file).map_err(|e| format!("read {}: {e}", file.display()))?;
        let content = String::from_utf8_lossy(&bytes);
        let stem = file
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("skill")
            .to_string();
        let (title, description) = parse_skill_meta(&content, &stem);
        let relative_path = relative_to_workspace(workspace, &file)?;
        scanned.push(ScannedSkill {
            relative_path,
            title,
            description,
            content_hash: sha256_hex(&bytes),
        });
    }
    Ok(scanned)
}

pub fn sync_agent_skills(conn: &Connection, agent_id: &str) -> Result<SyncSkillsResult, String> {
    let agent = get_agent(conn, agent_id)?
        .ok_or_else(|| format!("agent not found: {agent_id}"))?;
    let workspace = PathBuf::from(&agent.workspace_path);
    if !workspace.is_dir() {
        return Err(format!(
            "agent workspace is not a directory: {}",
            agent.workspace_path
        ));
    }

    let existing = list_skills_by_agent(conn, agent_id)?;
    let scanned = scan_workspace_skills(&workspace)?;
    let keep_paths: Vec<String> = scanned.iter().map(|s| s.relative_path.clone()).collect();

    let mut added = 0usize;
    let mut updated = 0usize;
    let mut upserts = Vec::new();

    for s in &scanned {
        let prev = existing.iter().find(|e| e.relative_path == s.relative_path);
        match prev {
            None => {
                added += 1;
                upserts.push(SkillUpsert {
                    id: None,
                    agent_id: agent_id.to_string(),
                    relative_path: s.relative_path.clone(),
                    title: Some(s.title.clone()),
                    description: s.description.clone(),
                    enabled: Some(true),
                    content_hash: Some(s.content_hash.clone()),
                });
            }
            Some(old) => {
                let hash_changed = old.content_hash.as_deref() != Some(s.content_hash.as_str());
                if hash_changed
                    || old.title.as_deref() != Some(s.title.as_str())
                    || old.description != s.description
                {
                    updated += 1;
                }
                // Preserve enabled always when file still exists
                upserts.push(SkillUpsert {
                    id: Some(old.id.clone()),
                    agent_id: agent_id.to_string(),
                    relative_path: s.relative_path.clone(),
                    title: Some(s.title.clone()),
                    description: s.description.clone(),
                    enabled: Some(old.enabled),
                    content_hash: Some(s.content_hash.clone()),
                });
            }
        }
    }

    if !upserts.is_empty() {
        upsert_skills_many(conn, &upserts)?;
    }
    let removed = delete_skills_missing_paths(conn, agent_id, &keep_paths)?;

    Ok(SyncSkillsResult {
        added,
        updated,
        removed,
    })
}

/// Ensure relative_path stays under workspace (no absolute / no `..`).
pub fn resolve_skill_file(workspace: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let rel = relative_path.trim();
    if rel.is_empty() {
        return Err("relative_path must not be empty".into());
    }
    if Path::new(rel).is_absolute() {
        return Err("relative_path must not be absolute".into());
    }
    if Path::new(rel)
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("relative_path must not contain '..'".into());
    }

    let workspace = fs::canonicalize(workspace)
        .map_err(|e| format!("resolve workspace: {e}"))?;
    let joined = workspace.join(rel);
    let canonical = fs::canonicalize(&joined).map_err(|e| format!("resolve skill file: {e}"))?;
    if !canonical.starts_with(&workspace) {
        return Err("skill path escapes workspace".into());
    }
    if !canonical.is_file() {
        return Err(format!("skill file not found: {rel}"));
    }
    Ok(canonical)
}

pub fn read_skill_content(
    conn: &Connection,
    agent_id: &str,
    relative_path: &str,
) -> Result<String, String> {
    let agent = get_agent(conn, agent_id)?
        .ok_or_else(|| format!("agent not found: {agent_id}"))?;
    // Prefer DB awareness but allow reading any in-workspace skill path
    let _ = get_skill_by_path(conn, agent_id, relative_path)?;
    let file = resolve_skill_file(Path::new(&agent.workspace_path), relative_path)?;
    fs::read_to_string(&file).map_err(|e| format!("read skill: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_db_at;
    use crate::repo::{list_skills_by_agent, set_skill_enabled, upsert_agent, AgentUpsert};
    use tempfile::TempDir;

    fn write_skill(ws: &Path, rel: &str, body: &str) {
        let path = ws.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, body).unwrap();
    }

    #[test]
    fn sync_two_md_files_add_remove_preserve_enabled() {
        let dir = TempDir::new().unwrap();
        let ws = dir.path().join("ws");
        fs::create_dir_all(ws.join(".agent/skills/nested")).unwrap();
        write_skill(
            &ws,
            ".agent/skills/alpha.md",
            "---\ndescription: Alpha skill\n---\n\n# Alpha\n",
        );
        write_skill(
            &ws,
            ".agent/skills/nested/beta.md",
            "First paragraph about beta.\n\nMore text.\n",
        );

        let conn = open_db_at(&dir.path().join("t.db")).unwrap();
        let agent = upsert_agent(
            &conn,
            AgentUpsert {
                id: None,
                name: "scan-demo".into(),
                description: None,
                workspace_path: ws.to_string_lossy().to_string(),
                git_url: None,
                default_cli: "codex".into(),
                status: None,
            },
        )
        .unwrap();

        let r1 = sync_agent_skills(&conn, &agent.id).unwrap();
        assert_eq!(r1.added, 2);
        assert_eq!(r1.updated, 0);
        assert_eq!(r1.removed, 0);

        let skills = list_skills_by_agent(&conn, &agent.id).unwrap();
        assert_eq!(skills.len(), 2);
        let alpha = skills
            .iter()
            .find(|s| s.relative_path.ends_with("alpha.md"))
            .unwrap();
        assert_eq!(alpha.description.as_deref(), Some("Alpha skill"));
        assert!(alpha.enabled);

        set_skill_enabled(&conn, &alpha.id, false).unwrap();

        // Remove beta, tweak alpha content → preserve disabled
        fs::remove_file(ws.join(".agent/skills/nested/beta.md")).unwrap();
        write_skill(
            &ws,
            ".agent/skills/alpha.md",
            "---\ndescription: Alpha skill v2\n---\n\n# Alpha\n",
        );

        let r2 = sync_agent_skills(&conn, &agent.id).unwrap();
        assert_eq!(r2.added, 0);
        assert_eq!(r2.removed, 1);
        assert!(r2.updated >= 1);

        let skills2 = list_skills_by_agent(&conn, &agent.id).unwrap();
        assert_eq!(skills2.len(), 1);
        assert!(!skills2[0].enabled);
        assert_eq!(skills2[0].description.as_deref(), Some("Alpha skill v2"));

        let content = read_skill_content(&conn, &agent.id, &skills2[0].relative_path).unwrap();
        assert!(content.contains("Alpha skill v2"));
    }

    #[test]
    fn reject_path_escape() {
        let dir = TempDir::new().unwrap();
        let ws = dir.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        assert!(resolve_skill_file(&ws, "../etc/passwd").is_err());
        assert!(resolve_skill_file(&ws, "/etc/passwd").is_err());
    }
}
