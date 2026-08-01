/**
 * Form controls: Tom Select enhancement + native value helpers.
 * Keep reading `.value` from the original <select>; call syncSelect after
 * programmatic option/value mutations.
 */
import TomSelect from "tom-select";
import { onLanguageChange, t } from "./i18n";

export type EnhanceSelectOptions = {
  /** Enable typeahead search (default: true except compact controls). */
  searchable?: boolean;
  placeholder?: string;
  /** Dense control for toolbars / numeric pickers. */
  compact?: boolean;
};

type SelectWithTom = HTMLSelectElement & { tomselect?: TomSelect };

export function getTomSelect(
  el: HTMLSelectElement | null | undefined,
): TomSelect | undefined {
  if (!el) return undefined;
  return (el as SelectWithTom).tomselect;
}

function resolveCompact(el: HTMLSelectElement, opts: EnhanceSelectOptions): boolean {
  if (opts.compact != null) return opts.compact;
  return (
    el.classList.contains("conc-select") ||
    el.classList.contains("form-select-compact") ||
    el.classList.contains("sched-unit-select")
  );
}

function resolveSearchable(
  el: HTMLSelectElement,
  opts: EnhanceSelectOptions,
  compact: boolean,
): boolean {
  if (opts.searchable != null) return opts.searchable;
  if (compact) return false;
  if (el.classList.contains("form-select-search")) return true;
  if (el.classList.contains("form-select-model")) return true;
  // Model catalogs and long template lists benefit from search.
  if (el.id.includes("model") || el.id.includes("template")) return true;
  return el.options.length > 8;
}

function transferInlineWidth(el: HTMLSelectElement, wrapper: HTMLElement): void {
  const w = el.style.width;
  if (w) {
    wrapper.style.width = w;
    el.style.width = "";
  }
}

/** Split catalog model id into display title + secondary meta line. */
export function describeModelOption(
  id: string,
  label?: string,
): { title: string; meta: string } {
  const raw = (id || "").trim();
  if (!raw) {
    return { title: label?.trim() || "—", meta: "" };
  }

  const hasProvider = raw.includes("/");
  const provider = hasProvider ? raw.split("/")[0] : "";
  const name = hasProvider ? (raw.split("/").pop() ?? raw) : raw;
  const bare = name.replace(/^cursor-/, "");

  const labelTrim = (label || "").trim();
  // Prefer a human label when it isn't just the raw id / "id — name" dump.
  let title = bare;
  if (
    labelTrim &&
    labelTrim !== raw &&
    !labelTrim.startsWith(`${raw} `) &&
    !labelTrim.startsWith(`${raw}—`) &&
    !labelTrim.startsWith(`${raw} —`)
  ) {
    const em = labelTrim.includes(" — ")
      ? labelTrim.split(" — ").pop()!.trim()
      : labelTrim;
    if (em) title = em;
  }

  if (provider) {
    return { title, meta: `${provider} · ${bare}` };
  }

  let family = "";
  if (/^gpt-|^o\d/i.test(bare)) family = "openai";
  else if (/grok/i.test(bare)) family = "xai";
  else if (/composer/i.test(bare) || name.startsWith("cursor-")) family = "cursor";
  else if (/^auto$/i.test(bare)) family = "router";

  return {
    title,
    meta: family ? `${family} · ${raw}` : raw,
  };
}

function modelOptionHtml(
  data: { value?: string; text?: string },
  escape: (s: string) => string,
  kind: "option" | "item",
): string {
  const id = String(data.value ?? "");
  const { title, meta } = describeModelOption(id, String(data.text ?? ""));
  const safeTitle = escape(title);
  const safeMeta = escape(meta || id);
  if (kind === "item") {
    return `<div class="ts-model-item"><span class="ts-model-title">${safeTitle}</span>${
      meta ? `<span class="ts-model-meta">${safeMeta}</span>` : ""
    }</div>`;
  }
  return `<div class="ts-model-opt"><div class="ts-model-title">${safeTitle}</div><div class="ts-model-meta">${safeMeta}</div></div>`;
}

/**
 * Upgrade a native <select class="form-select"> with Tom Select.
 * Idempotent — returns the existing instance if already enhanced.
 * Segmented selects (CLI engine) are skipped — they keep a hidden native select.
 */
export function enhanceSelect(
  el: HTMLSelectElement | null | undefined,
  opts: EnhanceSelectOptions = {},
): TomSelect | null {
  if (!el) return null;
  if (el.classList.contains("form-select-segmented")) return null;
  const existing = getTomSelect(el);
  if (existing) return existing;

  const compact = resolveCompact(el, opts);
  const searchable = resolveSearchable(el, opts, compact);
  const isModel = el.classList.contains("form-select-model");

  const ts = new TomSelect(el, {
    allowEmptyOption: true,
    create: false,
    maxOptions: null,
    hideSelected: false,
    closeAfterSelect: true,
    controlInput: searchable ? undefined : null,
    searchField: isModel ? ["text", "value"] : ["text"],
    placeholder:
      opts.placeholder ?? el.getAttribute("placeholder") ?? el.dataset.placeholder ?? "",
    dropdownParent: "body",
    render: {
      no_results: () => `<div class="no-results">${t("无匹配项")}</div>`,
      ...(isModel
        ? {
            option: (data: { value?: string; text?: string }, escape: (s: string) => string) =>
              modelOptionHtml(data, escape, "option"),
            item: (data: { value?: string; text?: string }, escape: (s: string) => string) =>
              modelOptionHtml(data, escape, "item"),
          }
        : {}),
    },
  });

  ts.wrapper.classList.add("af-ts");
  if (compact) ts.wrapper.classList.add("af-ts-compact");
  if (isModel) ts.wrapper.classList.add("af-ts-model");
  if (el.classList.contains("conc-select")) {
    ts.wrapper.classList.add("af-ts-conc");
  }
  if (el.classList.contains("sched-unit-select")) {
    ts.wrapper.classList.add("sched-unit-wrap");
    ts.wrapper.style.width = el.style.width || "120px";
  }
  if (searchable) ts.wrapper.classList.add("af-ts-searchable");
  transferInlineWidth(el, ts.wrapper);

  // Mirror loading / disabled state from the original select.
  if (el.classList.contains("is-loading")) {
    ts.wrapper.classList.add("is-loading");
    ts.disable();
  }
  if (el.disabled) ts.disable();

  return ts;
}

