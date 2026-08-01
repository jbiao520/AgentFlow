/**
 * Shared CLI model catalog UI helpers for 调度 + Agent 详情.
 */
import {
  listEngineModels,
  type EngineModel,
  type EngineModelCatalog,
} from "../lib/api/cli";
import {
  describeModelOption,
  setSelectLoading,
  setSelectValue,
  syncSelect,
} from "./form";
import { showToast } from "./toast";

const CURSOR_EFFORT_SUFFIXES = [
  "extra-high",
  "xhigh",
  "medium",
  "high",
  "low",
  "max",
  "none",
  "minimal",
] as const;

export type SplitCursorModel = {
  base: string;
  effort: string | null;
  fast: boolean;
};

/** Split a legacy Cursor full model id into base + effort + fast. */
export function splitCursorModelId(raw: string): SplitCursorModel {
  let s = raw.trim();
  let fast = false;
  if (s.endsWith("-fast") && s.length > "-fast".length) {
    s = s.slice(0, -"-fast".length);
    fast = true;
  }
  for (const effort of CURSOR_EFFORT_SUFFIXES) {
    const suffix = `-${effort}`;
    if (s.endsWith(suffix) && s.length > suffix.length) {
      return { base: s.slice(0, -suffix.length), effort, fast };
    }
  }
  return { base: s, effort: null, fast };
}

/**
 * Normalize saved model/effort/fast for a given engine.
 * Cursor may have stored a full suffixed id historically.
 */
export function normalizeSavedModel(
  engine: string,
  model: string | null | undefined,
  effort: string | null | undefined,
  fast?: boolean | null,
): { model: string; effort: string; fast: boolean } {
  const m = (model || "").trim();
  let e = (effort || "").trim().toLowerCase();
  let f = !!fast;
  if (engine === "cursor-agent" && m) {
    const split = splitCursorModelId(m);
    if (split.effort && !e) e = split.effort;
    if (split.fast) f = true;
    return { model: split.base, effort: e, fast: f };
  }
  return { model: m, effort: e, fast: f };
}

/** Read Fast flag from agent engine_options_json. */
export function parseFastFromEngineOptions(
  json: string | null | undefined,
): boolean {
  if (!json || !json.trim()) return false;
  try {
    const v = JSON.parse(json) as { fast?: unknown };
    return v.fast === true;
  } catch {
    return false;
  }
}

/** Serialize Fast toggle into engine_options_json. */
export function engineOptionsWithFast(fast: boolean): string {
  return fast ? '{"fast":true}' : "{}";
}

export function isFastChecked(input: HTMLInputElement | null): boolean {
  return !!input?.checked;
}

/** Show/hide Fast toggle and set checked state from model capability. */
export function applyFastToggle(
  wrap: HTMLElement | null,
  input: HTMLInputElement | null,
  supportsFast: boolean,
  preferred: boolean,
): boolean {
  if (!wrap || !input) return false;
  wrap.hidden = !supportsFast;
  if (!supportsFast) {
    input.checked = false;
    return false;
  }
  input.checked = preferred;
  return preferred;
}

/** Strip optional `provider/` prefix from a catalog model id. */
function modelBasename(modelId: string): string {
  return modelId.includes("/")
    ? (modelId.split("/").pop() ?? modelId)
    : modelId;
}

/**
 * GPT major.minor extracted from a model id (optional provider/ prefix).
 * e.g. openai/gpt-5.4-mini → {5,4}, gpt-5.6-sol → {5,6}, gpt-4o → {4,0}.
 */
