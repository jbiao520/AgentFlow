/**
 * Shared CLI model catalog UI helpers for 调度中枢 + Agent 详情.
 */
import {
  listEngineModels,
  type EngineModel,
  type EngineModelCatalog,
} from "../lib/api/cli";
import { showToast } from "./toast";

const CURSOR_EFFORT_SUFFIXES = ["xhigh", "medium", "high", "low", "max"] as const;

export type SplitCursorModel = {
  base: string;
  effort: string | null;
};

/** Split a legacy Cursor full model id into base + effort. */
export function splitCursorModelId(raw: string): SplitCursorModel {
  let s = raw.trim();
  if (s.endsWith("-fast")) {
    s = s.slice(0, -"-fast".length);
  }
  for (const effort of CURSOR_EFFORT_SUFFIXES) {
    const suffix = `-${effort}`;
    if (s.endsWith(suffix) && s.length > suffix.length) {
      return { base: s.slice(0, -suffix.length), effort };
    }
  }
  return { base: s, effort: null };
}

/**
 * Normalize saved model/effort for a given engine.
 * Cursor may have stored a full suffixed id historically.
 */
export function normalizeSavedModel(
  engine: string,
  model: string | null | undefined,
  effort: string | null | undefined,
): { model: string; effort: string } {
  const m = (model || "").trim();
  let e = (effort || "").trim().toLowerCase();
  if (engine === "cursor-agent" && m) {
    const split = splitCursorModelId(m);
    if (split.effort && !e) e = split.effort;
    return { model: split.base, effort: e };
  }
  return { model: m, effort: e };
}

/**
 * GPT major.minor extracted from a model id (optional provider/ prefix).
 * e.g. openai/gpt-5.4-mini → {5,4}, gpt-5.6-sol → {5,6}, gpt-4o → {4,0}.
 */
