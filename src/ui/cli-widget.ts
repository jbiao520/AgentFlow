import {
  listCliEngineStatus,
  probeCliEngines,
  type EngineStatus,
} from "../lib/api/cli";

const ENGINE_ORDER = ["cursor-agent", "codex", "opencode"] as const;

const ENGINE_LABELS: Record<string, string> = {
  "cursor-agent": "cursor",
  codex: "codex",
  opencode: "opencode",
};

let probing = false;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Always render the three engines in fixed order. */
function normalizeStatuses(statuses: EngineStatus[]): EngineStatus[] {
  const byEngine = new Map(statuses.map((s) => [s.engine, s]));
  return ENGINE_ORDER.map(
    (engine) =>
      byEngine.get(engine) ?? {
        engine,
        available: false,
        version: null,
        last_checked_at: null,
      },
  );
}

function renderStatuses(statuses: EngineStatus[], loading = false): void {
  const listEl = document.getElementById("cli-engine-list");
  const widget = document.querySelector(".cli-engine-widget");
  if (!listEl) return;

  widget?.classList.toggle("is-probing", loading);

  listEl.innerHTML = normalizeStatuses(statuses)
    .map((s) => {
      const label = ENGINE_LABELS[s.engine] ?? s.engine;
      let dotClass = "status-dot offline";
      if (loading) dotClass = "status-dot working";
      else if (s.available) dotClass = "status-dot";
      const tip = loading
        ? "probing…"
        : s.available
          ? s.version
            ? `${label} · ${s.version}`
            : label
          : `${label} · unavailable`;
      return `<div class="cli-item" data-engine="${escapeHtml(s.engine)}" title="${escapeHtml(tip)}">
          <div class="cli-name"><div class="${dotClass}"></div>${escapeHtml(label)}</div>
        </div>`;
    })
    .join("");
}

export async function refreshCliWidget(forceProbe = false): Promise<void> {
  if (forceProbe && probing) return;
  const listEl = document.getElementById("cli-engine-list");
  if (!listEl) return;

  if (forceProbe) {
    probing = true;
    // Keep current labels; pulse dots so click is visibly doing work.
    const current = Array.from(listEl.querySelectorAll(".cli-item")).map(
      (el) =>
        ({
          engine: el.getAttribute("data-engine") || "",
          available: !el.querySelector(".status-dot.offline"),
          version: null,
          last_checked_at: null,
        }) satisfies EngineStatus,
    );
    renderStatuses(current.length ? current : [], true);
  }

  try {
    const statuses = forceProbe
      ? await probeCliEngines()
      : await listCliEngineStatus();
    renderStatuses(statuses, false);
    void import("./agents/sandbox").then((m) => m.refreshSandboxAvailability());
  } catch (err) {
    console.warn("CLI widget refresh failed", err);
    renderStatuses([], false);
  } finally {
    probing = false;
  }
}

export function initCliWidget(): void {
  const widget = document.querySelector(".cli-engine-widget");
  widget?.addEventListener("click", () => {
    void refreshCliWidget(true);
  });
  // Initial paint: three offline rows, then probe.
  renderStatuses([], true);
  void refreshCliWidget(true);
}