function parseGptVersion(
  modelId: string,
): { major: number; minor: number } | null {
  const m = modelBasename(modelId)
    .toLowerCase()
    .match(/^gpt-(\d+)(?:\.(\d+))?/);
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
 * Grok major.minor from a model id (optional provider/ / cursor- prefix).
 * e.g. xai/grok-4.3 → {4,3}, cursor-grok-4.5 → {4,5}, grok-4 → {4,0}.
 */
function parseGrokVersion(
  modelId: string,
): { major: number; minor: number } | null {
  const m = modelBasename(modelId)
    .toLowerCase()
    .match(/(?:^|-)grok-(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return {
    major: Number.parseInt(m[1], 10),
    minor: m[2] ? Number.parseInt(m[2], 10) : 0,
  };
}

/** True if this is a versioned Grok id strictly below 4.5. */
function isGrokBelow45(modelId: string): boolean {
  const ver = parseGrokVersion(modelId);
  if (!ver) return false;
  if (ver.major < 4) return true;
  if (ver.major > 4) return false;
  return ver.minor < 5;
}

/**
 * Models hidden from the selection UI:
 * 1. Any Claude model
 * 2. GPT-5.4 and all earlier GPT versions
 * 3. Grok below 4.5 (e.g. grok-4.3 / grok-4 / grok-3)
 * 4. OpenCode-hosted free models (id starts with `opencode/`)
 * 5. Raw `-fast` / effort-suffixed catalog ids (folded into supports_fast + effort pills)
 */
export function isSelectableModel(modelId: string): boolean {
  const id = modelId.trim();
  if (!id) return false;
  const lower = id.toLowerCase();
  if (lower.includes("claude")) return false;
  if (lower.startsWith("opencode/")) return false;
  if (isGptAtOrBefore54(lower)) return false;
  if (isGrokBelow45(lower)) return false;
  // Fast / effort variants are controlled by toggles/pills, never listed as separate models.
  if (lower.endsWith("-fast") && lower.length > "-fast".length) return false;
  const split = splitCursorModelId(lower);
  if (split.effort || split.fast) return false;
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

/** Human label for a reasoning effort pill. */
function formatEffortLabel(effort: string): string {
  const e = effort.toLowerCase();
  if (e === "extra-high" || e === "xhigh") return "Xhigh";
  if (e === "none") return "None";
  if (e === "minimal") return "Minimal";
  return e.charAt(0).toUpperCase() + e.slice(1);
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

  let selected = "";

  if (!catalog || catalog.models.length === 0) {
    if (preferred && keepUnavailable) {
      const opt = document.createElement("option");
      opt.value = preferred;
      opt.textContent = `${preferred} ${unavailableLabel}`;
      select.appendChild(opt);
      selected = preferred;
    } else {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "无可用模型";
      select.appendChild(opt);
      selected = "";
    }
  } else {
    for (const m of catalog.models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      const { title } = describeModelOption(m.id, m.display_name);
      opt.textContent = title;
      select.appendChild(opt);
    }

    if (preferred && catalog.models.some((m) => m.id === preferred)) {
      selected = preferred;
    } else if (preferred && keepUnavailable) {
      const opt = document.createElement("option");
      opt.value = preferred;
      const { title } = describeModelOption(preferred);
      opt.textContent = `${title} ${unavailableLabel}`;
      select.appendChild(opt);
      selected = preferred;
    } else {
      selected = catalog.models[0].id;
    }
  }

  select.value = selected;
  // Re-sync Tom Select after option rebuild.
  syncSelect(select);
  setSelectValue(select, selected, true);
  return selected;
}

export function setModelSelectLoading(
  select: HTMLSelectElement,
  loading: boolean,
): void {
  // Soft-load: keep current options visible so switching CLI doesn't blank the control.
  // Only inject a placeholder when the select is empty (first open).
  if (loading && select.options.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "加载模型中…";
    select.appendChild(opt);
  }
  setSelectLoading(select, loading);
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
    container.removeAttribute("role");
    const hint = document.createElement("div");
    hint.className = "reasoning-pill";
    hint.innerHTML =
      '<span class="reasoning-pill-label">N/A</span><span class="reasoning-pill-tick" aria-hidden="true"></span>';
    hint.style.cursor = "default";
    container.appendChild(hint);
    return "";
  }

  container.style.opacity = "";
  container.style.pointerEvents = "";

  const active = pickDefaultEffort(efforts, preferred, catalogDefault);

  for (const effort of efforts) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "reasoning-pill";
    pill.setAttribute("data-reasoning", effort);
    pill.setAttribute("role", "radio");
    const label = formatEffortLabel(effort);
    pill.innerHTML = `<span class="reasoning-pill-label">${label}</span><span class="reasoning-pill-tick" aria-hidden="true"></span>`;
    const isActive = effort.toLowerCase() === active.toLowerCase();
    if (isActive) pill.classList.add("active");
    pill.setAttribute("aria-checked", isActive ? "true" : "false");
    pill.addEventListener("click", () => {
      container.querySelectorAll(".reasoning-pill").forEach((p) => {
        p.classList.remove("active");
        p.setAttribute("aria-checked", "false");
      });
      pill.classList.add("active");
      pill.setAttribute("aria-checked", "true");
    });
    container.appendChild(pill);
  }
  container.setAttribute("role", "radiogroup");

  return active;
}

export type ReloadCatalogOptions = {
  model?: string;
  effort?: string;
  fast?: boolean;
  /** When true (default for saved load), keep missing model as an option. */
  keepUnavailable?: boolean;
};

export type BindModelCatalogOptions = {
  cliSelect: HTMLSelectElement;
  modelSelect: HTMLSelectElement;
  pills: HTMLElement;
  /** Optional Fast mode toggle (Cursor models with -fast variants). */
  fastWrap?: HTMLElement | null;
  fastToggle?: HTMLInputElement | null;
  getPreferred: () => { model: string; effort: string; fast: boolean };
};

/**
 * Wire CLI → catalog → model → effort → fast for a settings panel.
 * Returns a reload function (used after loading saved settings / agent profile).
 */
export function bindModelCatalogPanel(
  opts: BindModelCatalogOptions,
): (preferred?: ReloadCatalogOptions) => Promise<void> {
  let currentCatalog: EngineModelCatalog | null = null;
  let inflight = 0;
  /** Last preferred fast while switching models that support it. */
  let preferredFast = false;

  const applyModel = (
    modelId: string,
    preferredEffort: string,
    preferredFastFlag: boolean,
  ) => {
    const model = findModel(currentCatalog, modelId);
    renderEffortPills(
      opts.pills,
      model?.efforts ?? [],
      preferredEffort,
      model?.default_effort,
    );
    preferredFast = applyFastToggle(
      opts.fastWrap ?? null,
      opts.fastToggle ?? null,
      !!model?.supports_fast,
      preferredFastFlag,
    );
  };

  const reload = async (preferred?: ReloadCatalogOptions) => {
    const engine = opts.cliSelect.value.trim() || "codex";
    const fromForm = opts.getPreferred();
    const rawModel = preferred?.model ?? fromForm.model;
    const rawEffort = preferred?.effort ?? fromForm.effort;
    const rawFast = preferred?.fast ?? fromForm.fast;
    const keepUnavailable = preferred?.keepUnavailable === true;
    const normalized = normalizeSavedModel(
      engine,
      rawModel,
      rawEffort,
      rawFast,
    );
    preferredFast = normalized.fast;

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
    applyModel(selectedModel, normalized.effort, preferredFast);
  };

  opts.cliSelect.addEventListener("change", () => {
    // Prefer keeping current model if present in new catalog; otherwise first.
    const model = opts.modelSelect.value;
    const effort = selectedEffort(opts.pills);
    void reload({
      model: model === "" ? "" : model,
      effort,
      fast: isFastChecked(opts.fastToggle ?? null),
      keepUnavailable: false,
    });
  });

  opts.modelSelect.addEventListener("change", () => {
    const modelId = opts.modelSelect.value;
    // Keep user's fast preference when switching between supporting models.
    const keepFast =
      isFastChecked(opts.fastToggle ?? null) || preferredFast;
    applyModel(modelId, selectedEffort(opts.pills), keepFast);
  });

  opts.fastToggle?.addEventListener("change", () => {
    preferredFast = isFastChecked(opts.fastToggle ?? null);
  });

  return reload;
}
