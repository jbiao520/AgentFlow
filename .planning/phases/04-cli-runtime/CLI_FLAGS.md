# Phase 4 — CLI flags research (AgentFlow adapters)

Captured on: 2026-07-31 (darwin arm64)  
Working directory for research: `/Users/jianguo/IdeaProjects/AgentFlow`  
Scope: non-interactive / scripted argv useful for prompt, model, reasoning/effort, and cwd.

**Adapter source of truth (confirmed 2026-07-31):** Engine adapters under `src-tauri/src/engines/` implement the Recommended templates below. Re-run `--help` only if a binary major-version bumps; amend this file before changing argv.

---

## Summary

| Engine | Binary found | Version | Non-interactive entry |
|--------|--------------|---------|------------------------|
| Cursor Agent | `cursor-agent` → `/Users/jianguo/.local/bin/cursor-agent` | `2026.07.23-e383d2b` | `cursor-agent --print …` |
| Codex | `codex` → `/opt/homebrew/bin/codex` | `codex-cli 0.145.0` | `codex exec …` |
| OpenCode | `opencode` → `/Users/jianguo/.opencode/bin/opencode` | `1.18.7` | `opencode run …` |

All three CLIs were present on this machine.

---

## 1. Cursor Agent (`cursor-agent`)

### Identity

- **Binary name:** `cursor-agent` (help banner also says `Usage: agent …`)
- **Version:** `2026.07.23-e383d2b` (`cursor-agent --version` / `-v`)
- **Path:** `/Users/jianguo/.local/bin/cursor-agent`

### Useful argv (from `--help`)

| Concern | Flag / form | Notes |
|---------|-------------|--------|
| Prompt / message | positional `[prompt...]` | Initial prompt for the agent |
| Non-interactive | `-p, --print` | Print to console for scripts; full tool access |
| Output format | `--output-format <text\|json\|stream-json>` | Only with `--print` (default `text`) |
| Partial stream | `--stream-partial-output` | With `--print` + `stream-json` |
| Model | `--model <model>` | e.g. `gpt-5`, `sonnet-4-thinking` |
| Reasoning / effort | embedded in `--model` | Parameterized models: `'claude-opus-4-8[context=1m,effort=high,fast=false]'` — no separate `--effort` flag |
| Working directory | `--workspace <path-or-name>` | Defaults to current cwd; also `--add-dir`, `-w/--worktree` |
| Trust / automation | `--trust`, `-f/--force` / `--yolo`, `--sandbox enabled\|disabled` | Reduce prompts for automation |
| Auth | `--api-key` / `CURSOR_API_KEY`, `-e/--endpoint` | |

### Recommended non-interactive template

```bash
cursor-agent --print \
  --output-format text \
  --trust \
  --force \
  --workspace "<CWD>" \
  --model "<MODEL>" \
  "<PROMPT>"
```

With effort (AgentFlow stores base model + effort separately; adapter recomposes suffix):

```bash
cursor-agent --print \
  --trust \
  --force \
  --workspace "<CWD>" \
  --model 'claude-opus-4-8-high' \
  "<PROMPT>"
```

Parameterized bracket overrides remain valid if a full id already embeds options, but AgentFlow's adapter prefers the **suffix** form `{base}-{effort}` to match `cursor-agent models` ids.
Sandbox / DAG streaming (adapters decode JSONL → `[AGENT]` / `[THINK]` terminal lines):

```bash
cursor-agent --print \
  --output-format stream-json \
  --stream-partial-output \
  --trust \
  --force \
  --workspace "<CWD>" \
  --model "<MODEL>" \
  "<PROMPT>"
```

Orchestrate keeps `--output-format text` so the final Plan blob stays parseable.

### Notes

- Verified on this machine.
- `--trust` only skips the workspace trust prompt. Shell/tool approval still needs `--force` (`--yolo` alias) or commands are rejected in non-interactive `--print` runs.
- No standalone `--reasoning` / `--effort` flag; AgentFlow recomposes `--model {base}-{effort}` from catalog suffixes (`low|medium|high|xhigh|max`). Bracket overrides (`model[effort=…]`) are still accepted by the CLI but not used by the adapter.
- `--mode plan|ask` and `--plan` are read-oriented modes, not the primary “run agent” path for write-capable automation.

---

## 2. Codex (`codex`)

### Identity

- **Binary name:** `codex`
- **Version:** `codex-cli 0.145.0` (`codex --version` / `-V`)
- **Path:** `/opt/homebrew/bin/codex`

### Useful argv (top-level + `codex exec --help`)

