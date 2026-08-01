/**
 * Settings → CLI engines: probe status list + refresh.
 * Replaces the old sidebar CLI widget.
 */
import {
  listCliEngineStatus,
  probeCliEngines,
  type EngineStatus,
} from "../../lib/api/cli";

const ENGINE_ORDER = ["cursor-agent", "codex", "opencode"] as const;

const ENGINE_LABELS: Record<string, string> = {
  "cursor-agent": "Cursor Agent",
  codex: "Codex",
  opencode: "OpenCode",
};

let probing = false;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

function formatCheckedAt(iso: string | null): string {
  if (!iso) return "尚未探测";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function renderStatuses(statuses: EngineStatus[], loading = false): void {
  const listEl = document.getElementById("cli-engine-list");
  if (!listEl) return;

  listEl.classList.toggle("is-probing", loading);

  listEl.innerHTML = normalizeStatuses(statuses)
    .map((s) => {
      const label = ENGINE_LABELS[s.engine] ?? s.engine;
      let statusClass = "settings-cli-status offline";
      let statusText = "不可用";
      if (loading) {
        statusClass = "settings-cli-status probing";
        statusText = "探测中…";
      } else if (s.available) {
        statusClass = "settings-cli-status online";
        statusText = "可用";
      }
      const version = s.version ? escapeHtml(s.version) : "—";
      const checked = escapeHtml(formatCheckedAt(s.last_checked_at));
      return `<div class="settings-cli-row" data-engine="${escapeHtml(s.engine)}">
        <div class="settings-cli-row-main">
          <div class="settings-cli-name">
            <span class="status-dot ${loading ? "working" : s.available ? "" : "offline"}"></span>
            <span>${escapeHtml(label)}</span>
            <code class="settings-cli-engine-id">${escapeHtml(s.engine)}</code>
          </div>
          <span class="${statusClass}">${statusText}</span>
        </div>
        <div class="settings-cli-meta">
          <span>版本 <strong>${version}</strong></span>
          <span>最近探测 <strong>${checked}</strong></span>
        </div>
      </div>`;
    })
    .join("");
}

/** Probe or list CLI engines; used by settings page and ⌘K. */
export async function refreshCliWidget(forceProbe = false): Promise<void> {
  if (forceProbe && probing) return;
  const listEl = document.getElementById("cli-engine-list");
  if (!listEl) return;

  if (forceProbe) {
    probing = true;
    const current = Array.from(listEl.querySelectorAll(".settings-cli-row")).map(
      (el) =>
        ({
          engine: el.getAttribute("data-engine") || "",
          available: !!el.querySelector(".settings-cli-status.online"),
          version: null,
          last_checked_at: null,
        }) satisfies EngineStatus,
    );
    renderStatuses(current.length ? current : [], true);
  }

  const probeBtn = document.getElementById(
    "btn-probe-cli-engines",
  ) as HTMLButtonElement | null;
  if (probeBtn && forceProbe) {
    probeBtn.disabled = true;
    probeBtn.textContent = "探测中…";
  }

  try {
    const statuses = forceProbe
      ? await probeCliEngines()
      : await listCliEngineStatus();
    renderStatuses(statuses, false);
    void import("../agents/sandbox").then((m) => m.refreshSandboxAvailability());
  } catch (err) {
    console.warn("CLI status refresh failed", err);
    renderStatuses([], false);
  } finally {
    probing = false;
    if (probeBtn) {
      probeBtn.disabled = false;
      probeBtn.textContent = "重新探测";
    }
  }
}

export function initSettingsCli(): void {
  document
    .getElementById("btn-probe-cli-engines")
    ?.addEventListener("click", () => {
      void refreshCliWidget(true);
    });
  // Initial paint then probe once at app start so sandbox / catalogs stay warm.
  renderStatuses([], true);
  void refreshCliWidget(true);
}
