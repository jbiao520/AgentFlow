# Milestones

## v1.0 — 2026-08-01

**Ship:** Personal macOS AgentMind app — five live views, SQLite persistence, CLI sandbox/DAG orchestration, overview topology, Cmd+K polish, release `.app`.

### What landed
- Foundation through Orchestrator (Phases 1–5)
- Overview live stats / topology / queue (06-01)
- Cmd+K + empty/error UX (06-02)
- Production `tauri build` + SPEC §10 acceptance record (06-03)

### Artifacts
- App: `src-tauri/target/release/bundle/macos/AgentMind.app`
- Acceptance: [ACCEPTANCE.md](phases/06-overview-polish/ACCEPTANCE.md)

### Out of scope (post-v1)
See SPEC §11 — cron/webhooks, complex queues, cloud sync, Windows/Linux, visual DAG editor.
