//! Runtime artifact handoff: copy predecessor outputs into the consumer workspace
//! and build prompt sections so downstream agents can find them.

use std::fs;
use std::path::{Component, Path, PathBuf};

pub const ARTIFACT_MARKER_FOOTER: &str = "\n\nWhen you create or update output files, print exactly one line per file:\nAGENTFLOW_ARTIFACT:relative/path/from/workspace/root";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandoffInput {
    pub from_title: String,
    pub from_local_id: String,
    /// Workspace-relative paths under the consumer workspace.
    pub dest_relative_paths: Vec<String>,
}

/// Strip `run_id:` prefix from a node id when present.
pub fn node_local_id(node_id: &str, run_id: &str) -> String {
    let prefix = format!("{run_id}:");
    node_id
        .strip_prefix(&prefix)
        .unwrap_or(node_id)
        .to_string()
}

/// Normalize an artifact path to a workspace-relative string.
/// Absolute paths under `workspace` are stripped; `..` and escape attempts are rejected.
pub fn normalize_artifact_path(raw: &str, workspace: &Path) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = Path::new(trimmed);
    let relative = if path.is_absolute() {
        let ws = workspace.canonicalize().ok()?;
        let abs = PathBuf::from(trimmed);
        let canon = abs.canonicalize().ok().unwrap_or(abs);
        let rel = canon.strip_prefix(&ws).ok()?;
        rel.to_path_buf()
    } else {
        path.to_path_buf()
    };

    if relative.as_os_str().is_empty() {
        return None;
    }
    for c in relative.components() {
        if matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return None;
        }
    }
    Some(relative.to_string_lossy().replace('\\', "/"))
}

pub fn parse_artifact_paths_json(json: Option<&str>) -> Vec<String> {
    json.and_then(|j| serde_json::from_str::<Vec<String>>(j).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Destination relative path inside the consumer workspace.
pub fn handoff_relative_path(run_id: &str, pred_local_id: &str, original_rel: &str) -> String {
    format!(
        ".agentflow/handoff/{run_id}/{pred_local_id}/{}",
        original_rel.trim_start_matches('/')
    )
}

/// Keep only paths that exist as files under `workspace` after normalization.
pub fn filter_existing_artifacts(workspace: &Path, paths: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for raw in paths {
        let Some(rel) = normalize_artifact_path(raw, workspace) else {
            continue;
        };
        let full = workspace.join(&rel);
        if full.is_file() {
            if !out.contains(&rel) {
                out.push(rel);
            }
        }
    }
    out
}

/// Copy predecessor artifacts into `dest_workspace`. Missing files become warnings.
pub fn copy_predecessor_artifacts(
    run_id: &str,
    pred_title: &str,
    pred_local_id: &str,
    pred_workspace: &Path,
    dest_workspace: &Path,
    artifact_paths: &[String],
) -> (HandoffInput, Vec<String>) {
    let mut warnings = Vec::new();
    let mut dest_relative_paths = Vec::new();

    if artifact_paths.is_empty() {
        return (
            HandoffInput {
                from_title: pred_title.to_string(),
                from_local_id: pred_local_id.to_string(),
                dest_relative_paths,
            },
            warnings,
        );
    }

    for raw in artifact_paths {
        let Some(rel) = normalize_artifact_path(raw, pred_workspace) else {
            warnings.push(format!(
                "handoff skip invalid path from {pred_local_id}: {raw}"
            ));
            continue;
        };
        let src = pred_workspace.join(&rel);
        if !src.is_file() {
            warnings.push(format!(
                "handoff missing file from {pred_local_id}: {rel}"
            ));
            continue;
        }
        let dest_rel = handoff_relative_path(run_id, pred_local_id, &rel);
        let dest = dest_workspace.join(&dest_rel);
        if let Some(parent) = dest.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                warnings.push(format!(
                    "handoff mkdir failed for {dest_rel}: {e}"
                ));
                continue;
            }
        }
        match fs::copy(&src, &dest) {
            Ok(_) => {
                if !dest_relative_paths.contains(&dest_rel) {
                    dest_relative_paths.push(dest_rel);
                }
            }
            Err(e) => {
                warnings.push(format!("handoff copy failed for {rel}: {e}"));
            }
        }
    }

    (
        HandoffInput {
            from_title: pred_title.to_string(),
            from_local_id: pred_local_id.to_string(),
            dest_relative_paths,
        },
        warnings,
    )
}

/// Build the "## Inputs from previous steps" prompt block. Empty if nothing copied.
pub fn build_inputs_section(inputs: &[HandoffInput]) -> String {
    let with_files: Vec<_> = inputs
        .iter()
        .filter(|i| !i.dest_relative_paths.is_empty())
        .collect();
    if with_files.is_empty() {
        return String::new();
    }

    let mut out = String::from(
        "\n\n## Inputs from previous steps\nThese files were copied into your workspace. Read them before proceeding.\n",
    );
    for input in with_files {
        out.push_str(&format!(
            "- From \"{}\" ({}):\n",
            input.from_title, input.from_local_id
        ));
        for path in &input.dest_relative_paths {
            out.push_str(&format!("  - {path}\n"));
        }
    }
    out
}

