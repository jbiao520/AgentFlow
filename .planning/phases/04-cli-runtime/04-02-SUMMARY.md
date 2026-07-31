# Phase 4 Plan 02: EngineAdapter + Process Runner Summary

**Unified `EngineRunRequest` + three CLI adapters (cursor-agent/codex/opencode) spawn with CLI_FLAGS.md argv, stream stdout/stderr lines, kill-on-drop/cancel, and reject non-imported workspace cwds.**

## Accomplishments
- Confirmed CLI_FLAGS.md as adapter source of truth (minor amend note)
- `prepare` builders for each engine from researched non-interactive templates
- Shared `run_engine` with line streaming, CancelToken, KillOnDrop
- Security: `validate_imported_workspace` canonicalizes cwd against `agents.workspace_path`

## Files Created/Modified
- `src-tauri/src/engines/mod.rs` — module root
- `src-tauri/src/engines/adapter.rs` — request/log types + dispatch
- `src-tauri/src/engines/cursor_agent.rs` — `--print --trust --workspace`
- `src-tauri/src/engines/codex.rs` — `exec -C --skip-git-repo-check`
- `src-tauri/src/engines/opencode.rs` — `run --dir [--variant]`
- `src-tauri/src/engines/runner.rs` — spawn/stream/validate
- `src-tauri/src/lib.rs` — `mod engines`
- `.planning/phases/04-cli-runtime/CLI_FLAGS.md` — confirm adapters bind to this doc

## Decisions Made
- No tokio dep: std threads + mpsc for line streaming (fits current Cargo.toml)
- Cursor effort embedded in `--model '…[effort=…]'`; OpenCode uses `--variant`; Codex `-c model_reasoning_effort` marked UNVERIFIED per CLI_FLAGS
- Dead-code warnings until 04-03 wires `sandbox_run` (expected)

## Deviations from Plan
None - plan executed as written (Task 1 confirmed existing CLI_FLAGS.md rather than re-research)

## Issues Encountered
None

## Verification (auto-verified)
- `cargo check` — pass
- `cargo test` — 21 passed, 1 ignored (integration placeholder)
- `npm run build` — pass

## Next Phase Readiness
- Ready to wire sandbox UI streaming (04-03)

---
*Phase: 04-cli-runtime*
*Plan: 04-02*
*Completed: 2026-07-31*
