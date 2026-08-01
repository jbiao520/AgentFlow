/**
 * DAG concurrency picker (model-suggested, user override for this run only).
 * Allowed range: 1–8.
 */

export const MAX_CONCURRENCY = 8;
export const DEFAULT_CONCURRENCY = 1;

export function clampConcurrency(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(DEFAULT_CONCURRENCY, Math.floor(n)));
}

/** Suggested value from plan JSON (clamped). */
export function planSuggestedConcurrency(
  plan: { concurrency?: number | null } | null | undefined,
): number {
  const raw = plan?.concurrency;
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_CONCURRENCY;
  return clampConcurrency(Number(raw));
}

/** Compact select + hint for dispatch / launch toolbars. */
export function concurrencyControlHtml(
  suggested: number,
  selectId: string,
): string {
  const s = clampConcurrency(suggested);
  const options = Array.from({ length: MAX_CONCURRENCY }, (_, i) => {
    const n = i + 1;
    return `<option value="${n}"${n === s ? " selected" : ""}>${n}</option>`;
  }).join("");
  return `<label class="conc-control" title="本次运行并行度；不写回 Plan">
    <span class="conc-label">并发</span>
    <select class="form-select conc-select" id="${selectId}" aria-label="DAG 并发">${options}</select>
    <span class="conc-hint">模型建议 ${s} · 上限 ${MAX_CONCURRENCY}</span>
  </label>`;
}

export function readConcurrencySelect(selectId: string, fallback = DEFAULT_CONCURRENCY): number {
  const el = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!el) return clampConcurrency(fallback);
  const n = Number(el.value);
  return clampConcurrency(Number.isFinite(n) ? n : fallback);
}
