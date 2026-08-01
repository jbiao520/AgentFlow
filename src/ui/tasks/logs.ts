/**
 * Task center log stream: filter tabs + append lines from events / history.
 */
import type { TaskLog } from "../../lib/api/tasks";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function levelClass(level: string): string {
  switch (level) {
    case "error":
      return "log-warn";
    case "warn":
      return "log-warn";
    case "info":
      return "log-ok";
    default:
      return "log-exec";
  }
}

function streamPrefix(message: string): { kind: string | null; body: string } {
  const m = message.match(/^\[(agent|think|tool|status)\]\s([\s\S]*)$/);
  if (!m) return { kind: null, body: message };
  return { kind: m[1], body: m[2] };
}

function streamTagClass(kind: string): { tag: string; cls: string } {
  switch (kind) {
    case "agent":
      return { tag: "[AGENT]", cls: "log-agent-out" };
    case "think":
      return { tag: "[THINK]", cls: "log-think" };
    case "tool":
      return { tag: "[TOOL]", cls: "log-exec" };
    case "status":
      return { tag: "[STATUS]", cls: "log-status" };
    default:
      return { tag: "[INFO]", cls: "log-ok" };
  }
}

function shortTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts.slice(11, 19) || ts;
  }
}

/** Strip leading "→ " so merged tool lines stay compact. */
function toolMergePiece(body: string): string {
  return body.replace(/^→\s*/, "").trim();
}

export function renderLogTabs(
  agents: string[],
  active: string,
  onFilter: (filter: string) => void,
): void {
  const tabs = document.getElementById("task-log-tabs");
  if (!tabs) return;
  const names = ["all", ...agents];
  tabs.innerHTML = names
    .map((name) => {
      const label = name === "all" ? "All" : name;
      const cls = name === active ? "term-tab active" : "term-tab";
      return `<span class="${cls}" data-filter="${escapeHtml(name)}">${escapeHtml(label)}</span>`;
    })
    .join("");
  tabs.querySelectorAll("[data-filter]").forEach((el) => {
    el.addEventListener("click", () => {
      const f = (el as HTMLElement).getAttribute("data-filter") || "all";
      onFilter(f);
    });
  });
}

export function clearLogBody(): void {
  const body = document.getElementById("live-terminal-body");
  if (body) {
    body.innerHTML =
      '<div class="log-line"><span class="log-time">System</span> Logs cleared.</div>';
  }
}

export function appendLogLine(log: TaskLog, filter: string): void {
  const body = document.getElementById("live-terminal-body");
  if (!body) return;
  const agent = log.agent_name || "system";
  const { kind, body: msgBody } = streamPrefix(log.message);

  // Coalesce streaming agent/think deltas onto the last matching line.
  if (kind === "agent" || kind === "think") {
    const last = body.lastElementChild as HTMLElement | null;
    if (
      last?.getAttribute("data-stream") === kind &&
      last.getAttribute("data-agent") === agent
    ) {
      const textEl = last.querySelector(".log-text");
      if (textEl) {
        textEl.textContent = (textEl.textContent || "") + msgBody;
        body.scrollTop = body.scrollHeight;
        return;
      }
    }
  }

  // Merge adjacent tool calls into one line: → Read a · Grep foo · Shell ls
  if (kind === "tool") {
    const last = body.lastElementChild as HTMLElement | null;
    if (
      last?.getAttribute("data-stream") === "tool" &&
      last.getAttribute("data-agent") === agent
    ) {
      const textEl = last.querySelector(".log-text");
      if (textEl) {
        const piece = toolMergePiece(msgBody);
        if (piece) {
          const prev = textEl.textContent || "";
          textEl.textContent = prev ? `${prev} · ${piece}` : `→ ${piece}`;
        }
        body.scrollTop = body.scrollHeight;
        return;
      }
    }
  }

  const line = document.createElement("div");
  line.className = "log-line";
  line.setAttribute("data-agent", agent);
  if (kind) line.setAttribute("data-stream", kind);

  if (kind) {
    const { tag, cls } = streamTagClass(kind);
    line.innerHTML = `<span class="log-time">${escapeHtml(shortTime(log.ts))}</span><span class="log-agent">[${escapeHtml(agent)}]</span><span class="${cls}">${tag}</span> <span class="log-text">${escapeHtml(msgBody)}</span>`;
  } else {
    // Rejections / stderr land here as warn-level plain messages — keep selectable.
    line.innerHTML = `<span class="log-time">${escapeHtml(shortTime(log.ts))}</span><span class="log-agent">[${escapeHtml(agent)}]</span><span class="${levelClass(log.level)}">[${escapeHtml(log.level.toUpperCase())}]</span> <span class="log-text">${escapeHtml(log.message)}</span>`;
  }

  if (filter !== "all" && agent !== filter) {
    line.style.display = "none";
  }
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
}

export function renderLogHistory(logs: TaskLog[], filter: string): void {
  const body = document.getElementById("live-terminal-body");
  if (!body) return;
  if (logs.length === 0) {
    body.innerHTML =
      '<div class="log-line"><span class="log-time">System</span> No logs yet.</div>';
    return;
  }
  body.innerHTML = "";
  for (const log of logs) {
    appendLogLine(log, filter);
  }
}

export function applyLogFilter(filter: string): void {
  document.querySelectorAll("#live-terminal-body .log-line").forEach((line) => {
    const el = line as HTMLElement;
    if (filter === "all") {
      el.style.display = "block";
      return;
    }
    el.style.display =
      el.getAttribute("data-agent") === filter ? "block" : "none";
  });
}

export function getVisibleLogText(): string {
  const body = document.getElementById("live-terminal-body");
  return body?.innerText || "";
}
