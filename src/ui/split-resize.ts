import { t } from "./i18n";

/**
 * Horizontal split resize for app sidebar and page-level left/right panels.
 * Persists widths in localStorage; disabled when layouts stack on narrow viewports.
 */

const STORAGE_PREFIX = "af-split:";

type SplitEdge = "right" | "left";

type SplitMode = "width" | "grid-left" | "grid-right";

type SplitConfig = {
  id: string;
  container: string;
  /** Panel that owns the handle. Defaults: first child (left) or last (right). */
  panel?: string;
  mode: SplitMode;
  edge: SplitEdge;
  min: number;
  max: number;
  defaultWidth: number;
  /** Match CSS breakpoints where the split stacks to a single column. */
  disableBelow?: number;
};

const SPLITS: SplitConfig[] = [
  {
    id: "app-sidebar",
    container: ".main-shell",
    panel: ".sidebar",
    mode: "width",
    edge: "right",
    min: 160,
    max: 420,
    defaultWidth: 220,
    disableBelow: 768,
  },
  {
    id: "agent-detail",
    container: ".agent-detail-layout",
    panel: ".detail-sidebar-card",
    mode: "grid-left",
    edge: "right",
    min: 240,
    max: 560,
    defaultWidth: 320,
    disableBelow: 1100,
  },
  {
    id: "tasks",
    container: ".task-split-layout",
    panel: ".task-list-panel",
    mode: "grid-left",
    edge: "right",
    min: 220,
    max: 560,
    defaultWidth: 320,
    disableBelow: 1100,
  },
  {
    id: "artifact",
    container: ".artifact-panel",
    panel: ".artifact-path-list",
    mode: "grid-left",
    edge: "right",
    min: 140,
    max: 480,
    defaultWidth: 240,
    disableBelow: 900,
  },
  {
    id: "templates",
    container: ".tpl-split",
    panel: ".tpl-sidebar",
    mode: "grid-left",
    edge: "right",
    min: 220,
    max: 520,
    defaultWidth: 300,
    disableBelow: 1100,
  },
  {
    id: "schedules-left",
    container: ".sched-split",
    panel: ".sched-sidebar",
    mode: "grid-left",
    edge: "right",
    min: 220,
    max: 480,
    defaultWidth: 300,
    disableBelow: 1100,
  },
  {
    id: "schedules-right",
    container: ".sched-split",
    panel: ".sched-history-panel",
    mode: "grid-right",
    edge: "left",
    min: 220,
    max: 480,
    defaultWidth: 300,
    disableBelow: 1100,
  },
  {
    id: "settings",
    container: ".settings-layout",
    panel: ".settings-nav",
    mode: "grid-left",
    edge: "right",
    min: 160,
    max: 360,
    defaultWidth: 200,
  },
];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readStored(id: string): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeStored(id: string, width: number): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, String(Math.round(width)));
  } catch {
    /* ignore quota / private mode */
  }
}

function applyWidth(cfg: SplitConfig, container: HTMLElement, panel: HTMLElement, width: number): void {
  const w = clamp(width, cfg.min, cfg.max);
  const px = `${Math.round(w)}px`;
  if (cfg.mode === "width") {
    panel.style.width = px;
    panel.style.flexShrink = "0";
  } else if (cfg.mode === "grid-left") {
    container.style.setProperty("--split-left", px);
  } else {
    container.style.setProperty("--split-right", px);
  }
}

function isDisabled(cfg: SplitConfig): boolean {
  return cfg.disableBelow != null && window.innerWidth <= cfg.disableBelow;
}

function resolvePanel(container: HTMLElement, cfg: SplitConfig): HTMLElement | null {
  if (cfg.panel) {
    return container.querySelector<HTMLElement>(cfg.panel);
  }
  const kids = Array.from(container.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains("split-resize-handle"),
  );
  if (cfg.edge === "left") return kids[kids.length - 1] ?? null;
  return kids[0] ?? null;
}

function bindHandle(handle: HTMLElement, cfg: SplitConfig, container: HTMLElement, panel: HTMLElement): void {
  let startX = 0;
  let startWidth = 0;
  let dragging = false;

  const onMove = (ev: PointerEvent) => {
    if (!dragging) return;
    const delta = cfg.edge === "right" ? ev.clientX - startX : startX - ev.clientX;
    applyWidth(cfg, container, panel, startWidth + delta);
  };

  const onUp = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("is-dragging");
    document.body.classList.remove("is-split-resizing");
    handle.releasePointerCapture(ev.pointerId);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);

    const applied =
      cfg.mode === "width"
        ? panel.getBoundingClientRect().width
        : Number.parseFloat(
            getComputedStyle(container).getPropertyValue(
              cfg.mode === "grid-left" ? "--split-left" : "--split-right",
            ),
          ) || startWidth;
    writeStored(cfg.id, applied);
  };

  handle.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    if (isDisabled(cfg)) return;
    if (cfg.mode === "grid-right" && panel.hasAttribute("hidden")) return;

    ev.preventDefault();
    dragging = true;
    startX = ev.clientX;
    startWidth =
      cfg.mode === "width"
        ? panel.getBoundingClientRect().width
        : Number.parseFloat(
            getComputedStyle(container).getPropertyValue(
              cfg.mode === "grid-left" ? "--split-left" : "--split-right",
            ),
          ) || panel.getBoundingClientRect().width;

    handle.classList.add("is-dragging");
    document.body.classList.add("is-split-resizing");
    handle.setPointerCapture(ev.pointerId);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  handle.addEventListener("dblclick", () => {
    if (isDisabled(cfg)) return;
    applyWidth(cfg, container, panel, cfg.defaultWidth);
    writeStored(cfg.id, cfg.defaultWidth);
  });
}

function syncDisabledState(): void {
  for (const cfg of SPLITS) {
    const container = document.querySelector<HTMLElement>(cfg.container);
    if (!container) continue;
    const panel = resolvePanel(container, cfg);
    if (!panel) continue;
    const handle = panel.querySelector<HTMLElement>(`.split-resize-handle[data-split-id="${cfg.id}"]`);
    if (!handle) continue;
    const off = isDisabled(cfg);
    handle.hidden = off;
    handle.setAttribute("aria-hidden", off ? "true" : "false");
    if (cfg.mode === "width") {
      if (off) {
        panel.style.width = "";
        panel.style.flexShrink = "";
      } else {
        const stored = readStored(cfg.id);
        applyWidth(cfg, container, panel, stored ?? cfg.defaultWidth);
      }
    }
  }
}

/** Install resize handles on all registered split layouts. */
export function initSplitResize(): void {
  for (const cfg of SPLITS) {
    const container = document.querySelector<HTMLElement>(cfg.container);
    if (!container) continue;
    const panel = resolvePanel(container, cfg);
    if (!panel) continue;
    if (panel.querySelector(`.split-resize-handle[data-split-id="${cfg.id}"]`)) continue;

    const stored = readStored(cfg.id);
    applyWidth(cfg, container, panel, stored ?? cfg.defaultWidth);

    const handle = document.createElement("div");
    handle.className = "split-resize-handle";
    handle.dataset.splitId = cfg.id;
    handle.dataset.edge = cfg.edge;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", t("拖拽调整面板宽度"));
    handle.title = t("拖拽调整宽度 · 双击复位");
    panel.appendChild(handle);
    bindHandle(handle, cfg, container, panel);
  }

  syncDisabledState();
  window.addEventListener("resize", syncDisabledState);
}
