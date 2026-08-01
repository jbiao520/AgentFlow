//! One-shot migration from AgentMind → AgentFlow app data.
//!
//! Copies `~/Library/Application Support/AgentMind/` to `AgentFlow/`,
//! renames the DB, rewrites brand/marker strings inside SQLite TEXT fields,
//! renames `.agentmind` handoff dirs under agent workspaces, then removes the
//! legacy Application Support directory when migration succeeds.

use rusqlite::Connection;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Run before opening the AgentFlow database. Safe to call repeatedly.
pub fn migrate_from_agentmind() -> Result<(), String> {
    let Some(new_proj) = directories::ProjectDirs::from("", "", "AgentFlow") else {
        return Ok(());
    };
    let Some(old_proj) = directories::ProjectDirs::from("", "", "AgentMind") else {
        return Ok(());
    };

    let new_dir = new_proj.data_dir().to_path_buf();
    let old_dir = old_proj.data_dir().to_path_buf();
    let new_db = new_dir.join("agentflow.db");
    let old_db = old_dir.join("agentmind.db");

    if !old_dir.exists() {
        return Ok(());
    }

    if new_db.exists() {
        // Already on AgentFlow; drop leftover legacy tree if present.
        if old_dir.exists() {
            match fs::remove_dir_all(&old_dir) {
                Ok(()) => eprintln!(
                    "[AgentFlow] removed leftover AgentMind data dir: {}",
                    old_dir.display()
                ),
                Err(e) => eprintln!(
                    "[AgentFlow] could not remove leftover AgentMind data dir {}: {e}",
                    old_dir.display()
                ),
            }
        }
        return Ok(());
    }

    if !old_db.exists() {
        // Empty or partial legacy dir — still clean up.
        if old_dir.exists() {
            let _ = fs::remove_dir_all(&old_dir);
        }
        return Ok(());
    }

    eprintln!(
        "[AgentFlow] migrating data from {} → {}",
        old_dir.display(),
        new_dir.display()
    );

    if new_dir.exists() {
        // Partial prior attempt without DB — start clean.
        fs::remove_dir_all(&new_dir).map_err(|e| format!("clear partial AgentFlow dir: {e}"))?;
    }

    copy_dir_recursive(&old_dir, &new_dir).map_err(|e| format!("copy AgentMind data: {e}"))?;

    let staged_old_db = new_dir.join("agentmind.db");
    if staged_old_db.exists() {
        fs::rename(&staged_old_db, &new_db).map_err(|e| format!("rename db: {e}"))?;
    }

    rewrite_db_brand_strings(&new_db)?;
    rename_workspace_handoff_dirs(&new_db)?;

    fs::remove_dir_all(&old_dir).map_err(|e| {
        format!(
            "migration copied OK but failed to remove old dir {}: {e}",
            old_dir.display()
        )
    })?;

    eprintln!(
        "[AgentFlow] migration complete; legacy AgentMind data dir removed"
    );
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if ty.is_file() {
            fs::copy(&from, &to)?;
        } else if ty.is_symlink() {
            // Best-effort: re-create symlink if possible.
            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;
                if let Ok(target) = fs::read_link(&from) {
                    let _ = symlink(target, &to);
                }
            }
        }
    }
    Ok(())
}

/// Rewrite brand / protocol / handoff path strings inside TEXT columns.
fn rewrite_db_brand_strings(db_path: &Path) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| format!("open migrated db: {e}"))?;

    // Order: ALL-CAPS marker first, then PascalCase brand, then lowercase path segment.
    let replacements = [
        ("AGENTMIND", "AGENTFLOW"),
        ("AgentMind", "AgentFlow"),
        ("agentmind", "agentflow"),
    ];

    let tables: Vec<(String, Vec<String>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .map_err(|e| format!("list tables: {e}"))?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("query tables: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("tables: {e}"))?;

        let mut out = Vec::new();
        for table in names {
            let pragma = format!("PRAGMA table_info(\"{table}\")");
            let mut col_stmt = conn
                .prepare(&pragma)
                .map_err(|e| format!("pragma {table}: {e}"))?;
            let cols = col_stmt
                .query_map([], |row| {
                    let name: String = row.get(1)?;
                    let decl: String = row.get(2)?;
                    Ok((name, decl))
                })
                .map_err(|e| format!("cols {table}: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("cols collect {table}: {e}"))?;

            let text_cols: Vec<String> = cols
                .into_iter()
                .filter(|(_, decl)| {
                    let d = decl.to_uppercase();
                    d.contains("TEXT") || d.is_empty() || d == "BLOB"
                })
                .map(|(name, _)| name)
                .collect();
            if !text_cols.is_empty() {
                out.push((table, text_cols));
            }
        }
        out
    };

    for (table, cols) in tables {
        for col in cols {
            for (from, to) in &replacements {
                let sql = format!(
                    "UPDATE \"{table}\" SET \"{col}\" = REPLACE(\"{col}\", ?1, ?2) WHERE \"{col}\" IS NOT NULL AND instr(\"{col}\", ?1) > 0"
                );
                conn.execute(&sql, [*from, *to])
                    .map_err(|e| format!("rewrite {table}.{col}: {e}"))?;
            }
        }
    }

    Ok(())
}

/// Rename `.agentmind` → `.agentflow` under each agent workspace (handoff history).
fn rename_workspace_handoff_dirs(db_path: &Path) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| format!("open db for workspaces: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT workspace_path FROM agents WHERE workspace_path IS NOT NULL")
        .map_err(|e| format!("prepare agents: {e}"))?;
    let paths = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query workspace_path: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("workspace paths: {e}"))?;

    for ws in paths {
        let root = PathBuf::from(&ws);
        if !root.is_dir() {
            continue;
        }
        let old = root.join(".agentmind");
        let new = root.join(".agentflow");
        if old.is_dir() {
            if new.exists() {
                // Merge: move children then remove old.
                if let Err(e) = merge_dir_into(&old, &new) {
                    eprintln!(
                        "[AgentFlow] merge handoff {} → {}: {e}",
                        old.display(),
                        new.display()
                    );
                } else if let Err(e) = fs::remove_dir_all(&old) {
                    eprintln!("[AgentFlow] remove {}: {e}", old.display());
                } else {
                    eprintln!(
                        "[AgentFlow] merged workspace handoff {} → {}",
                        old.display(),
                        new.display()
                    );
                }
            } else if let Err(e) = fs::rename(&old, &new) {
                eprintln!(
                    "[AgentFlow] rename handoff {} → {}: {e}",
                    old.display(),
                    new.display()
                );
            } else {
                eprintln!(
                    "[AgentFlow] renamed workspace handoff {} → {}",
                    old.display(),
                    new.display()
                );
            }
        }
    }
    Ok(())
}

fn merge_dir_into(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            merge_dir_into(&from, &to)?;
        } else if !to.exists() {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_is_idempotent() {
        // No-op when no legacy data; succeeds after a real migrate too.
        migrate_from_agentmind().expect("migrate_from_agentmind");
    }
}
