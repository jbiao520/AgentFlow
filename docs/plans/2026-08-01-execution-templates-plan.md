# Execution Templates — Implementation Plan

Date: 2026-08-01  
Design: @docs/plans/2026-08-01-execution-templates-design.md  
Status: executing

## Objective

Ship parameterized Plan templates: save from Task Center / Commander with AI polish, manage in sidebar「模版库」, instantiate with variables (direct dispatch or preview).

## Plan batches

### Batch 1 — Persistence & pure logic
1. Schema v2: `templates` table + migrate bump + test
2. `repo/templates.rs` CRUD
3. `services/template_vars.rs`: substitute, validate keys, collect placeholders, structure-lock merge
4. Unit tests for vars + merge

### Batch 2 — Backend IPC
5. `services/template_polish.rs`: build polish prompt, parse JSON, structure-lock
6. `commands/templates.rs`: list/get/polish/create/update/duplicate/delete/instantiate
7. Wire `lib.rs` + modules; `instantiate` → orchestrate_from_json path + optional dispatch/start
8. TS `src/lib/api/templates.ts`

### Batch 3 — UI shell
9. Sidebar nav + `view-templates` pane + router ViewId
10. Template library list/detail/run form (`src/ui/templates/*`)
11. Save wizard modal; entries on Task Center + Commander
12. Nav count + main.ts init; minimal CSS

### Batch 4 — Verify
13. `cargo test` relevant + `tsc` / frontend build
14. Fix failures

## Success criteria

- [x] Can create template from plan snapshot (skip-polish path works without CLI)
- [x] Can list/update prompts/duplicate/delete
- [x] Instantiate with vars creates goal+plan; dispatch=true starts run
- [x] Sidebar「模版库」works; save buttons on tasks + commander
- [x] Structure lock rejects DAG edits from polish/update

Status: implemented (2026-08-01)