function parseGptVersion(
  modelId: string,
): { major: number; minor: number } | null {
  const name = modelId.includes("/")
    ? (modelId.split("/").pop() ?? modelId)
    : modelId;
  const m = name.toLowerCase().match(/^gpt-(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return {
    major: Number.parseInt(m[1], 10),
    minor: m[2] ? Number.parseInt(m[2], 10) : 0,
  };
}

/** True if this GPT id is 5.4 or earlier (inclusive). Non-GPT ids → false. */
function isGptAtOrBefore54(modelId: string): boolean {
  const ver = parseGptVersion(modelId);
  if (!ver) return false;
  if (ver.major < 5) return true;
  if (ver.major > 5) return false;
  return ver.minor <= 4;
}

/**
 * Models hidden from the selection UI:
 * 1. Any Claude model
 * 2. GPT-5.4 and all earlier GPT versions
 * 3. OpenCode-hosted free models (id starts with `opencode/`)
 */
export function isSelectableModel(modelId: string): boolean {
  const id = modelId.trim();
  if (!id) return false;
  const lower = id.toLowerCase();
  if (lower.includes("claude")) return false;
  if (lower.startsWith("opencode/")) return false;
  if (isGptAtOrBefore54(lower)) return false;
  return true;
}

export function filterSelectableCatalog(
  catalog: EngineModelCatalog,
): EngineModelCatalog {
  return {
    ...catalog,
    models: catalog.models.filter((m) => isSelectableModel(m.id)),
  };
}

export async function loadCatalog(
  engine: string,
  opts?: { refresh?: boolean; silent?: boolean },
): Promise<EngineModelCatalog | null> {
  try {
    const catalog = await listEngineModels(engine, opts?.refresh === true);
    return filterSelectableCatalog(catalog);
  } catch (err) {
    if (!opts?.silent) {
      showToast(
        `加载模型列表失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }
}

export function findModel(
  catalog: EngineModelCatalog | null,
  modelId: string,
): EngineModel | undefined {
  if (!catalog) return undefined;
  return catalog.models.find((m) => m.id === modelId);
}

export function pickDefaultEffort(
  efforts: string[],
  preferred?: string | null,
  catalogDefault?: string | null,
): string {
  if (!efforts.length) return "";
  const pref = (preferred || "").toLowerCase();
  if (pref && efforts.some((e) => e.toLowerCase() === pref)) {
    return pref;
  }
  if (catalogDefault && efforts.some((e) => e === catalogDefault)) {
    return catalogDefault;
  }
  if (efforts.includes("medium")) return "medium";
  return efforts[0] || "";
}

export function fillModelSelect(
  select: HTMLSelectElement,
  catalog: EngineModelCatalog | null,
  preferred: string,
  opts?: { keepUnavailable?: boolean; unavailableLabel?: string },
): string {
  const keepUnavailable = opts?.keepUnavailable !== false;
  const unavailableLabel = opts?.unavailableLabel ?? "(已保存，当前不可用)";
  select.innerHTML = "";

  if (!catalog || catalog.models.length === 0) {
    if (preferred && keepUnavailable) {
      const opt = document.createElement("option");
      opt.value = preferred;
      opt.textContent = `${preferred} ${unavailableLabel}`;
      select.appendChild(opt);
      select.value = preferred;
      return preferred;
    }
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "无可用模型";
    select.appendChild(opt);
    select.value = "";
    return "";
  }

  for (const m of catalog.models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.display_name ? `${m.id} — ${m.display_name}` : m.id;
    select.appendChild(opt);
  }

  if (preferred && catalog.models.some((m) => m.id === preferred)) {
    select.value = preferred;
    return preferred;
  }

  if (preferred && keepUnavailable) {
    const opt = document.createElement("option");
    opt.value = preferred;
    opt.textContent = `${preferred} ${unavailableLabel}`;
    select.appendChild(opt);
    select.value = preferred;
    return preferred;
  }

  const first = catalog.models[0].id;
  select.value = first;
  return first;
}

export function setModelSelectLoading(
  select: HTMLSelectElement,
  loading: boolean,
): void {
  select.classList.toggle("is-loading", loading);
  select.setAttribute("aria-busy", loading ? "true" : "false");
  // Soft-load: keep current options visible so switching CLI doesn't blank the control.
  // Only inject a placeholder when the select is empty (first open).
  if (loading && select.options.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "加载模型中…";
    select.appendChild(opt);
  }
  if (!loading) {
    select.disabled = false;
  }
}

export function selectedEffort(container: HTMLElement): string {
  const active = container.querySelector(".reasoning-pill.active");
  return (active?.getAttribute("data-reasoning") || "").toLowerCase();
}

export function renderEffortPills(
  container: HTMLElement,
  efforts: string[],
  preferred?: string | null,
  catalogDefault?: string | null,
): string {
  container.innerHTML = "";

  if (!efforts.length) {
    container.style.opacity = "0.45";
    container.style.pointerEvents = "none";
    const hint = document.createElement("div");
    hint.className = "reasoning-pill";
    hint.textContent = "N/A";
    hint.style.cursor = "default";
    container.appendChild(hint);
    return "";
  }

  container.style.opacity = "";
  container.style.pointerEvents = "";

  const active = pickDefaultEffort(efforts, preferred, catalogDefault);

  for (const effort of efforts) {
    const pill = document.createElement("div");
    pill.className = "reasoning-pill";
    pill.setAttribute("data-reasoning", effort);
    pill.textContent = effort.charAt(0).toUpperCase() + effort.slice(1);
    if (effort.toLowerCase() === active.toLowerCase()) {
      pill.classList.add("active");
    }
    pill.addEventListener("click", () => {
      container
        .querySelectorAll(".reasoning-pill")
        .forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
    });
    container.appendChild(pill);
  }

  return active;
}

export type ReloadCatalogOptions = {
  model?: string;
  effort?: string;
  /** When true (default for saved load), keep missing model as an option. */
  keepUnavailable?: boolean;
};

export type BindModelCatalogOptions = {
  cliSelect: HTMLSelectElement;
  modelSelect: HTMLSelectElement;
  pills: HTMLElement;
  getPreferred: () => { model: string; effort: string };
};

/**
 * Wire CLI → catalog → model → effort for a settings panel.
 * Returns a reload function (used after loading saved settings / agent profile).
 */
export function bindModelCatalogPanel(
  opts: BindModelCatalogOptions,
): (preferred?: ReloadCatalogOptions) => Promise<void> {
  let currentCatalog: EngineModelCatalog | null = null;
  let inflight = 0;

  const applyModel = (modelId: string, preferredEffort: string) => {
    const model = findModel(currentCatalog, modelId);
    return renderEffortPills(
      opts.pills,
      model?.efforts ?? [],
      preferredEffort,
      model?.default_effort,
    );
  };

  const reload = async (preferred?: ReloadCatalogOptions) => {
    const engine = opts.cliSelect.value.trim() || "codex";
    const fromForm = opts.getPreferred();
    const rawModel = preferred?.model ?? fromForm.model;
    const rawEffort = preferred?.effort ?? fromForm.effort;
    const keepUnavailable = preferred?.keepUnavailable === true;
    const normalized = normalizeSavedModel(engine, rawModel, rawEffort);

    const token = ++inflight;
    setModelSelectLoading(opts.modelSelect, true);
    const catalog = await loadCatalog(engine);
    if (token !== inflight) return;

    currentCatalog = catalog;
    setModelSelectLoading(opts.modelSelect, false);

    const selectedModel = fillModelSelect(
      opts.modelSelect,
      catalog,
      normalized.model,
      { keepUnavailable },
    );
    applyModel(selectedModel, normalized.effort);
  };

  opts.cliSelect.addEventListener("change", () => {
    // Prefer keeping current model if present in new catalog; otherwise first.
    const model = opts.modelSelect.value;
    const effort = selectedEffort(opts.pills);
    void reload({
      model: model === "" ? "" : model,
      effort,
      keepUnavailable: false,
    });
  });

  opts.modelSelect.addEventListener("change", () => {
    const modelId = opts.modelSelect.value;
    applyModel(modelId, selectedEffort(opts.pills));
  });

  return reload;
}
