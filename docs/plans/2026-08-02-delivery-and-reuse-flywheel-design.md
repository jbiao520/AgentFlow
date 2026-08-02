# Delivery + Reuse Flywheel — Design

Date: 2026-08-02  
Status: implementing (S1–S7 planned + code landed 2026-08-02)  
Scope: **交付结果心智** + **成功 → 模版 → 定时飞轮**（不含首次成功向导）

## Goal

把 AgentFlow 从「能编排、能看日志的控制台」推到：

1. **交付优先**：用户默认看到「这次得到了什么 / 是否可信」，而不是日志与 DAG 细节  
2. **复用默认**：一次成功后，保存模版与设定时成为自然下一步，而不是侧栏里的隐藏能力

一句话：`跑完有结果 → 一键沉淀 → 自动再跑`。

## Non-goals

- 首次成功 / 冷启动向导（明确不做）
- 可视化拖拽改 DAG
- 云同步、分享模版、Marketplace
- 复杂 cron 表达式（继续用 once | interval）
- 推送通知系统（本版仅 App 内醒目提示；系统通知可后置）

## Current baseline（已有）

| 能力 | 现状 | 缺口 |
|------|------|------|
| 任务中心「验收交付物」 | 摘要 / diff / 验证 / 风险 / 产物预览 | 完成瞬间不突出；无「下一步」CTA；仍偏附属面板 |
| Dispatch 前 | 子任务列表 + 路由表 + 并发选择 | 缺「将执行什么」的人话风险摘要 |
| 保存为模版 | 任务中心 + 调度中枢入口 + 润色向导 | 成功完成后入口弱，需用户自己找按钮 |
| 定时任务 | 绑模版 + once/interval + ticker | 与「刚保存的模版」无衔接；失败反馈弱 |
| 总览 | 指标 / 队列 / 最近 Agent | 偏系统健康，少「最近交付 / 下次定时 / 复用入口」 |

本设计 **复用** 现有 delivery report、template save wizard、schedules IPC，以 UX 串联与少量增强为主，不重做执行引擎。

---

## Product principles

1. **结果 > 过程**：默认态展示交付；过程（DAG/日志）可展开，不抢主视觉  
2. **确认即知情同意**：Dispatch 前用 5 行内说明成本与风险，不堆配置  
3. **成功即资产**：success 是飞轮点火点；partial/failed 不硬推定时  
4. **少跳转、强时机**：CTA 出现在用户刚获得价值的那一屏，而不是侧栏深处  
5. **Yagni**：不新开「交付页」路由；在任务中心完成态强化即可

---

## Part A — 交付结果心智

### A1. 任务完成态：交付优先布局

**触发**

- Run 状态进入 `success` | `failed` | `cancelled`（终态）
- 用户从调度中枢 Dispatch 后跳进任务中心时，若 run 仍在跑：保持现有实时视图；**一进入终态**切换交付优先

**布局规则（任务中心右侧主栏）**

```
终态时（自上而下）:
  [1] 交付结论条（固定可见）
  [2] 验收交付物（默认展开；产物区优先）
  [3] 复用飞轮 CTA 条（见 Part B）
  [4] DAG（默认折叠为单行摘要，可展开）
  [5] 日志终端（默认折叠高度 / 或保持但降视觉权重）

运行中:
  保持现状：DAG 可见 + 日志流为主；交付区显示「执行中…」
```

**交付结论条（新增 UI 块，轻量）**

| 元素 | 内容 |
|------|------|
| 状态 pill | 成功 / 部分成功 / 失败 / 已取消 |
| 一句话结论 | 优先 `delivery_report.summary`；无则 `plan.intent.summary` 或 goal 截断 |
| 元信息 | 节点成功数/总数 · 耗时 · 来源（手动 / 模版 / 定时） |
| 次要操作 | 再跑一次 · 在列表中定位（已有则复用） |

**部分成功定义**

- 至少一个节点 `success` 且至少一个 `failed|skipped` → 状态「部分成功」  
- CTA：允许「保存为模版」（带警告：结构含失败路径）；**不允许**一键「设为定时」（需用户先修或确认风险）

### A2. Dispatch 前「可执行摘要」

