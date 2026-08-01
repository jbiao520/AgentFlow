# Orchestrate Clarification Q&A — Design

Date: 2026-08-01  
Status: validated  
Scope: 调度中枢 — 拆解后按模糊度向用户提问，提交后直接执行

## Goal

After Orchestrate produces a Plan, optionally ask the user **0–6** clarifying questions (based on goal fuzziness). Answers are **single-select (2–4 options) + optional note**. On submit: merge answers into the Plan and **Dispatch + Start** immediately (no second orchestrate).

When `questions` is empty, keep today’s flow: Plan preview →「确认并分发」.

## Flow

```
Goal → Orchestrate → PlanJSON{ intent, subtasks, questions[0..6] }
  ├─ questions.length === 0 → Plan preview →「确认并分发」→ dispatch + start
  └─ questions.length > 0  → Q&A panel →「提交并执行」
                              → confirm_plan_answers → merge → dispatch → start
```

## Data shape

Extend `PlanAnalysis` (backward compatible; fields optional):

```json
{
  "intent": { "summary": "...", "tags": ["..."] },
  "subtasks": [ /* existing */ ],
  "questions": [
    {
      "id": "q1",
      "prompt": "目标平台是？",
      "options": ["Web", "iOS", "Android", "全平台"]
    }
  ],
  "clarifications": [
    {
      "question_id": "q1",
      "option": "Web",
      "note": "优先桌面端"
    }
  ]
}
```

### Question rules (validate on orchestrate)

- Default missing `questions` → `[]`
- Cap at **6**; truncate extras with warning
- Per question: non-empty unique `id`; non-empty `prompt`; `options` length **2–4**, trimmed non-empty
- Invalid questions dropped with warning (plan still succeeds)

### Answer rules (validate on confirm)

- Every question must have an answer
- `option` must be in that question’s `options`
- `note` optional, truncate to 500 chars

### Merge behavior

1. Write `clarifications` into `analysis_json`
2. Append a shared「用户澄清」block to **every** `subtask.prompt`
3. Clear or keep `questions` for audit (keep for audit; UI treats presence of unanswered questions as needing Q&A — after confirm, clear `questions` so re-open doesn’t re-prompt)
4. Persist via `update_plan` / overwrite `plans.analysis_json`
5. `validate_plan` + `preflight_for_dispatch` → `dispatch_plan` → `start_run`

## IPC

| Command | Args | Result |
|---------|------|--------|
| `orchestrate` / `orchestrate_from_json` | (existing) | Plan may include `questions` |
| `confirm_plan_answers` | `{ plan_id, answers: [{ question_id, option, note? }] }` | `DispatchResult` (same as dispatch) after merge + start |

「提交并执行」calls `confirm_plan_answers` only (backend starts the run).  
「确认并分发」(0 questions) keeps existing `dispatchPlan` + `startRun`.

## UI

- Insert clarification panel above Plan preview when `questions.length > 0`
- Hide「确认并分发」; show「提交并执行」
- Each question: radio group + optional textarea
- Submit disabled until every question has a selection; button loading while in flight
- On success: navigate to 任务中心 (same as today)

## Orchestrator prompt

Instruct the model:

- If goal is clear → `"questions": []`
- If ambiguous → up to 6 single-choice questions that unblock planning decisions
- Always still produce full `intent` + `subtasks` (best-effort plan; clarifications refine prompts at confirm time)

## Files

- `src-tauri/src/services/orchestrate.rs` — types, validate questions, merge, prompt
- `src-tauri/src/repo/tasks.rs` — `update_plan_analysis`
- `src-tauri/src/commands/orchestrate.rs` or `tasks.rs` — `confirm_plan_answers`
- `src-tauri/src/lib.rs` — register
- `src/lib/api/orchestrate.ts` — types + API
- `src/ui/orchestrator/workbench.ts` — Q&A UI + submit
- `src/ui/app-shell.html` / `styles.css` — markup/styles as needed
- Fixtures: add questions sample for tests

## Out of scope

- Re-orchestrate after answers
- Multi-select questions
- Editing Plan subtasks in UI
- Persisting draft Q&A across app restarts beyond `analysis_json`
