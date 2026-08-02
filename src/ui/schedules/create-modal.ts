/**
 * Quick-path create schedule modal (S5) — from reuse bar / template save success.
 */
import {
  createSchedule,
  localDatetimeToUtcIso,
  type ScheduleMode,
} from "../../lib/api/schedules";
import {
  getTemplate,
  parseTemplateVariables,
  type Template,
  type TemplateVariable,
} from "../../lib/api/templates";
import { enhanceSelectsIn, destroySelectsIn } from "../form";
import { showView } from "../router";
import { formatActionableError, showToast } from "../toast";
import { refreshSchedules } from "./page";

export type CreateScheduleModalOpts = {
  templateId: string;
  name?: string;
  values?: Record<string, string>;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function overlay(): HTMLElement | null {
  return document.getElementById("schedule-create-modal");
}

function body(): HTMLElement | null {
  return document.getElementById("schedule-create-body");
}

function defaultLocalDatetime(minutesAhead = 5): string {
  const d = new Date(Date.now() + minutesAhead * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function closeCreateScheduleModal(event?: Event): void {
  if (event) {
    const t = event.target as HTMLElement | null;
    if (t && t.id !== "schedule-create-modal") return;
  }
  const modal = overlay();
  const el = body();
  if (el) destroySelectsIn(el);
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

function renderForm(
  template: Template,
  opts: CreateScheduleModalOpts,
): void {
  const el = body();
  if (!el) return;
  const vars = parseTemplateVariables(template.variables_json);
  const values = { ...opts.values };
  for (const v of vars) {
    if (values[v.key] == null && v.default) values[v.key] = v.default;
  }
  const name = opts.name || `${template.name} 定时`;

  const varFields =
    vars.length === 0
      ? `<div class="sched-hint">此模版无变量。</div>`
      : vars
          .map(
            (v) => `<div class="form-group">
        <label class="form-label">${escapeHtml(v.label || v.key)}${v.required ? " *" : ""}</label>
        <input class="form-input" data-sc-var="${escapeHtml(v.key)}" value="${escapeHtml(values[v.key] ?? "")}" placeholder="${escapeHtml(v.key)}" />
      </div>`,
          )
          .join("");

  destroySelectsIn(el);
  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
      <h3 style="font-size:15px; font-weight:700; margin:0;">设为定时</h3>
      <button type="button" class="btn btn-secondary btn-sm" id="sc-close">关闭</button>
    </div>
    <p style="font-size:12px; color:var(--fg-muted); margin:0 0 12px;">
      模版：<strong>${escapeHtml(template.name)}</strong>
    </p>
    <div class="form-group">
      <label class="form-label">名称</label>
      <input type="text" class="form-input" id="sc-name" value="${escapeHtml(name)}" />
    </div>
    <div class="form-group">
      <label class="form-label">触发方式</label>
      <select class="form-select" id="sc-mode">
        <option value="once" selected>执行一次</option>
        <option value="interval">按间隔重复</option>
      </select>
    </div>
    <div class="form-group" id="sc-once-fields">
      <label class="form-label">执行时间</label>
      <input type="datetime-local" class="form-input" id="sc-next" value="${escapeHtml(defaultLocalDatetime(10))}" />
    </div>
    <div class="form-group" id="sc-interval-fields" hidden>
      <label class="form-label">间隔</label>
      <div style="display:flex; gap:8px;">
        <input type="number" class="form-input" id="sc-interval-n" min="1" value="1" style="width:100px;" />
        <select class="form-select" id="sc-interval-unit">
          <option value="hours">小时</option>
          <option value="days" selected>天</option>
          <option value="minutes">分钟</option>
        </select>
      </div>
      <label class="form-label" style="margin-top:8px;">首次执行</label>
      <input type="datetime-local" class="form-input" id="sc-interval-next" value="${escapeHtml(defaultLocalDatetime(10))}" />
    </div>
    <div style="margin-top:8px; margin-bottom:12px;">
      <div class="form-label">变量</div>
      ${varFields}
    </div>
    <div style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secondary" id="sc-cancel">取消</button>
      <button type="button" class="btn btn-primary" id="sc-submit">创建定时</button>
    </div>
  `;

  const syncMode = () => {
    const mode = (document.getElementById("sc-mode") as HTMLSelectElement)
      ?.value;
    const once = document.getElementById("sc-once-fields");
    const iv = document.getElementById("sc-interval-fields");
    if (once) once.hidden = mode !== "once";
    if (iv) iv.hidden = mode !== "interval";
  };
  document.getElementById("sc-mode")?.addEventListener("change", syncMode);
  document.getElementById("sc-close")?.addEventListener("click", () =>
    closeCreateScheduleModal(),
  );
  document.getElementById("sc-cancel")?.addEventListener("click", () =>
    closeCreateScheduleModal(),
  );
  document.getElementById("sc-submit")?.addEventListener("click", () => {
    void submit(template, vars);
  });
  enhanceSelectsIn(el);
}

async function submit(
  template: Template,
  vars: TemplateVariable[],
): Promise<void> {
  const name =
    (document.getElementById("sc-name") as HTMLInputElement | null)?.value.trim() ||
    "";
  if (!name) {
    showToast("请填写名称", { kind: "error" });
    return;
  }
  const mode = ((document.getElementById("sc-mode") as HTMLSelectElement | null)
    ?.value || "once") as ScheduleMode;

  const values: Record<string, string> = {};
  document.querySelectorAll("[data-sc-var]").forEach((el) => {
    const key = (el as HTMLElement).getAttribute("data-sc-var");
    if (key && el instanceof HTMLInputElement) values[key] = el.value;
  });
  for (const v of vars) {
    if (v.required && !(values[v.key] || "").trim()) {
      showToast(`请填写变量 ${v.label || v.key}`, { kind: "error" });
      return;
    }
  }

  let nextRunAt = "";
  let intervalSecs: number | null = null;
  if (mode === "once") {
    const local =
      (document.getElementById("sc-next") as HTMLInputElement | null)?.value ||
      "";
    nextRunAt = localDatetimeToUtcIso(local);
  } else {
    const local =
      (document.getElementById("sc-interval-next") as HTMLInputElement | null)
        ?.value || "";
    nextRunAt = localDatetimeToUtcIso(local);
    const n = Number(
      (document.getElementById("sc-interval-n") as HTMLInputElement | null)
        ?.value || "1",
    );
    const unit =
      (document.getElementById("sc-interval-unit") as HTMLSelectElement | null)
        ?.value || "days";
    const mult =
      unit === "minutes" ? 60 : unit === "hours" ? 3600 : 86400;
    intervalSecs = Math.max(60, Math.round(n * mult));
  }
  if (!nextRunAt) {
    showToast("请选择有效的执行时间", { kind: "error" });
    return;
  }

  try {
    await createSchedule({
      name,
      templateId: template.id,
      values,
      mode,
      intervalSecs,
      nextRunAt,
      enabled: true,
    });
    showToast("定时任务已创建", { kind: "success" });
    closeCreateScheduleModal();
    void refreshSchedules();
    showView("schedules");
  } catch (e) {
    showToast(
      `创建失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
}

export async function openCreateScheduleModal(
  opts: CreateScheduleModalOpts,
): Promise<void> {
  const modal = overlay();
  const el = body();
  if (!modal || !el) return;
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  el.innerHTML = `<div style="padding:24px; text-align:center; color:var(--fg-muted); font-size:13px;">加载模版…</div>`;

  try {
    const template = await getTemplate(opts.templateId);
    if (!template) {
      el.innerHTML = `<div style="padding:24px; color:var(--status-danger-fg);">模版不存在</div>`;
      return;
    }
    renderForm(template, opts);
  } catch (e) {
    el.innerHTML = `<div style="padding:24px; color:var(--status-danger-fg);">${escapeHtml(
      e instanceof Error ? e.message : String(e),
    )}</div>`;
  }
}

export function initCreateScheduleModal(): void {
  document
    .getElementById("schedule-create-modal")
    ?.addEventListener("click", (e) => closeCreateScheduleModal(e));
}