在调度中枢 Plan Ready 区域、主按钮「确认并分发任务」**上方**增加 `orch-exec-summary` 卡片（问答流「提交并执行」前同样展示）。

**摘要字段（全部由已有 Plan + Agent 目录派生，无需新 LLM 调用）**

```text
将执行 N 个子任务 · 涉及 M 个 Agent · 引擎: cursor-agent, codex …
模型: …（去重列表，最多展示 3 个 +「等」）
跨仓库: 是/否（agent workspace 是否 >1）
并发: 当前选择值
风险提示（条件渲染，最多 3 条）:
  - 含 High reasoning 节点 xK
  - 依赖链最长 L 步
  - 部分 Skill 已禁用 / Agent 缺失（若校验警告已有则复用）
```

**交互**

- 摘要默认展开；不阻断 Dispatch  
- 路由表保留，可折叠为「查看路由明细」  
- 不新增确认弹窗（避免二次确认疲劳）；摘要即知情同意层

### A3. 总览：从系统健康到「我的自动化」

在现有总览指标条下方或替换次要卡片，增加 **自动化动态** 区（3 列或列表均可）：

| 区块 | 数据源 | 点击行为 |
|------|--------|----------|
| 最近交付 | 最近 5 条终态 run（summary + status + 时间） | 打开任务中心并选中该 run |
| 即将运行 | 最近 5 条 enabled schedule（name + next_run_at） | 打开定时任务详情 |
| 可复用 | 最近更新的 5 个模版 | 打开模版库 / 执行表单 |

**指标微调（可选，低优先级）**

- 保留：运行中、今日完成、Agent 数  
- 弱化/下移：纯拓扑装饰若无协作边  
- 增加：今日定时触发次数、连续失败 schedule 数（>0 时红色）

**失败静默治理（定时相关，总览露出）**

- `last_error` 非空的 schedule 在「即将运行」旁显示错误角标  
- 连续失败阈值（见 B3）触发后总览显示「N 个定时已暂停」

---

## Part B — 成功 → 模版 → 定时飞轮

### B1. 成功时机 CTA（核心）

在交付结论条下方增加 **复用条** `run-reuse-bar`：

| Run 状态 | 主 CTA | 次 CTA | 说明 |
|----------|--------|--------|------|
| success | **保存为模版** | 再跑一次 | 主路径点火 |
| success 且已从该 run 存过模版 | **设为定时** | 打开模版 | 避免重复存；见 B2 |
| partial | 保存为模版（次要样式） | 重试失败节点 | 不推定时 |
| failed / cancelled | 重试 / 再编排 | — | 不推飞轮 |

**文案示例（success）**

```text
这次跑通了。保存为模版后，下次只填变量即可复用；也可以设为定时自动跑。
[ 保存为模版 ]  [ 设为定时 ]  [ 再跑一次 ]
```

- 「设为定时」在尚未有关联模版时：先走保存向导，保存成功后 **无缝** 打开「从模版创建定时」表单（预填 template_id + 上次变量若有）  
- 已有关联模版时：直接打开创建定时表单

### B2. Run ↔ Template 关联（小数据）

为支持「是否已保存」「设为定时预填」，增加轻量关联（二选一，推荐 A）：

**A. 推荐 — 在 template 已有 `source_run_id` 上查询**

- `list_templates` / 本地过滤：`source_run_id === currentRunId`  
- 若命中：复用条显示「已保存：{name}」+ 主 CTA 改为「设为定时」  
- 无需 migration

**B. 备选 — run 上记 `saved_template_id`**

- 仅当 A 查询成本高或一对多混乱时再做

**一对多**：同一 run 允许多个模版；复用条取 `updated_at` 最新一条作为「关联模版」。

### B3. 保存向导出口衔接定时

扩展现有 template save wizard **最后一步成功态**：

```text
✓ 已保存「每周依赖巡检」
[ 设为定时 ]  [ 执行一次 ]  [ 查看模版库 ]
```

- **设为定时**：关闭向导 → 打开 schedule 创建 UI（预填 template_id；variables 用向导确认后的 defaults 或空表单）  
- **执行一次**：等同模版库「执行」直跑  
- **查看模版库**：`showView('templates')` + 选中该模版

不在向导内嵌完整 schedule 表单（避免 wizard 变重）；只做一跳预填。