/** Enhance every `.form-select` under root (default: document). */
export function enhanceSelectsIn(
  root: ParentNode = document,
  opts?: EnhanceSelectOptions,
): void {
  root
    .querySelectorAll<HTMLSelectElement>("select.form-select")
    .forEach((el) => {
      enhanceSelect(el, opts);
    });
}

/**
 * After mutating options or value on the native <select>, re-sync Tom Select UI.
 * Safe to call when the select is not enhanced.
 *
 * Tom Select's sync() only addOptions — it never drops options removed from the
 * native <select>. Clear first so switching CLI/engine catalogs don't leak.
 */
export function syncSelect(el: HTMLSelectElement | null | undefined): void {
  if (!el) return;
  const ts = getTomSelect(el);
  if (!ts) return;
  const wasDisabled = ts.isDisabled;
  // Tom Select clear() still clears native selected options even when silent,
  // so remember the value and restore after re-sync (e.g. language refresh).
  const previousValue = el.value;
  // clearFilter keeps selected items; clear selection before clearOptions.
  ts.clear(true);
  ts.clearOptions();
  ts.sync();
  if (previousValue && el.value !== previousValue) {
    ts.setValue(previousValue, true);
  }
  // sync() may re-enable; restore disabled / loading intent.
  if (wasDisabled || el.disabled || el.classList.contains("is-loading")) {
    ts.disable();
  } else {
    ts.enable();
  }
  if (el.classList.contains("is-loading")) {
    ts.wrapper.classList.add("is-loading");
  } else {
    ts.wrapper.classList.remove("is-loading");
  }
}

function findCliSegment(select: HTMLSelectElement): HTMLElement | null {
  const byAttr = document.querySelector<HTMLElement>(
    `[data-cli-select="${CSS.escape(select.id)}"]`,
  );
  if (byAttr) return byAttr;
  return select
    .closest("[data-model-cluster]")
    ?.querySelector<HTMLElement>("[data-cli-select]") ?? null;
}

/** Mirror native CLI <select> value onto its segmented control. */
export function syncCliSegment(select: HTMLSelectElement | null | undefined): void {
  if (!select?.id) return;
  const seg = findCliSegment(select);
  if (!seg) return;
  const value = select.value;
  seg.querySelectorAll<HTMLElement>(".cli-seg").forEach((btn) => {
    const on = btn.dataset.value === value;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
  });
}

/**
 * Wire all `[data-cli-select]` segmented controls under root.
 * Clicks write the hidden native select and fire `change`.
 */
export function bindCliSegments(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-cli-select]").forEach((seg) => {
    if (seg.dataset.bound === "1") return;
    const selectId = seg.dataset.cliSelect;
    if (!selectId) return;
    const select = document.getElementById(selectId) as HTMLSelectElement | null;
    if (!select) return;
    seg.dataset.bound = "1";

    seg.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement | null)?.closest?.(".cli-seg") as
        | HTMLElement
        | null;
      if (!btn || !seg.contains(btn)) return;
      const value = btn.dataset.value;
      if (!value || select.value === value) return;
      select.value = value;
      syncCliSegment(select);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    syncCliSegment(select);
  });
}

/** Set value on native select + Tom Select (if present) + CLI segment. */
export function setSelectValue(
  el: HTMLSelectElement | null | undefined,
  value: string,
  silent = true,
): void {
  if (!el) return;
  const ts = getTomSelect(el);
  if (ts) {
    ts.setValue(value, silent);
  } else {
    el.value = value;
  }
  if (el.classList.contains("form-select-segmented")) {
    syncCliSegment(el);
  }
}

/** Loading shimmer + disable for model catalogs etc. */
export function setSelectLoading(
  el: HTMLSelectElement | null | undefined,
  loading: boolean,
): void {
  if (!el) return;
  el.classList.toggle("is-loading", loading);
  el.setAttribute("aria-busy", loading ? "true" : "false");

  if (loading && el.options.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "加载中…";
    el.appendChild(opt);
  }

  const ts = getTomSelect(el);
  if (ts) {
    if (loading && el.options.length <= 1) {
      ts.sync();
    }
    ts.wrapper.classList.toggle("is-loading", loading);
    if (loading) ts.disable();
    else ts.enable();
  } else if (!loading) {
    el.disabled = false;
  }
}

export function destroySelect(el: HTMLSelectElement | null | undefined): void {
  if (!el) return;
  const ts = getTomSelect(el);
  if (ts) ts.destroy();
}

/** Destroy enhanced selects before replacing a container's innerHTML. */
export function destroySelectsIn(root: ParentNode): void {
  root
    .querySelectorAll<HTMLSelectElement>("select.form-select")
    .forEach((el) => destroySelect(el));
}

/** Re-sync Tom Select labels after DOM language application. */
export function refreshSelectLanguages(root: ParentNode = document): void {
  root.querySelectorAll<HTMLSelectElement>("select.form-select").forEach((el) => {
    syncSelect(el);
  });
}

onLanguageChange(() => {
  refreshSelectLanguages(document);
});
