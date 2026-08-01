# Agent Artifact Handoff — Design

Date: 2026-08-01  
Status: validated (option A)  
Scope: DAG 运行时跨节点 / 跨 Agent 产物交接

## Goal

当子任务 B 依赖 A 时，B 总能在自己的 workspace 里读到 A 的真实产物，不再靠「同 workspace + prompt 猜路径」。

## Problem

`depends_on` 只保证执行顺序。产物传递是隐式的：

- 不同 Agent = 不同 workspace → B 看不到 A 的文件
- Plan 里的 `artifact_paths` 是预期路径，不校验是否写出
- 下游 prompt 不会注入上游产物列表

## Approach

运行时 handoff：A success 后，把存在的产物拷到 B 的 workspace，并注入 prompt。

```
A success
  → 读 A.artifact_paths_json
  → 在 A.workspace 校验存在
  → 拷到 B.workspace/.agentmind/handoff/<run_id>/<pred_local_id>/
  → 注入 Inputs 区块到 B prompt
  → 启动 B
```

## Handoff path layout

目标相对路径：

```
.agentmind/handoff/<run_id>/<pred_node_local_id>/<original_relative_path>
```

- 同 Agent / 跨 Agent 都走同一布局；源文件不删
- 同 run 重试时覆盖已有目标
- 路径规范化：拒绝 `..`；绝对路径若落在源 workspace 内则剥前缀，否则丢弃

## Prompt injection

有上游产物时追加：

```text
## Inputs from previous steps
These files were copied into your workspace. Read them before proceeding.
- From "<title>" (<local_id>):
  - .agentmind/handoff/<run_id>/<local_id>/notes.md

When you create output files, print one line per file:
AGENTMIND_ARTIFACT:relative/path/from/workspace/root
```

每个节点（无论有无依赖）prompt 末尾都附带 `AGENTMIND_ARTIFACT:` 说明。

## Orchestrator rules

在 `build_orchestrate_prompt` 中增加：

- 有 `depends_on` 的子任务不要假设上游 workspace 路径；运行时会拷到 `.agentmind/handoff/...`
- 上游 `artifact_paths` 必须是相对路径，且与该子任务实际写出的文件一致
- 允许跨 Agent 流水线

## Error handling

| 情况 | 行为 |
|------|------|
| 上游无 artifact / 全缺失 | 不注入 Inputs；info 日志；照常跑 B |
| 单个文件缺失 | 跳过；warn 日志 |
| 拷贝失败 | warn；不中断 B |
| A 成功收尾 | 仅 exit 0 写 `artifact_paths`；过滤不存在的路径 |
| marker 绝对路径 | 剥 workspace 前缀；剥不掉则丢弃 |

## Files

- `src-tauri/src/services/handoff.rs` (new)
- `src-tauri/src/services/dag_runner.rs`
- `src-tauri/src/services/orchestrate.rs`
- `src-tauri/src/services/mod.rs`

## Tests

- 路径规范化（相对 / 绝对 / `..`）
- 同 workspace 与跨 workspace 目标路径拼装
- Inputs prompt 区块拼装
- 不强制 live CLI e2e