/// Append inputs section (if any) and the artifact marker footer.
pub fn enrich_prompt(base: &str, inputs: &[HandoffInput]) -> String {
    let mut prompt = base.trim_end().to_string();
    prompt.push_str(&build_inputs_section(inputs));
    prompt.push_str(ARTIFACT_MARKER_FOOTER);
    prompt
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn node_local_id_strips_run_prefix() {
        assert_eq!(node_local_id("run1:t2", "run1"), "t2");
        assert_eq!(node_local_id("t2", "run1"), "t2");
    }

    #[test]
    fn normalize_rejects_parent_dir() {
        let tmp = TempDir::new().unwrap();
        assert!(normalize_artifact_path("../secret", tmp.path()).is_none());
        assert!(normalize_artifact_path("a/../../b", tmp.path()).is_none());
    }

    #[test]
    fn normalize_relative_ok() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(
            normalize_artifact_path("notes.md", tmp.path()).as_deref(),
            Some("notes.md")
        );
        assert_eq!(
            normalize_artifact_path("out/summary.md", tmp.path()).as_deref(),
            Some("out/summary.md")
        );
    }

    #[test]
    fn normalize_absolute_under_workspace() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("notes.md");
        fs::write(&file, "hi").unwrap();
        let abs = file.canonicalize().unwrap();
        assert_eq!(
            normalize_artifact_path(&abs.to_string_lossy(), tmp.path()).as_deref(),
            Some("notes.md")
        );
    }

    #[test]
    fn normalize_absolute_outside_workspace_rejected() {
        let tmp = TempDir::new().unwrap();
        assert!(normalize_artifact_path("/etc/passwd", tmp.path()).is_none());
    }

    #[test]
    fn handoff_relative_path_layout() {
        assert_eq!(
            handoff_relative_path("r1", "t1", "notes.md"),
            ".agentflow/handoff/r1/t1/notes.md"
        );
        assert_eq!(
            handoff_relative_path("r1", "t1", "out/a.md"),
            ".agentflow/handoff/r1/t1/out/a.md"
        );
    }

    #[test]
    fn copy_across_workspaces() {
        let src_ws = TempDir::new().unwrap();
        let dest_ws = TempDir::new().unwrap();
        fs::write(src_ws.path().join("notes.md"), "findings").unwrap();

        let (input, warnings) = copy_predecessor_artifacts(
            "run1",
            "Collect notes",
            "t1",
            src_ws.path(),
            dest_ws.path(),
            &["notes.md".into()],
        );
        assert!(warnings.is_empty());
        assert_eq!(
            input.dest_relative_paths,
            vec![".agentflow/handoff/run1/t1/notes.md".to_string()]
        );
        let dest = dest_ws
            .path()
            .join(".agentflow/handoff/run1/t1/notes.md");
        assert_eq!(fs::read_to_string(dest).unwrap(), "findings");
    }

    #[test]
    fn copy_same_workspace_still_stages() {
        let ws = TempDir::new().unwrap();
        fs::write(ws.path().join("notes.md"), "x").unwrap();
        let (input, warnings) = copy_predecessor_artifacts(
            "run1",
            "A",
            "t1",
            ws.path(),
            ws.path(),
            &["notes.md".into()],
        );
        assert!(warnings.is_empty());
        assert!(ws
            .path()
            .join(".agentflow/handoff/run1/t1/notes.md")
            .is_file());
        assert_eq!(input.dest_relative_paths.len(), 1);
    }

    #[test]
    fn copy_missing_file_warns() {
        let src_ws = TempDir::new().unwrap();
        let dest_ws = TempDir::new().unwrap();
        let (input, warnings) = copy_predecessor_artifacts(
            "run1",
            "A",
            "t1",
            src_ws.path(),
            dest_ws.path(),
            &["missing.md".into()],
        );
        assert!(input.dest_relative_paths.is_empty());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("missing"));
    }

    #[test]
    fn filter_existing_drops_missing() {
        let ws = TempDir::new().unwrap();
        fs::write(ws.path().join("a.md"), "a").unwrap();
        let kept = filter_existing_artifacts(
            ws.path(),
            &["a.md".into(), "b.md".into()],
        );
        assert_eq!(kept, vec!["a.md".to_string()]);
    }

    #[test]
    fn build_inputs_section_empty_when_no_files() {
        assert!(build_inputs_section(&[]).is_empty());
        assert!(build_inputs_section(&[HandoffInput {
            from_title: "A".into(),
            from_local_id: "t1".into(),
            dest_relative_paths: vec![],
        }])
        .is_empty());
    }

    #[test]
    fn enrich_prompt_includes_inputs_and_footer() {
        let inputs = vec![HandoffInput {
            from_title: "Collect".into(),
            from_local_id: "t1".into(),
            dest_relative_paths: vec![".agentflow/handoff/r/t1/notes.md".into()],
        }];
        let prompt = enrich_prompt("Do the work.", &inputs);
        assert!(prompt.contains("## Inputs from previous steps"));
        assert!(prompt.contains(".agentflow/handoff/r/t1/notes.md"));
        assert!(prompt.contains("AGENTFLOW_ARTIFACT:"));
        assert!(prompt.starts_with("Do the work."));
    }
}