| Concern | Flag / form | Notes |
|---------|-------------|--------|
| Non-interactive | `codex exec` (alias `e`) | Prefer over bare `codex` (interactive TUI) |
| Prompt / message | positional `[PROMPT]` or stdin | `-` reads stdin; piped stdin appended as `<stdin>` if prompt also given |
| Model | `-m, --model <MODEL>` | Also `-c model="…"` |
| Reasoning / effort | **no dedicated flag in help** | Use `-c` config overrides if project config supports reasoning fields (UNVERIFIED beyond CLI surface) |
| Working directory | `-C, --cd <DIR>` | Agent working root |
| Extra writable dirs | `--add-dir <DIR>` | Repeatable |
| Sandbox / approvals | `-s/--sandbox`, `-a/--ask-for-approval`, `--dangerously-bypass-approvals-and-sandbox` | Automation may need `never` + sandbox policy |
| Machine output | `--json` | JSONL events on stdout |
| Last message file | `-o, --output-last-message <FILE>` | |
| Outside git | `--skip-git-repo-check` | |
| Ephemeral | `--ephemeral` | No session persistence |

### Recommended non-interactive template

```bash
codex exec \
  -C "<CWD>" \
  -m "<MODEL>" \
  --skip-git-repo-check \
  --json \
  -o "<LAST_MESSAGE_FILE>" \
  "<PROMPT>"
```

Automation-friendly (full permissions; non-interactive):

```bash
codex exec \
  -C "<CWD>" \
  -m "<MODEL>" \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  --json \
  "<PROMPT>"
```

Config override example (model / nested keys):

```bash
codex exec -C "<CWD>" -c model="<MODEL>" "<PROMPT>"
```

### Notes

- Verified on this machine (codex-cli 0.145.0).
- Use **`codex exec`**, not interactive `codex [PROMPT]`, for Phase 4 adapters.
- Adapter uses `--dangerously-bypass-approvals-and-sandbox` so shell/tool calls are not blocked in headless runs. AgentFlow already constrains cwd to the imported agent workspace.
- Sandbox / DAG runs pass `--json` and decode JSONL into live `[AGENT]` / `[STATUS]` terminal lines.
- No `--effort` / `--reasoning` in `codex exec --help`; document any reasoning settings as config (`-c …`) once confirmed against `~/.codex/config.toml` schema — mark adapter wiring **UNVERIFIED** until validated.

---

## 3. OpenCode (`opencode`)

### Identity

- **Binary name:** `opencode`
- **Version:** `1.18.7` (`opencode --version` / `-v`)
- **Path:** `/Users/jianguo/.opencode/bin/opencode`

### Useful argv (`opencode run --help`)

| Concern | Flag / form | Notes |
|---------|-------------|--------|
| Non-interactive | `opencode run [message..]` | Dedicated run subcommand |
| Prompt / message | positional `message` array; also top-level `--prompt` on default TUI | Prefer positional on `run` |
| Model | `-m, --model` | Format: `provider/model` |
| Reasoning / effort | `--variant <string>` | “model variant (provider-specific reasoning effort, e.g., high, max, minimal)” |
| Thinking UI | `--thinking` | Show thinking blocks |
| Working directory | `--dir <directory>` | Also positional `project` on default TUI command |
| Output | `--format default\|json` | `json` = raw JSON events |
| Automation | `--auto` | Auto-approve permissions not explicitly denied (dangerous) |
| Attachments | `-f, --file` | |
| Session | `-c/--continue`, `-s/--session`, `--fork` | |

### Recommended non-interactive template

```bash
opencode run \
  --dir "<CWD>" \
  -m "<provider>/<model>" \
  --variant "<effort>" \
  --format json \
  --auto \
  "<PROMPT>"
```

Minimal:

```bash
opencode run --dir "<CWD>" -m "<provider>/<model>" "<PROMPT>"
```

### Notes

- Verified on this machine.
- `--auto` auto-approves permissions not explicitly denied — required for headless shell/file writes.
- `--variant` is the clearest first-class effort/reasoning knob among the three CLIs.
- Default `opencode [project]` starts TUI; adapters should always use **`opencode run`**.

---

## Cross-engine argv mapping (adapter sketch)

| AgentFlow concept | Cursor Agent | Codex | OpenCode |
|-------------------|--------------|-------|----------|
| Prompt | positional args | `exec` positional / stdin | `run` positional `message..` |
| Model | `--model` | `-m` / `-c model=` | `-m provider/model` |
| Effort / reasoning | `--model '…-{effort}'` (suffix; see §1) | config `-c` (UNVERIFIED) | `--variant` |
| CWD | `--workspace` | `-C` / `--cd` | `--dir` |
| Non-interactive | `--print` | `exec` | `run` |
| Structured stream | `--output-format stream-json` | `--json` | `--format json` |
| Auto-approve tools | `--force` (+ `--trust`) | `--dangerously-bypass-approvals-and-sandbox` | `--auto` |

---

## Missing CLI placeholder policy

If a binary is absent on a target machine, adapters should fail with a clear “CLI not found” error and may keep an **UNVERIFIED** placeholder argv shaped like:

```text
UNVERIFIED: <binary> <noninteractive-subcommand?> --model <MODEL> --cwd|--workspace|--dir <CWD> <PROMPT>
```

On this research host, **no placeholders were required** — all three binaries were available and help output was captured live.
