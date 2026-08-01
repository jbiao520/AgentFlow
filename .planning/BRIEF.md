# AgentFlow

**One-liner**: 个人 Mac 上的 AI Agent 管理与调度平台——把多个「Repo + Skill + CLI」Agent 编排成可执行的个人 AI 大脑。

## Problem

个人自动化能力散落在多个仓库、多种 CLI（Cursor Agent / Codex / OpenCode）和临时脚本里，缺少统一的 Agent 注册、模型配置、任务拆解与执行可见性。需要一个本地 App，把「目标输入 → 选 Agent/Skill/模型 → 在对应 Repo 执行 → 看进度/日志/产物」串成闭环。

## Success Criteria

- [ ] 可导入本地/远程工作区为 Agent，并扫描 `.agent/skills/` 得到可开关的 Skill 列表
- [ ] 可为每个 Agent 配置 CLI 引擎、Preferred Model、Reasoning Effort，并支持按任务自动路由
- [ ] 调度中枢使用**独立可配置**的编排引擎/模型，完成意图分析、子任务拆解与路由矩阵，确认后分发执行
- [ ] 任务中心展示 DAG、实时日志、产物预览，支持失败重试与人工跳过；数据经 SQLite 重启后仍在
- [ ] 原型 5 页（总览 / Agent 矩阵 / Agent 详情 / 调度中枢 / 任务中心）均可真实使用，并可打成 macOS App

## Constraints

- 技术栈：Tauri 2 + Web UI（基于 `ai-agent-platform.html` 演进）
- 执行：仅通过本地 CLI 调用 `cursor-agent` / `codex` / `opencode`
- 数据：本地 SQLite；单机单用户；不依赖云端账号体系
- UI：对齐现有原型信息架构与 macOS Light 视觉语言

## Out of Scope

- 多用户协作、云同步、团队权限
- 自建 LLM 推理服务（不封装模型 API，只编排已安装 CLI）
- Windows / Linux 发行（v1 仅 macOS）
- Agent Marketplace、远程托管执行
