# Task Artifact Viewer — Design

Date: 2026-08-01  
Status: validated (option A)  
Scope: 任务中心产物面板

## Goal

让用户在任务中心方便查看 Agent 执行产物：列出全部路径、预览内容，并在 Finder 中定位真实文件（缺失时回退到目录）。

## Approach

增强现有「自动化产生的数据与文档产物」面板，不新开页面。

## UI

1. 左侧产物路径列表（节点全部 `artifact_paths`）
2. 右侧文本预览（复用 `read_workspace_file`，200KB 截断）
3. 操作：复制内容、在 Finder 中显示
4. 文件缺失：预览区显示错误；列表项标记「缺失」；Finder 仍可打开父目录 / workspace

## Backend

新 IPC：`reveal_workspace_artifact(agent_id, relative_path) -> RevealArtifactResult`

- 路径校验与 `read_workspace_file` 相同（相对路径、禁止 `..`、限制在 agent workspace）
- 文件存在 → `open -R <file>`
- 否则回退到最近存在的父目录，再不行打开 workspace 根

## Files

- `src-tauri/src/commands/tasks.rs`
- `src-tauri/src/lib.rs`
- `src/lib/api/tasks.ts`
- `src/ui/tasks/center.ts`
- `src/ui/app-shell.html`
- `src/styles.css`
