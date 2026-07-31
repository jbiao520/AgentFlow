# AgentMind

Personal AI agent brain & execution system for macOS (Tauri 2 + Vite + TypeScript).

## Prerequisites

- macOS with [Xcode Command Line Tools](https://developer.apple.com/xcode/)
- [Node.js](https://nodejs.org/) 20+ and npm
- [Rust](https://rustup.rs/) (stable)

## Develop

```bash
npm install
npm run tauri dev
```

Frontend-only preview (no native IPC):

```bash
npm run dev
```

## Build

```bash
npm run build          # Vite web bundle
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri build    # macOS .app (slower)
```

## Docs

- Product brief: `.planning/BRIEF.md`
- Spec: `.planning/SPEC.md`
- Roadmap: `.planning/ROADMAP.md`
- UI prototype reference: `ai-agent-platform.html`
