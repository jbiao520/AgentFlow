# Execution Templates — Design

Date: 2026-08-01  
Status: validated (option 1: parameterized Plan snapshot)  
Scope: 从已执行 Goal/Plan 保存可复用模版；侧栏「模版库」管理与快速执行

## Goal

把已跑过的调度（目标提示词 + Plan/DAG）保存为模版。保存时用 AI 抽取变量并润色文案；用户确认后落库。下次只需填 topic / id 等变量即可反复执行。DAG 结构（子任务 id、依赖、Agent、skills）锁定；prompt 与变量可编辑。

## Decisions

| 议题 | 选择 |
|------|------|
| 快照单位 | Goal prompt + 完整 Plan（`analysis_json`） |
| 保存入口 | 任务中心 + 调度中枢 |
| AI 润色 | 抽变量 + 润色文案；不改 DAG |
| 执行 | 默认一键直跑；可选手动预览 |
| 导航 | 侧栏独立「模版库」 |
| 管理 | 列表 / 执行 / 预览 / 复制 / 删除 / 重命名；可改 prompt 与变量，不可改 DAG |

## Approach

**参数化 Plan 快照。** 存带 `{{var}}` 的 `goal_prompt` + `plan_json` + `variables_json`。执行时字符串替换 → `orchestrateFromJson` → 可选 `dispatchPlan` / `startRun`。复用现有编排与派发 IPC，不引入第二套执行引擎。

## Data model

```text
templates
  id                TEXT PK
  name              TEXT NOT NULL
  description       TEXT
  source_goal_id    TEXT NULL
  source_plan_id    TEXT NULL
  source_run_id     TEXT NULL      -- 从任务中心保存时填写
  goal_prompt       TEXT NOT NULL  -- 含 {{var}}
  plan_json         TEXT NOT NULL  -- 参数化 analysis_json
  variables_json    TEXT NOT NULL  -- [{key,label,required,default?}]
  created_at        TEXT NOT NULL
  updated_at        TEXT NOT NULL
```

**变量约定**

- 占位符：`{{snake_case}}`，key 匹配 `^[a-z][a-z0-9_]*$`
- 允许出现在：`goal_prompt`、`subtasks[].prompt`、必要时 `intent.summary`
- **禁止**改写：`subtasks[].id`、`depends_on`、`agent`、`skills`、子任务数量

执行实例化时，新建 Goal 可回写 `template_key = template.id`，便于追溯。与旧的未使用 `goals.template_key` 字段兼容，不另建关联表。

## Lifecycle

```text
Save:
  Task Run | Commander Plan
    → load goal + plan
    → polish_template (AI, optional skip)
    → user confirms name / desc / variables / prompts
    → create_template

Manage:
  list / detail / rename / edit prompts+variables / duplicate / delete
  DAG fields read-only in UI

Run:
  fill variables
    → instantiate_template (replace placeholders)
    → orchestrateFromJson
    → dispatch+start (default) | stop at Commander (preview)
```

## Save & polish UX

**Entries**

- Task Center: selected run →「保存为模版」（`goal_id` / `plan_id` / `run_id`）
- Commander: current Plan present →「保存为模版」（dispatch 前后均可）

**Wizard (3 steps)**

1. **Polishing** — Call orchestrator CLI settings via a dedicated polish prompt. Output JSON: `name`, `description`, `variables[]`, `goal_prompt`, `plan_json`. On failure: retry or「跳过润色」(raw text, empty variables; user adds vars manually).
2. **Confirm** — Editable: name, description, variables, goal prompt, per-subtask prompts. Read-only: DAG (titles, depends_on, agent, skills). Highlight undeclared `{{...}}` and unused declared vars.
3. **Save** — Persist; toast; optional navigate to template library.

**Server-side structure lock:** If polish JSON changes DAG topology or routing, discard those fields and keep the source plan structure; only accept prompt / intent.summary / variable metadata.

## Template library & run UX

**Nav:** New sidebar item `templates`（模版库）below 任务中心, with count badge. Extend `ViewId`, `nav.ts`, `app-shell.html`, `router.ts`. Cmd+K: open library only in v1 (no direct run from palette).

**Library page**

- List: name, description snippet, variable count, source, `updated_at`
- Row actions: 执行 / 预览 / 复制 / 删除； row click → detail
- Detail: variables; editable goal + subtask prompts; read-only DAG
- Empty state: point users to Task Center / Commander save actions

**Execute**

1. Variable form (label, required, defaults)
2. Replace all `{{var}}` → `orchestrateFromJson`; set `template_key`
3. Default: `dispatchPlan` + `startRun` → Task Center
4. Preview: create Goal+Plan only → Commander for manual Dispatch
5. Missing agents: block direct run; suggest preview or fix agents

Commander hardcoded chips remain for now; library is the formal source. Wiring chips to DB templates is out of v1.

## IPC

| Command | Role |
|---------|------|
| `list_templates` | List |
| `get_template` | Detail |
| `polish_template` | AI polish; no persist |
| `create_template` | Persist after confirm |
| `update_template` | name/desc/variables/prompts only; reject DAG edits |
| `duplicate_template` | Copy as「名称 (副本)」 |
| `delete_template` | Delete |
| `instantiate_template` | Substitute → `orchestrateFromJson`; `dispatch: bool` |

Reuse: plan validation, `orchestrate_from_json`, `dispatch_plan`, `start_run`, orchestrator CLI runner for polish.

## Error handling

| Case | Behavior |
|------|----------|
| Polish timeout / bad JSON / DAG mutated | Fail with retry or skip; server ignores structure mutations |
| Missing required var / unknown `{{var}}` | `instantiate` rejects |
| Agent/skill missing | Block direct run; preview may create Plan; Dispatch uses existing validation |
| Source goal/plan deleted | Snapshot on template still works |
| Duplicate names | Allowed; list sorted by `updated_at` |

## Testing (v1)

- Unit: placeholder substitution; key validation; structure-lock merge of polish output
- Integration: create → instantiate(dispatch) yields new goal/plan/run; update touches prompts only
- UI (manual/light): save entries, wizard confirm, library run vs preview navigation

## Files

**New**

- `src-tauri/src/repo/templates.rs`
- `src-tauri/src/services/template_polish.rs`
- `src-tauri/src/commands/templates.rs`
- `src/lib/api/templates.ts`
- `src/ui/templates/` (list, detail, save wizard, run form)

**Touch**

- Schema / migration
- `src-tauri/src/lib.rs`, `services/mod.rs`, `repo` module exports
- `src/ui/app-shell.html`, `router.ts`, `nav.ts`, `nav-counts.ts`
- `src/ui/tasks/center.ts`, `src/ui/orchestrator/workbench.ts`
- Optional: `cmdk.ts` open-library action

## Out of scope (v1)

- Editing DAG topology in the template editor
- Cmd+K one-shot execute
- Replacing Commander demo chips with DB templates
- Sharing / import-export of templates
- Scheduled / cron runs from templates