### B4. 「设为定时」最小表单

复用 schedules 页创建逻辑，支持 **模态或侧滑** 快路径（从复用条 / 向导出口进入）：

| 字段 | 规则 |
|------|------|
| 名称 | 默认 `{template.name} 定时` |
| 模版 | 只读展示（已预填） |
| 变量 | 与模版执行表单相同；必填校验 |
| 模式 | once \| interval（与现网一致） |
| once | `run_at` 日期时间 |
| interval | 起点 + interval（沿用现有 interval_secs / 日频 UI） |
| 启用 | 默认 on |

提交：`create_schedule` → toast → 可选 `showView('schedules')`。

### B5. 定时可靠与失败可见（飞轮后半段）

不新增通知渠道，做 **App 内最小可靠集**：

| 规则 | 行为 |
|------|------|
| 单次失败 | 写 `last_error`；schedule 详情与列表显示错误；总览角标 |
| 连续失败 ≥ 3（可配置常量） | `enabled=0`；`last_error` 附「已自动暂停」；总览「N 个定时已暂停」 |
| 手动 `run_schedule_now` 成功 | 清零连续失败计数（若有字段）或仅更新 last_run |
| 任务中心来源 | run 带 `schedule_id`（已有）时，列表/结论条显示「定时 · {name}」 |

连续失败计数：若 schema 无字段，用 `run_count` 窗口不便；**建议** schedules 表增加 `consecutive_failures INTEGER DEFAULT 0`（小 migration）。无 migration 的临时方案：不自动暂停，仅总览展示 `last_error`（降级）。

### B6. 再跑一次

- **有 template_key / 关联模版**：打开变量表单（预填上次 values 若从 schedule 来）  
- **无模版**：用同一 plan 快照 `orchestrateFromJson` + dispatch（或复制 goal 回调度中枢）  
- 优先实现「有模版」路径；无模版路径可 v1.1.1 再补

---

## End-to-end flows

### Flow 1 — 交付优先（手动 Goal）

```text
Goal → Orchestrate → [可执行摘要] → Dispatch
  → 任务中心（运行中：DAG+日志）
  → 终态：交付结论 + 产物 + 复用条
  → 用户阅读产物 / Finder / 复制
```

### Flow 2 — 飞轮闭环

```text
success
  → [保存为模版] → wizard → 保存成功
  → [设为定时] → 快路径表单 → schedule enabled
  → ticker 触发 → 新 run（带 schedule_id）
  → 终态交付；失败则 last_error / 连续失败暂停
  → 总览「最近交付 / 即将运行」可回跳
```

### Flow 3 — 已有模版用户

```text
模版库执行 / 定时触发
  → 同交付优先终态
  → 复用条主 CTA 为「设为定时」或「再跑一次」（已存过则不再强调保存）
```

---

## Data & IPC

### 已有（复用）

- `task_runs.delivery_report_json`, `schedule_id`  
- templates：`source_run_id`, `create_template`, `polish_template`, `instantiate_template`  
- schedules：`create_schedule`, `list_schedules`, `set_schedule_enabled`, `run_schedule_now`  
- overview：stats / queue / recent agents  

### 新增 / 小改（建议）

| 项 | 说明 |
|----|------|
| Overview API | `list_recent_deliveries(limit)`；`list_upcoming_schedules(limit)`；`list_recent_templates(limit)` 或前端拼现有 list |
| schedules.consecutive_failures | 可选 migration；ticker 失败 +1，成功归零；≥3 自动 disable |
| UI 状态 | `run-reuse-bar`；`orch-exec-summary`；任务中心终态折叠 DAG/日志 |
| save-wizard 成功步 | 三个出口按钮（定时 / 执行 / 库） |
| schedule 快路径 | `openCreateScheduleModal({ templateId, values? })` 供复用条与向导调用 |

**尽量不改 Plan JSON schema**；可执行摘要纯前端聚合。

---

## UI 文案与状态（中文）

