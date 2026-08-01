# AgentFlow

Personal AI agent orchestration & scheduling for macOS (Tauri 2 + Vite + TypeScript).

## Prerequisites

- macOS with [Xcode Command Line Tools](https://developer.apple.com/xcode/)
- [Node.js](https://nodejs.org/) 20+ and npm
- [Rust](https://rustup.rs/) (stable)

## Develop

```bash
source "$HOME/.cargo/env"
npm install
npm run tauri dev
```

Frontend-only preview (no native IPC):

```bash
npm run dev
```

## Build

```bash
source "$HOME/.cargo/env"
npm run build          # Vite web bundle
cargo check --manifest-path src-tauri/Cargo.toml
cargo build --release --manifest-path src-tauri/Cargo.toml   # Rust release binary
npm run tauri build    # macOS .app + DMG (runs frontend build first)
```

### Release artifact

After a successful `npm run tauri build`:

| Artifact | Path |
|----------|------|
| App bundle | `src-tauri/target/release/bundle/macos/AgentFlow.app` |
| DMG (if built) | `src-tauri/target/release/bundle/dmg/` |

Launch:

```bash
open src-tauri/target/release/bundle/macos/AgentFlow.app
```

Capabilities (`src-tauri/capabilities/default.json`) stay minimal: `core:default` + `opener:default`. Workspace FS and CLI process spawn run in the Rust backend (not via Tauri shell/fs plugins).

## Docs

- Product brief: `.planning/BRIEF.md`
- Spec: `.planning/SPEC.md`
- Roadmap: `.planning/ROADMAP.md`
- Acceptance (v1.0): `.planning/phases/06-overview-polish/ACCEPTANCE.md`
- UI prototype reference: `ai-agent-platform.html`
