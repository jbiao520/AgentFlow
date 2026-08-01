//! Build the user-facing acceptance report for a terminal task run.
//!
//! The report is intentionally deterministic: the run state and workspace are
//! the source of truth, while agents may add richer details with the
//! AGENTFLOW_* markers documented in `agent_prompt_footer`.
use crate::db::now_iso8601;
use crate::repo::{
    get_agent, get_plan, get_task_run, list_task_logs, set_delivery_report, TaskNode, TaskRun,
};
use crate::services::orchestrate::parse_plan_json;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::process::Command;

const MAX_DIFF_CHARS: usize = 80_000;
const MAX_RISKS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryChangedFile {
    pub path: String,
    pub status: String,
    pub workspace: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryArtifact {
    pub path: String,
    pub node_id: String,
    pub node_title: String,
    pub agent_id: Option<String>,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryVerification {
    pub label: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryReport {
    pub generated_at: String,
    pub summary: String,
    pub changed_files: Vec<DeliveryChangedFile>,
    pub diff: Option<String>,
    pub artifacts: Vec<DeliveryArtifact>,
    pub verification: Vec<DeliveryVerification>,
    pub risks: Vec<String>,
}

/// Marker footer added to every node prompt. Agents that emit these lines get
/// richer, human-readable acceptance details without making the report depend
/// on a second model call.
pub fn agent_prompt_footer() -> &'static str {
    "\n\nWhen you finish, emit these machine-readable lines (one per line, in plain text):\nAGENTFLOW_SUMMARY: <one-sentence result>\nAGENTFLOW_VERIFY: PASS | <check name> | <what you checked>\nAGENTFLOW_RISK: <remaining risk, or omit this line if none>\nKeep using AGENTFLOW_ARTIFACT: <workspace-relative path> for every file you create."
}

pub fn finalize_delivery_report(conn: &Connection, run_id: &str) -> Result<TaskRun, String> {
    let report = build_delivery_report(conn, run_id)?;
    let json =
        serde_json::to_string(&report).map_err(|e| format!("serialize delivery report: {e}"))?;
    set_delivery_report(conn, run_id, &json)
}

pub fn build_delivery_report(conn: &Connection, run_id: &str) -> Result<DeliveryReport, String> {
    let full =
        get_task_run(conn, run_id)?.ok_or_else(|| format!("task run not found: {run_id}"))?;
    let logs = list_task_logs(conn, run_id, None)?;

    let mut summaries = Vec::new();
    let mut explicit_verification = Vec::new();
    let mut risks = Vec::new();
    for log in &logs {
        if let Some(value) = first_marker_payload(
            &log.message,
            &["AGENTFLOW_SUMMARY:", "AGENTMIND_SUMMARY:"],
        ) {
            if !summaries.contains(&value) {
                summaries.push(value);
            }
        }
        if let Some(value) = first_marker_payload(
            &log.message,
            &["AGENTFLOW_VERIFY:", "AGENTMIND_VERIFY:"],
        ) {
            explicit_verification.push(parse_verification(&value));
        }
        if let Some(value) =
            first_marker_payload(&log.message, &["AGENTFLOW_RISK:", "AGENTMIND_RISK:"])
        {
            push_unique(&mut risks, value);
        }
        if matches!(log.level.as_str(), "warn" | "error")
            && !log.message.contains("AGENTFLOW_RISK:")
            && !log.message.contains("AGENTMIND_RISK:")
        {
            push_unique(&mut risks, clean_log_message(&log.message));
        }
    }

    let has_explicit_verification = !explicit_verification.is_empty();
    let mut verification = full.nodes.iter().map(node_verification).collect::<Vec<_>>();
    verification.extend(explicit_verification);
    for result in &verification {
        if result.status == "failed" {
            push_unique(
                &mut risks,
                format!("验证失败：{}：{}", result.label, result.detail),
            );
        }
    }

    for node in &full.nodes {
        match node.status.as_str() {
            "skipped" => push_unique(&mut risks, format!("节点已跳过：{}", node.title)),
            "failed" => push_unique(&mut risks, format!("节点失败：{}", node.title)),
            "pending" | "running" => push_unique(
                &mut risks,
                format!("节点未完成：{}（{}）", node.title, node.status),
            ),
            _ => {}
        }
    }
    if let Some(error) = full
        .run
        .error
        .as_deref()
        .filter(|error| !error.trim().is_empty())
    {
        push_unique(&mut risks, format!("Run 错误：{}", error.trim()));
    }
    if full.run.status == "cancelled" {
        push_unique(&mut risks, "任务被取消，未完成节点不会被视为通过。".into());
    }
    if full.run.status == "success" && !has_explicit_verification {
        push_unique(
            &mut risks,
            "未检测到自动化验证结果标记；当前仅确认各执行节点退出成功。".into(),
        );
    }

    let artifacts = collect_artifacts(conn, &full.nodes);
    for artifact in &artifacts {
        if !artifact.exists {
            push_unique(
                &mut risks,
                format!(
                    "产物缺失：{}（节点：{}）",
                    artifact.path, artifact.node_title
                ),
            );
        }
    }
    let (changed_files, diff, workspace_risks) = collect_workspace_changes(conn, &full.nodes);
    for risk in workspace_risks {
        push_unique(&mut risks, risk);
    }
    risks.truncate(MAX_RISKS);

    let summary = if !summaries.is_empty() {
        summaries.join("\n")
    } else {
        fallback_summary(conn, &full.run, &full.nodes)
    };

    Ok(DeliveryReport {
        generated_at: now_iso8601(),
        summary,
        changed_files,
        diff,
        artifacts,
        verification,
        risks,
    })
}

fn fallback_summary(conn: &Connection, run: &TaskRun, nodes: &[TaskNode]) -> String {
    let intent = get_plan(conn, &run.plan_id)
        .ok()
        .flatten()
        .and_then(|plan| parse_plan_json(&plan.analysis_json).ok())
        .map(|plan| plan.intent.summary.trim().to_string())
        .filter(|summary| !summary.is_empty());
    let total = nodes.len();
    let passed = nodes.iter().filter(|n| n.status == "success").count();
    let failed = nodes.iter().filter(|n| n.status == "failed").count();
    let skipped = nodes.iter().filter(|n| n.status == "skipped").count();
    let outcome = match run.status.as_str() {
        "success" => "任务已完成",
        "cancelled" => "任务已取消",
        "failed" => "任务未完成",
        _ => "任务已结束",
    };
    let counts = format!("{passed}/{total} 个节点通过，{failed} 个失败，{skipped} 个跳过");
    match intent {
        Some(intent) => format!("{outcome}：{intent}。{counts}。"),
        None => format!("{outcome}。{counts}。"),
    }
}

fn node_verification(node: &TaskNode) -> DeliveryVerification {
    let (status, detail) = match node.status.as_str() {
        "success" => ("passed", "CLI 进程退出码为 0"),
        "failed" => ("failed", "CLI 进程失败或返回非 0 退出码"),
        "skipped" => ("skipped", "节点被人工跳过或因取消而跳过"),
        _ => ("unknown", "节点尚未进入终态"),
    };
    DeliveryVerification {
        label: format!("节点：{}", node.title),
        status: status.into(),
        detail: detail.into(),
    }
}

fn parse_verification(value: &str) -> DeliveryVerification {
    let mut parts = value.splitn(3, '|').map(str::trim);
    let raw_status = parts.next().unwrap_or("unknown").to_lowercase();
    let status = match raw_status.as_str() {
        "pass" | "passed" | "ok" | "success" => "passed",
        "fail" | "failed" | "error" => "failed",
        "skip" | "skipped" => "skipped",
        _ => "unknown",
    };
    let label = parts
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("Agent 验证");
    let detail = parts
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(value)
        .to_string();
    DeliveryVerification {
        label: label.to_string(),
        status: status.into(),
        detail,
    }
}

fn marker_payload(message: &str, marker: &str) -> Option<String> {
    message
        .split_once(marker)
        .map(|(_, value)| {
            // Take only the first line of the payload (markers are one line each).
            value.lines().next().unwrap_or(value).trim().to_string()
        })
        .filter(|value| !value.is_empty())
}

fn first_marker_payload(message: &str, markers: &[&str]) -> Option<String> {
    for marker in markers {
        if let Some(value) = marker_payload(message, marker) {
            return Some(value);
        }
    }
    None
}

fn clean_log_message(message: &str) -> String {
    message
        .strip_prefix("[agent] ")
        .or_else(|| message.strip_prefix("[status] "))
        .unwrap_or(message)
        .trim()
        .to_string()
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !value.is_empty() && !values.contains(&value) {
        values.push(value);
    }
}

fn collect_artifacts(conn: &Connection, nodes: &[TaskNode]) -> Vec<DeliveryArtifact> {
    let mut artifacts = Vec::new();
    let mut seen = HashSet::new();
    for node in nodes {
        let paths = node
            .artifact_paths_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<Vec<String>>(json).ok())
            .unwrap_or_default();
        let workspace = node
            .agent_id
            .as_deref()
            .and_then(|id| get_agent(conn, id).ok().flatten())
            .map(|agent| PathBuf::from(agent.workspace_path));
        for path in paths {
            let path = path.trim().to_string();
            if path.is_empty()
                || !safe_relative_path(&path)
                || !seen.insert((node.id.clone(), path.clone()))
            {
                continue;
            }
            let exists = workspace
                .as_ref()
                .map(|root| root.join(&path).is_file())
                .unwrap_or(false);
            artifacts.push(DeliveryArtifact {
                path,
                node_id: node.id.clone(),
                node_title: node.title.clone(),
                agent_id: node.agent_id.clone(),
                exists,
            });
        }
    }
    artifacts
}

fn safe_relative_path(path: &str) -> bool {
    let path = Path::new(path);
    !path.is_absolute()
        && path
            .components()
            .all(|component| !matches!(component, Component::ParentDir | Component::RootDir))
}

fn collect_workspace_changes(
    conn: &Connection,
    nodes: &[TaskNode],
) -> (Vec<DeliveryChangedFile>, Option<String>, Vec<String>) {
    let mut workspaces: HashMap<String, (String, PathBuf)> = HashMap::new();
    let mut risks = Vec::new();
    for node in nodes {
        let Some(agent_id) = node.agent_id.as_deref() else {
            continue;
        };
        if workspaces.contains_key(agent_id) {
            continue;
        }
        match get_agent(conn, agent_id) {
            Ok(Some(agent)) => {
                workspaces.insert(
                    agent_id.to_string(),
                    (agent.name, PathBuf::from(agent.workspace_path)),
                );
            }
            Ok(None) => push_unique(&mut risks, format!("无法定位 Agent workspace：{agent_id}")),
            Err(error) => push_unique(&mut risks, format!("读取 Agent workspace 失败：{error}")),
        }
    }

    let mut changed_files = Vec::new();
    let mut diff_sections = Vec::new();
    for (agent_id, (agent_name, workspace)) in workspaces {
        match git_output(&workspace, &["rev-parse", "--show-toplevel"]) {
            Ok(_) => {}
            Err(_) => {
                push_unique(
                    &mut risks,
                    format!("workspace「{agent_name}」不是 Git 仓库，无法生成 Diff。"),
                );
                continue;
            }
        };
        let status = match git_output(&workspace, &["status", "--short", "--untracked-files=all"]) {
            Ok(status) => status,
            Err(error) => {
                push_unique(
                    &mut risks,
                    format!("读取 workspace「{agent_name}」改动失败：{error}"),
                );
                continue;
            }
        };
        for line in status.lines().filter(|line| !line.trim().is_empty()) {
            let code = line.get(..2).unwrap_or("??").trim();
            let path = line.get(3..).unwrap_or(line).trim().trim_matches('"');
            changed_files.push(DeliveryChangedFile {
                path: path.to_string(),
                status: if code.is_empty() {
                    "changed".into()
                } else {
                    code.into()
                },
                workspace: agent_name.clone(),
            });
            if code == "??" {
                push_unique(
                    &mut risks,
                    format!(
                        "workspace「{agent_name}」包含未跟踪文件；Diff 仅展示 Git 已跟踪内容。"
                    ),
                );
            }
        }

        let diff = match git_output(&workspace, &["diff", "--no-ext-diff", "HEAD", "--"]) {
            Ok(diff) => diff,
            Err(_) => {
                let unstaged =
                    git_output(&workspace, &["diff", "--no-ext-diff", "--"]).unwrap_or_default();
                let staged = git_output(&workspace, &["diff", "--no-ext-diff", "--cached"])
                    .unwrap_or_default();
                format!("{unstaged}{staged}")
            }
        };
        if !diff.trim().is_empty() {
            diff_sections.push(format!(
                "--- workspace: {agent_name} ({agent_id}) ---\n{diff}"
            ));
        }
    }

    changed_files.sort_by(|a, b| a.workspace.cmp(&b.workspace).then(a.path.cmp(&b.path)));
    let diff = if diff_sections.is_empty() {
        None
    } else {
        Some(limit_chars(&diff_sections.join("\n\n")))
    };
    (changed_files, diff, risks)
}

fn git_output(workspace: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(workspace)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn limit_chars(value: &str) -> String {
    if value.chars().count() <= MAX_DIFF_CHARS {
        return value.to_string();
    }
    let mut output: String = value.chars().take(MAX_DIFF_CHARS).collect();
    output.push_str("\n\n[Diff 已截断，完整改动请在 workspace 中查看]");
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_machine_readable_markers() {
        assert_eq!(
            marker_payload(
                "[agent] AGENTFLOW_SUMMARY: shipped it",
                "AGENTFLOW_SUMMARY:"
            ),
            Some("shipped it".into())
        );
        let verification = parse_verification("PASS | unit tests | cargo test passed");
        assert_eq!(verification.status, "passed");
        assert_eq!(verification.label, "unit tests");
        assert_eq!(verification.detail, "cargo test passed");
    }

    #[test]
    fn rejects_unsafe_artifact_paths() {
        assert!(safe_relative_path("artifacts/out.md"));
        assert!(!safe_relative_path("../secret"));
        assert!(!safe_relative_path("/tmp/out.md"));
    }
}
