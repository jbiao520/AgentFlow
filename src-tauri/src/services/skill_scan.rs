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

fn unquote_yaml_scalar(raw: &str) -> String {
    let s = raw.trim();
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

/// Parse YAML frontmatter `name` / `description` (inline or `>` / `|` block).
/// Falls back to `fallback_title` and first body paragraph when missing.
pub fn parse_skill_meta(content: &str, fallback_title: &str) -> (String, Option<String>) {
    let mut title = fallback_title.to_string();
    let trimmed = content.trim_start_matches('\u{feff}');

    let Some(rest) = trimmed.strip_prefix("---") else {
        return (title, first_paragraph(trimmed));
    };
    // Allow optional newline right after opening ---
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    let Some(end) = rest.find("\n---") else {
        return (title, first_paragraph(trimmed));
    };
    let fm = &rest[..end];
    let body = rest[end + 4..].trim();

    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let lines: Vec<&str> = fm.lines().collect();
    let mut i = 0usize;
    while i < lines.len() {
        let line = lines[i];
        let trimmed_line = line.trim();
        if trimmed_line.is_empty() || trimmed_line.starts_with('#') {
            i += 1;
            continue;
        }

        if let Some(val) = trimmed_line.strip_prefix("name:") {
            let v = unquote_yaml_scalar(val);
            if !v.is_empty() {
                name = Some(v);
            }
            i += 1;
            continue;
        }

        if let Some(val) = trimmed_line.strip_prefix("description:") {
            let after = val.trim();
            if after == ">" || after == "|" || after == ">-" || after == "|-" {
                let mut block = String::new();
                i += 1;
                while i < lines.len() {
                    let next = lines[i];
                    // Block ends at next non-empty, non-indented key line
                    if !next.is_empty() && !next.starts_with(' ') && !next.starts_with('\t') {
                        break;
                    }
                    let piece = next.trim();
                    if !piece.is_empty() {
                        if !block.is_empty() {
                            block.push(' ');
                        }
                        block.push_str(piece);
                    }
                    i += 1;
                }
                let desc = block.trim().to_string();
                if !desc.is_empty() {
                    description = Some(desc);
                }
                continue;
            }
            let desc = unquote_yaml_scalar(after);
            if !desc.is_empty() {
                description = Some(desc);
            }
            i += 1;
            continue;
        }

        i += 1;
    }

    if let Some(n) = name {
        title = n;
    }
    if description.is_none() {
        description = first_paragraph(body);
    }
    (title, description)
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

fn is_skill_md(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("skill.md"))
        .unwrap_or(false)
}

/// Recursively collect only `skill.md` / `SKILL.md` under `.agent/skills/`.
fn walk_skill_mds(skills_root: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    if !skills_root.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(skills_root).map_err(|e| format!("read skills dir: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read skills entry: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            walk_skill_mds(&path, out)?;
        } else if is_skill_md(&path) {
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

fn skill_fallback_title(file: &Path) -> String {
    // Prefer parent folder name (e.g. `.agent/skills/web-crawler/skill.md` → web-crawler)
    file.parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .filter(|n| !n.eq_ignore_ascii_case("skills"))
        .map(|n| n.to_string())
        .unwrap_or_else(|| "skill".into())
}

fn scan_workspace_skills(workspace: &Path) -> Result<Vec<ScannedSkill>, String> {
    let skills_dir = workspace.join(".agent").join("skills");
    let mut files = Vec::new();
    walk_skill_mds(&skills_dir, &mut files)?;
    files.sort();

    let mut scanned = Vec::with_capacity(files.len());
    for file in files {
        let bytes = fs::read(&file).map_err(|e| format!("read {}: {e}", file.display()))?;
        let content = String::from_utf8_lossy(&bytes);
        let fallback = skill_fallback_title(&file);
        let (title, description) = parse_skill_meta(&content, &fallback);
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
    fn parse_frontmatter_name_and_folded_description() {
        let content = r#"---
name: investment-news-risk
description: >
  对投资/财经新闻做连带风险分析。
  Use when the user asks for 投资新闻风险.
  也可在用户运行 /investment-news-risk 时使用。
---

# Body should be ignored for listing
"#;
        let (title, desc) = parse_skill_meta(content, "fallback");
        assert_eq!(title, "investment-news-risk");
        let desc = desc.expect("description");
        assert!(desc.contains("连带风险分析"));
        assert!(desc.contains("投资新闻风险"));
        assert!(desc.contains("/investment-news-risk"));
        assert!(!desc.contains("Body should"));
    }

    #[test]
    fn sync_only_skill_md_add_remove_preserve_enabled() {
        let dir = TempDir::new().unwrap();
        let ws = dir.path().join("ws");
        fs::create_dir_all(ws.join(".agent/skills/alpha")).unwrap();
        fs::create_dir_all(ws.join(".agent/skills/beta")).unwrap();
        // Extra markdown next to skill.md must be ignored
        write_skill(
            &ws,
            ".agent/skills/alpha/notes.md",
            "# Notes\nShould not be scanned.\n",
        );
        write_skill(
            &ws,
            ".agent/skills/alpha/skill.md",
            "---\nname: alpha-skill\ndescription: Alpha skill\n---\n\n# Alpha\n",
        );
        write_skill(
            &ws,
            ".agent/skills/beta/SKILL.md",
            "---\nname: beta-skill\ndescription: First paragraph about beta.\n---\n\nMore text.\n",
        );
        // Flat arbitrary .md under skills/ must also be ignored
        write_skill(&ws, ".agent/skills/orphan.md", "orphan\n");

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
            .find(|s| s.relative_path.ends_with("alpha/skill.md"))
            .unwrap();
        assert_eq!(alpha.title.as_deref(), Some("alpha-skill"));
        assert_eq!(alpha.description.as_deref(), Some("Alpha skill"));
        assert!(alpha.enabled);

        set_skill_enabled(&conn, &alpha.id, false).unwrap();

        // Remove beta, tweak alpha content → preserve disabled
        fs::remove_file(ws.join(".agent/skills/beta/SKILL.md")).unwrap();
        write_skill(
            &ws,
            ".agent/skills/alpha/skill.md",
            "---\nname: alpha-skill\ndescription: Alpha skill v2\n---\n\n# Alpha\n",
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