| 场景 | 文案 |
|------|------|
| 执行摘要标题 | 即将执行 |
| 成功结论 | 已完成交付 |
| 部分成功 | 部分完成，请查看失败节点 |
| 失败 | 未完成，可重试或跳过节点 |
| 复用条 success | 这次跑通了。保存为模版，或设为定时自动跑。 |
| 已保存模版 | 已保存为「{name}」。可设为定时，或再跑一次。 |
| 自动暂停 | 连续失败 3 次，已暂停定时「{name}」 |

---

## Implementation slices（便于拆 PR）

| Slice | 内容 | 验收 |
|-------|------|------|
| **S1 可执行摘要** | 调度中枢 Plan Ready 增加摘要卡 | Orchestrate 后可见 N/M/引擎/风险；Dispatch 仍可用 |
| **S2 终态交付优先** | 任务中心终态重排 + 结论条 | success 后首屏是结论+产物，非日志 |
| **S3 复用条** | success CTA → 现有 save wizard | 一点即开向导；source_run_id 回填 |
| **S4 向导出口** | 保存成功 → 设为定时 / 执行 / 库 | 定时预填 template_id |
| **S5 定时快路径** | 模态创建 schedule | 从复用条不进 schedules 页也能建 |
| **S6 总览自动化动态** | 最近交付 / 即将运行 / 可复用 | 点击能跳到对应实体 |
| **S7 失败可见** | consecutive_failures + 暂停 + 总览角标 | 故意失败 3 次后 enabled=0 |

建议落地顺序：**S1 → S2 → S3 → S4 → S5 → S6 → S7**（先信任与交付，再飞轮，再静默治理）。

---

## Testing

- **单元**：exec summary 聚合（agent 去重、跨仓库判断、风险条上限 3）；连续失败计数与自动暂停  
- **集成**：success run → create template(source_run_id) → create schedule → ticker/run_now → run.schedule_id 有值  
- **UI 手工**：  
  1. Dispatch 前看见摘要  
  2. 跑通后首屏交付 + 保存模版  
  3. 向导成功点「设为定时」预填正确  
  4. 总览三块可跳转  
  5. 定时连续失败后暂停并在总览可见  

---

## Success metrics（产品）

| 指标 | 定义 | 目标（上线后观察） |
|------|------|-------------------|
| 交付可见率 | 终态 run 中用户展开/停留交付区占比 | 高于改版前日志区停留 |
| 模版转化 | success run → 24h 内创建 template | 飞轮主指标 |
| 定时转化 | 新 template → 7d 内创建 schedule | 复利指标 |
| 定时成功率 | schedule 触发 run 的 success 率 | 下降时看自动暂停是否生效 |

本地单机无分析后台时：可先打结构化 log / 或 SQLite 计数面板（非必须本版）。

---

## Files（预计触达）

**前端**

- `src/ui/orchestrator/workbench.ts` — 可执行摘要  
- `src/ui/tasks/center.ts` — 终态布局、结论条、复用条  
- `src/ui/templates/save-wizard.ts` — 成功出口  
- `src/ui/schedules/page.ts`（或新 `create-modal.ts`）— 快路径创建  
- `src/ui/overview/page.ts` — 自动化动态  
- `src/ui/app-shell.html` / `src/styles.css` — 结构与样式  
- `src/lib/api/overview.ts` / `schedules.ts` — 按需  

**后端（S6/S7 时）**

- overview 聚合 command（若前端 list 不够）  
- `schedules` repo + ticker：`consecutive_failures`  
- migration SQL  

---

## Open decisions

| # | 议题 | 推荐 |
|---|------|------|
| 1 | 终态是否自动折叠日志 | **是**，保留一键展开；运行中不折 |
| 2 | 无 delivery_report 时结论条 | 用 intent.summary + 节点状态计数兜底 |
| 3 | 自动暂停阈值 | **3**；常量放 settings 非必须 |
| 4 | 部分成功能否定时 | **不能**一键；保存模版可以 |

---

## Summary

| 部分 | 用户价值 | 关键交付物 |
|------|----------|------------|
| A 交付心智 | 跑完知道得到了什么、敢点 Dispatch | 可执行摘要 + 终态结论/产物优先 |
| B 复用飞轮 | 成功一次变资产，定时替我跑 | 成功 CTA → 模版向导出口 → 定时快路径 + 失败可见 |

与现有模版/定时/交付报告 **叠加而非重做**；按 S1–S7 切片即可独立 PR 推进。
