# Roadmap: AgentMind

## Overview

从 HTML 原型落地为 macOS Tauri App：先搭壳与持久化，再接通 Agent/Skill 与 CLI 运行时，随后实现可配置调度中枢与 DAG 任务闭环，最后补齐总览拓扑与打包打磨，达到「原型 5 页全可用 + SQLite 可重启」的 v1.0。

## Phases

- [ ] **Phase 1: Foundation** - Tauri 工程、原型迁入、路由与 IPC 骨架
- [ ] **Phase 2: Persistence** - SQLite 模型、迁移与 Repository
- [ ] **Phase 3: Agent & Skill** - 导入工作区、Skill 扫描、矩阵/详情接真数据
- [ ] **Phase 4: CLI Runtime** - 三引擎适配、沙盒执行、日志流
- [ ] **Phase 5: Orchestrator** - 独立编排配置、Plan/Dispatch、DAG 执行与重试
- [ ] **Phase 6: Overview & Polish** - 总览聚合、拓扑、Cmd+K、macOS 打包验收

## Phase Details

### Phase 1: Foundation
**Goal**: 可 `tauri dev` 打开对齐原型的壳，页面可切换，前后端 IPC 打通 hello-path  
**Depends on**: Nothing  
**Plans**: 3

Plans:
- [x] 01-01: 初始化 Tauri 2 + vanilla-ts，迁入原型样式与五视图结构 — `.planning/phases/01-foundation/01-01-PLAN.md`
- [x] 01-02: 类型化视图路由 + Cmd+K/导入/Skill 弹窗 — `.planning/phases/01-foundation/01-02-PLAN.md`
- [ ] 01-03: Tauri commands（ping / app_info / reveal_in_finder）+ 前端 API 层 — `.planning/phases/01-foundation/01-03-PLAN.md`

### Phase 2: Persistence
**Goal**: Agent / Skill / Orchestrator / Task 相关表可读写，App 重启数据仍在  
**Depends on**: Phase 1  
**Plans**: TBD（建议 2–3）

Plans:
- [ ] 02-01: 按 SPEC 落 SQLite schema 与迁移
- [ ] 02-02: 实现 agents / skills / orchestrator_settings repository + IPC
- [ ] 02-03: 实现 goals / plans / task_runs / nodes / logs 基础读写（尚不执行）

### Phase 3: Agent & Skill
**Goal**: 导入 Workspace、扫描 `.agent/skills/`、矩阵与详情页全部接 SQLite  
**Depends on**: Phase 2  
**Plans**: TBD（建议 3）

Plans:
- [ ] 03-01: Agent 导入（本地路径；Git URL clone 到选定目录）与列表筛选
- [ ] 03-02: Skill 扫描/同步/启用开关/预览
- [ ] 03-03: Agent 详情模型配置表单持久化（含自动路由与引擎选项 JSON）

### Phase 4: CLI Runtime
**Goal**: 本机探测三引擎；单 Agent 沙盒可真实跑 CLI 并流式日志  
**Depends on**: Phase 3  
**Plans**: TBD（建议 3）

Plans:
- [ ] 04-01: CliProbe + 侧栏引擎状态
- [ ] 04-02: EngineAdapter 抽象与 cursor-agent / codex / opencode 最小可运行封装
- [ ] 04-03: 沙盒运行 + 日志事件推送到前端终端组件

### Phase 5: Orchestrator
**Goal**: 可配置编排引擎完成 Orchestrate→确认→DAG 执行→重试/跳过→产物预览  
**Depends on**: Phase 4  
**Plans**: TBD（建议 3）

Plans:
- [ ] 05-01: Orchestrator settings UI + 结构化 Plan 调用/校验
- [ ] 05-02: Dispatch 创建 Run/Nodes，DAG Runner 按依赖执行
- [ ] 05-03: 任务中心：历史、日志过滤、产物、失败重试与人工跳过

### Phase 6: Overview & Polish
**Goal**: 总览真实指标与拓扑；Cmd+K；打出可启动的 macOS `.app` 并过发布门禁  
**Depends on**: Phase 5  
**Plans**: TBD（建议 2–3）

Plans:
- [ ] 06-01: 总览统计聚合 + 协同/任务拓扑
- [ ] 06-02: Cmd+K 与交互打磨（空态、错误态、权限提示）
- [ ] 06-03: `tauri build`、验收清单（见 SPEC §10）收口

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/3 | In progress | - |
| 2. Persistence | 0/? | Not started | - |
| 3. Agent & Skill | 0/? | Not started | - |
| 4. CLI Runtime | 0/? | Not started | - |
| 5. Orchestrator | 0/? | Not started | - |
| 6. Overview & Polish | 0/? | Not started | - |

## References

- Brief: `.planning/BRIEF.md`
- Spec: `.planning/SPEC.md`
- Prototype: `ai-agent-platform.html`
