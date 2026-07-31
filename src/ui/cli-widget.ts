import {
  listCliEngineStatus,
  probeCliEngines,
  type EngineStatus,
} from "../lib/api/cli";

const ENGINE_LABELS: Record<string, string> = {
  "cursor-agent": "cursor-agent",
  codex: "codex",
  opencode: "opencode",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStatuses(statuses: EngineStatus[]): void {
  const activeEl = document.getElementById("cli-active-count");
  const listEl = document.getElementById("cli-engine-list");
  if (!activeEl || !listEl) return;

  const active = statuses.filter((s) => s.available).length;
  const total = Math.max(statuses.length, 3);
  activeEl.textContent = `${active}/${total} Active`;
  activeEl.style.color =
    active === total
      ? "var(--accent-emerald)"
      : active === 0
        ? "var(--accent-rose)"
        : "var(--accent-amber)";

  listEl.innerHTML = statuses
    .map((s) => {
      const label = ENGINE_LABELS[s.engine] ?? s.engine;
      const dotClass = s.available ? "status-dot" : "status-dot offline";
      const meta = s.available
        ? escapeHtml(s.version ?? "ok")
        : "unavailable";
      return `<div class="cli-item" data-engine="${escapeHtml(s.engine)}">
          <div class="cli-name"><div class="${dotClass}"></div>${escapeHtml(label)}</div>
          <span style="font-size:10px; color:var(--fg-muted); font-family:var(--font-mono);">${meta}</span>
        </div>`;
    })
    .join("");
}

export async function refreshCliWidget(forceProbe = false): Promise<void> {
  try {
    const statuses = forceProbe
      ? await probeCliEngines()
      : await listCliEngineStatus();
    renderStatuses(statuses);
  } catch (err) {
    console.warn("CLI widget refresh failed", err);
    const activeEl = document.getElementById("cli-active-count");
    if (activeEl) {
      activeEl.textContent = "?/3 Active";
      activeEl.style.color = "var(--accent-rose)";
    }
  }
}

export function initCliWidget(): void {
  const refreshBtn = document.getElementById("cli-refresh-btn");
  refreshBtn?.addEventListener("click", () => {
    void refreshCliWidget(true);
  });
  void refreshCliWidget(true);
}
