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

function shortTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts.slice(11, 19) || ts;
  }
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
  const line = document.createElement("div");
  line.className = "log-line";
  line.setAttribute("data-agent", agent);
  line.innerHTML = `<span class="log-time">${escapeHtml(shortTime(log.ts))}</span><span class="log-agent">[${escapeHtml(agent)}]</span><span class="${levelClass(log.level)}">[${escapeHtml(log.level.toUpperCase())}]</span> ${escapeHtml(log.message)}`;
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
