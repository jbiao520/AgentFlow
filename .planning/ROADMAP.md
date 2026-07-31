# Roadmap: AgentMind

## Overview

从 HTML 原型落地为 macOS Tauri App：先搭壳与持久化，再接通 Agent/Skill 与 CLI 运行时，随后实现可配置调度中枢与 DAG 任务闭环，最后补齐总览拓扑与打包打磨，达到「原型 5 页全可用 + SQLite 可重启」的 v1.0。

**Planning status:** 全部 6 个 Phase、共 **18** 份可执行 `PLAN.md` 已就绪（Phase 1 完成 2/3 执行）。

## Phases

- [ ] **Phase 1: Foundation** - Tauri 工程、原型迁入、路由与 IPC 骨架 *(executing)*
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
- [x] 01-01: 初始化 Tauri 2 + vanilla-ts，迁入原型 — [01-01-PLAN.md](phases/01-foundation/01-01-PLAN.md)
- [x] 01-02: 类型化路由 + Cmd+K/导入/Skill 弹窗 — [01-02-PLAN.md](phases/01-foundation/01-02-PLAN.md)
- [ ] 01-03: IPC `ping` / `app_info` / `reveal_in_finder` — [01-03-PLAN.md](phases/01-foundation/01-03-PLAN.md)

### Phase 2: Persistence
**Goal**: Agent / Skill / Orchestrator / Task 相关表可读写，App 重启数据仍在  
**Depends on**: Phase 1  
**Plans**: 3

Plans:
- [ ] 02-01: SQLite schema + migration + Db state — [02-01-PLAN.md](phases/02-persistence/02-01-PLAN.md)
- [ ] 02-02: Agents/Skills/Settings repos + IPC — [02-02-PLAN.md](phases/02-persistence/02-02-PLAN.md)
- [ ] 02-03: Goals/Plans/Runs/Nodes/Logs repos + IPC — [02-03-PLAN.md](phases/02-persistence/02-03-PLAN.md)

### Phase 3: Agent & Skill
**Goal**: 导入 Workspace、扫描 `.agent/skills/`、矩阵与详情页全部接 SQLite  
**Depends on**: Phase 2  
**Plans**: 3

Plans:
- [ ] 03-01: Agent 导入（本地/Git）+ 矩阵 UI — [03-01-PLAN.md](phases/03-agent-skill/03-01-PLAN.md)
- [ ] 03-02: Skill 扫描/同步/开关/预览 — [03-02-PLAN.md](phases/03-agent-skill/03-02-PLAN.md)
- [ ] 03-03: Agent 详情模型配置持久化 — [03-03-PLAN.md](phases/03-agent-skill/03-03-PLAN.md)

### Phase 4: CLI Runtime
**Goal**: 本机探测三引擎；单 Agent 沙盒可真实跑 CLI 并流式日志  
**Depends on**: Phase 3  
**Plans**: 3

Plans:
- [ ] 04-01: CliProbe + 侧栏引擎状态 — [04-01-PLAN.md](phases/04-cli-runtime/04-01-PLAN.md)
- [ ] 04-02: EngineAdapter + CLI_FLAGS 调研 — [04-02-PLAN.md](phases/04-cli-runtime/04-02-PLAN.md)
- [ ] 04-03: 沙盒运行 + 日志事件流 — [04-03-PLAN.md](phases/04-cli-runtime/04-03-PLAN.md)

### Phase 5: Orchestrator
**Goal**: 可配置编排引擎完成 Orchestrate→确认→DAG 执行→重试/跳过→产物预览  
**Depends on**: Phase 4  
**Plans**: 3

Plans:
- [ ] 05-01: Orchestrator 设置 + Plan 生成/校验 — [05-01-PLAN.md](phases/05-orchestrator/05-01-PLAN.md)
- [ ] 05-02: Dispatch + DAG Runner — [05-02-PLAN.md](phases/05-orchestrator/05-02-PLAN.md)
- [ ] 05-03: 任务中心 UI + 重试/跳过 — [05-03-PLAN.md](phases/05-orchestrator/05-03-PLAN.md)

### Phase 6: Overview & Polish
**Goal**: 总览真实指标与拓扑；Cmd+K；打出可启动的 macOS `.app` 并过发布门禁  
**Depends on**: Phase 5  
**Plans**: 3

Plans:
- [ ] 06-01: 总览统计聚合 + 拓扑 — [06-01-PLAN.md](phases/06-overview-polish/06-01-PLAN.md)
- [ ] 06-02: Cmd+K 增强 + 空态/错误态 — [06-02-PLAN.md](phases/06-overview-polish/06-02-PLAN.md)
- [ ] 06-03: `tauri build` + SPEC §10 验收 — [06-03-PLAN.md](phases/06-overview-polish/06-03-PLAN.md)

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/3 | In progress | - |
| 2. Persistence | 0/3 | Not started | - |
| 3. Agent & Skill | 0/3 | Not started | - |
| 4. CLI Runtime | 0/3 | Not started | - |
| 5. Orchestrator | 0/3 | Not started | - |
| 6. Overview & Polish | 0/3 | Not started | - |

## Execution order

```text
01-03 → 02-01 → 02-02 → 02-03 → 03-01 → 03-02 → 03-03
      → 04-01 → 04-02 → 04-03 → 05-01 → 05-02 → 05-03
      → 06-01 → 06-02 → 06-03 (v1.0)
```

## References

- Brief: `.planning/BRIEF.md`
- Spec: `.planning/SPEC.md`
- Prototype: `ai-agent-platform.html`
