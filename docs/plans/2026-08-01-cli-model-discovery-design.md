# CLI Model Discovery — Design

Date: 2026-08-01  
Status: validated  
Scope: 调度中枢 + Agent 详情配置

## Goal

Replace hardcoded model `<select>` options and static Low/Medium/High reasoning pills with live catalogs from the local CLIs:

- `cursor-agent` (Cursor Agent)
- `codex`
- `opencode`

Users pick a **base model** + **reasoning effort**. The same discovery API powers both Orchestrator settings and Agent detail config.

## Approach

**Live probe + in-process memory cache (10 minutes).**

No SQLite catalog table. Optional later: explicit refresh button. Force refresh via IPC `refresh: true`.

## Architecture

### New backend service

`src-tauri/src/services/cli_models.rs`

```text
list_engine_models(engine, refresh?) -> EngineModelCatalog
```

| Engine | Command | Parse |
|--------|---------|-------|
| `codex` | `codex debug models` | `slug`, `supported_reasoning_levels[].effort`, `default_reasoning_level` |
| `opencode` | `opencode models --verbose` | `providerID/id` as model id; `variants` keys as efforts; empty variants → `efforts=[]` |
| `cursor-agent` | `cursor-agent models` | Split id suffixes into base + effort; merge rows by stem |

Binary resolution reuses `cli_probe::resolve_engine_binary`.

### Unified catalog shape

```rust
struct EngineModelCatalog {
  engine: String,
  models: Vec<EngineModel>,
  fetched_at: i64, // unix ms
}

struct EngineModel {
  id: String,              // base model id
  display_name: String,
  efforts: Vec<String>,    // ordered, may be empty
  default_effort: Option<String>,
}
```

TypeScript mirror in `src/lib/api/cli.ts` (or new `cli-models.ts`).

### Cache

- Key: `engine` string
- TTL: **10 minutes**
- Scope: process memory only
- `refresh: true` bypasses cache and replaces the entry

### IPC

- Command: `list_engine_models`
- Args: `{ engine: string, refresh?: boolean }`
- Registered in `lib.rs` alongside existing CLI commands

## Cursor Agent: split and recompose

### Split (`cursor-agent models` → catalog)

For each line `id - Display Name`:

1. Strip optional trailing `-fast` (ignore as a separate effort for v1).
2. Match effort suffix: `low` | `medium` | `high` | `xhigh` | `max` (longest match).
3. Remaining stem = base `id`; merge `efforts[]` across rows with the same stem.
4. No effort suffix (`auto`, `composer-2.5`, `gpt-5.2`, …) → `efforts=[]`.
5. `display_name`: prefer the non-fast row at effort `high`, else first seen display name for that stem.

Example: `gpt-5.6-sol-high`, `gpt-5.6-sol-xhigh`, `gpt-5.6-sol-high-fast` → `id=gpt-5.6-sol`, `efforts=["high","xhigh",…]`.

### Recompose (adapter at run time)

In `engines/cursor_agent.rs`: if `reasoning` is set and the model id does not already end with an effort suffix, pass `--model {base}-{effort}`.

Codex / OpenCode adapters unchanged: model flag + `model_reasoning_effort` / `--variant`.

### Persistence

Continue storing **base model id** + separate `reasoning_effort` in:

- `orchestrator_settings`
- `agent_model_profiles`

Legacy values that are full Cursor ids (e.g. `gpt-5.6-sol-high`) are split on load into base + effort.

When `efforts` is empty, persist `reasoning_effort` as `""`; adapters skip effort wiring.

## Error handling

| Case | UI behavior |
|------|-------------|
| CLI missing / non-zero exit | Toast; model select empty; keep saved value as a read-only option |
| Parse failure | Same; log stderr snippet |
| Loading | Model select disabled; placeholder “加载模型中…” |
| Saved model absent from catalog | Inject option labeled “(已保存，当前不可用)” |

## UI

Shared helper: `src/ui/cli-models.ts`

- `loadCatalog(engine, { refresh? })`
- `fillModelSelect(select, catalog, preferred)`
- `renderEffortPills(container, efforts, preferred)`

### 调度中枢

Elements: `#orch-cli-select`, `#orch-model-select`, `#orch-reasoning-pills`.

1. Init: load settings → fetch catalog for `cli_engine` → fill model + pills → select saved values.
2. CLI change: fetch catalog; if current model missing, pick first (or engine default); rebuild pills from `default_effort` or `medium` if present else first effort.
3. Model change: rebuild pills only (no CLI re-probe).
4. Save: existing `update_orchestrator_settings` with base `model` + `reasoning_effort`.

### Agent 详情

Same behavior for `#detail-cli-select`, `#detail-model-select`, `#detail-reasoning-pills`. On agent switch: apply profile, then fetch catalog for `default_cli`. Save via existing upsert paths.

### Other

- No refresh button in v1 (10-minute cache).
- Browser / non-Tauri mocks: small fake catalog so Vite preview does not fail.
- Agent matrix CLI filter list unchanged.

## Out of scope

- Grok `agent` (`~/.grok/bin/agent`) as a fourth engine
- Persisted SQLite model catalog
- Exposing Cursor `-fast` as a first-class UI toggle
- Changing DAG / sandbox invocation beyond Cursor model recompose

## Verification

1. With all three CLIs installed: switch CLI in 调度中枢 → model list matches live CLI output (base ids).
2. Select a Codex model with multiple reasoning levels → pills match `supported_reasoning_levels`.
3. Select an OpenCode model with `variants` → pills match variant keys; model with empty variants → pills hidden/disabled.
4. Cursor: select base `gpt-5.6-sol` + `high` → save → orchestrate/sandbox passes `--model gpt-5.6-sol-high` (or equivalent).
5. Missing CLI: toast + graceful empty/fallback option.
6. Agent detail: same flows; switching agents reloads catalog for that agent’s CLI.
7. Second open within 10 minutes does not re-spawn CLI (cache hit); after 10 minutes or `refresh: true`, re-probes.
