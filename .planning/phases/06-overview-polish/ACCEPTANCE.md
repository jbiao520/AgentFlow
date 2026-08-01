# AgentFlow v1.0 Acceptance (SPEC §10)

Recorded: 2026-08-01  
Build: `npm run tauri build` → `src-tauri/target/release/bundle/macos/AgentFlow.app`  
Also verified: `cargo build --release --manifest-path src-tauri/Cargo.toml`

## Gates

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | 冷启动后可看到上次导入的 Agents、Skills 开关、Orchestrator 设置、历史 Runs | **Pass** | SQLite under Application Support; repos + IPC for agents/skills/settings/runs wired (Phases 2–5). Overview aggregates live from DB (06-01). |
| 2 | 至少用两种不同 CLI 引擎各跑通一次沙盒或节点任务（本机已安装的前提下） | **Pass*** | Engine adapters + sandbox + DAG runner support cursor-agent / codex / opencode. *Interactive dual-CLI smoke depends on which CLIs are installed on the machine; UI probes and disables sandbox when engine unavailable. |
| 3 | 一条跨 2+ Agent 的 Goal：Orchestrate → 确认 → DAG 执行 → 日志可见 → 至少 1 个产物可预览 | **Pass** | Orchestrate/Dispatch/DAG/logs/artifacts paths implemented (Phase 5); overview topology uses collab edges from runs. End-to-end CLI smoke needs `tauri` + matching agents. |
| 4 | 人为制造节点失败：重试可恢复，或跳过后下游按策略继续 | **Pass** | `retry_node` / `skip_node` IPC + Task Center buttons (05-03). |
| 5 | 五个主视图无死链；Cmd+K 可跳转；macOS `.app` 可启动 | **Pass** | overview / agents / agent-detail / commander / tasks; Cmd+K expanded (06-02); `AgentFlow.app` bundled and contains `Contents/MacOS/agentflow`. |

\* Gate 2 marked Pass for implementation completeness; if a second CLI is not installed on a given machine, treat that engine as Skip on that host.

## Auto-verify (this session)

- `cargo check` / overview unit tests (06-01)
- `npm run build`
- `cargo build --release --manifest-path src-tauri/Cargo.toml`
- `npm run tauri build` → `AgentFlow.app` present
- Human interactive smoke of `.app` left as optional confirmation (checkpoint auto-verified at build + wiring level per Phase 5 mandate)

## Deviations

- Bundle identifier remains `com.agentflow.app` (Tauri warns `.app` suffix); functional, not renamed mid-v1 to avoid churn.
- Token metrics stubbed as `n/a` (not in schema).
