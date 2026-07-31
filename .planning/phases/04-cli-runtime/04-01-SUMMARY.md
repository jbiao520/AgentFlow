# Phase 4 Plan 01: CliProbe + Sidebar Widget Summary

**CliProbe resolves cursor-agent/codex/opencode via PATH + common install paths, caches status in SQLite, and drives a live sidebar `n/3 Active` widget.**

## Accomplishments
- `probe_cli_engines` / `list_cli_engine_status` IPC with persistence in `cli_engine_status`
- Probe never fails app startup — missing CLIs marked unavailable
- Sidebar widget renders real dots/versions + manual refresh (↻)

## Files Created/Modified
- `src-tauri/src/services/cli_probe.rs` — binary resolve + `--version` with timeout
- `src-tauri/src/repo/cli_status.rs` — upsert/list for `cli_engine_status`
- `src-tauri/src/commands/cli.rs` — Tauri commands
- `src-tauri/src/lib.rs`, `commands/mod.rs`, `repo/mod.rs`, `services/mod.rs` — wiring
- `src/lib/api/cli.ts` — frontend IPC wrappers
- `src/ui/cli-widget.ts` — render + probe on load / refresh
- `src/ui/app-shell.html`, `src/styles.css`, `src/main.ts`, `src/lib/tauri.ts`, `src/ui/app-info.ts` — live widget binding

## Decisions Made
- Version probe uses `--version` for all three engines (matches CLI_FLAGS.md)
- Fallback paths include Homebrew, `~/.local/bin`, `~/.opencode/bin`, `~/.cargo/bin`
- Empty cache on `list_cli_engine_status` triggers one probe so first paint is useful

## Deviations from Plan
None - plan executed as written

## Issues Encountered
None

## Verification (auto-verified)
- `cargo check` — pass (dead_code warning on `resolve_engine_binary` reserved for 04-02)
- `cargo test` — 16 passed (incl. `probe_returns_three_entries`, `upsert_and_list_cli_status`)
- `npm run build` — pass

## Next Phase Readiness
- CliProbe ready for EngineAdapter (04-02)
- Sandbox still mock — 04-03

---
*Phase: 04-cli-runtime*
*Plan: 04-01*
*Completed: 2026-07-31*
