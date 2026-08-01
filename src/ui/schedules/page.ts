/**
 * Schedules view: list, create/edit timed template runs.
 */
import {
  createSchedule,
  deleteSchedule,
  formatInterval,
  localDatetimeToUtcIso,
  listSchedules,
  parseScheduleValues,
  runScheduleNow,
  setScheduleEnabled,
  updateSchedule,
  utcIsoToLocalDatetime,
  type Schedule,
  type ScheduleMode,
} from "../../lib/api/schedules";
import {
  listTemplates,
  parseTemplateVariables,
  type Template,
  type TemplateVariable,
} from "../../lib/api/templates";
import { updateScheduleNavCount } from "../nav-counts";
import { showView } from "../router";
import { formatActionableError, showToast } from "../toast";
import { confirmAction } from "../modals";

type PageState = {
  schedules: Schedule[];
  templates: Template[];
  selectedId: string | null;
  detail: Schedule | null;
  editingNew: boolean;
};

const state: PageState = {
  schedules: [],
  templates: [],
  selectedId: null,
  detail: null,
  editingNew: false,
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function defaultLocalDatetime(minutesAhead = 5): string {
  const d = new Date(Date.now() + minutesAhead * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function refreshSchedules(): Promise<void> {
  try {
    const [schedules, templates] = await Promise.all([
      listSchedules(),
      listTemplates(),
    ]);
    state.schedules = schedules;
    state.templates = templates;
  } catch (e) {
    state.schedules = [];
    showToast(
      `加载定时任务失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
  updateScheduleNavCount(state.schedules.filter((s) => s.enabled).length);
  renderList();
  if (state.editingNew) {
    renderEditor(null);
    return;
  }
  if (state.selectedId) {
    const still = state.schedules.find((s) => s.id === state.selectedId);
    if (still) {
      state.detail = still;
      renderEditor(still);
    } else {
      state.selectedId = null;
      state.detail = null;
      renderEmptyDetail();
    }
  } else {
    renderEmptyDetail();
  }
}

function renderList(): void {
  const list = document.getElementById("schedule-list");
  const count = document.getElementById("schedule-list-count");
  if (count) count.textContent = `共 ${state.schedules.length} 个`;
  if (!list) return;

  if (state.schedules.length === 0) {
    list.innerHTML = `<div class="empty-state" style="display:flex; margin:12px;">
      <div style="font-weight:600; font-size:14px; margin-bottom:4px; color:var(--fg-primary);">还没有定时任务</div>
      <div style="font-size:12px; color:var(--fg-muted);">选择一个模版，设好时间后即可自动执行。</div>
    </div>`;
    return;
  }

  list.innerHTML = state.schedules
    .map((s) => {
      const tmpl = state.templates.find((t) => t.id === s.template_id);
      const active =
        !state.editingNew && s.id === state.selectedId ? " active" : "";
      const modeLabel =
        s.mode === "interval"
          ? formatInterval(s.interval_secs)
          : "执行一次";
      const status = s.enabled ? "启用" : "暂停";
      return `<div class="task-item${active}" data-schedule-id="${escapeHtml(s.id)}" role="button" tabindex="0">
        <div class="task-item-main">
          <div class="task-item-title">${escapeHtml(s.name)}</div>
          <div class="task-item-meta">${escapeHtml(tmpl?.name || s.template_id.slice(0, 8))} · ${modeLabel} · ${status}</div>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-schedule-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).getAttribute("data-schedule-id");
      if (id) selectSchedule(id);
    });
  });
}

function selectSchedule(id: string): void {
  state.editingNew = false;
  state.selectedId = id;
  state.detail = state.schedules.find((s) => s.id === id) ?? null;
  renderList();
  renderEditor(state.detail);
}

function renderEmptyDetail(): void {
  const root = document.getElementById("schedule-detail");
  if (!root) return;
  root.innerHTML = `<div style="padding:24px; color:var(--fg-muted); font-size:13px;">选择左侧任务查看详情，或点击「新建定时任务」。</div>`;
}

function templateVars(templateId: string): TemplateVariable[] {
  const t = state.templates.find((x) => x.id === templateId);
  return t ? parseTemplateVariables(t.variables_json) : [];
}

function renderVarFields(
  templateId: string,
  values: Record<string, string>,
): string {
  const vars = templateVars(templateId);
  if (vars.length === 0) {
    return `<div style="font-size:12px; color:var(--fg-muted);">此模版无变量。</div>`;
  }
  return vars
    .map(
      (v) => `<div class="form-group">
        <label class="form-label">${escapeHtml(v.label || v.key)}${v.required ? " *" : ""}</label>
        <input class="form-input" data-sched-var="${escapeHtml(v.key)}" value="${escapeHtml(values[v.key] ?? v.default ?? "")}" placeholder="${escapeHtml(v.key)}" />
      </div>`,
    )
    .join("");
}

function renderEditor(schedule: Schedule | null): void {
  const root = document.getElementById("schedule-detail");
  if (!root) return;

  const isNew = schedule === null;
  const name = schedule?.name ?? "";
  const templateId =
    schedule?.template_id ?? state.templates[0]?.id ?? "";
  const mode = (schedule?.mode as ScheduleMode) || "once";
  const values = schedule
    ? parseScheduleValues(schedule.values_json)
    : {};
  const nextLocal = schedule
    ? utcIsoToLocalDatetime(schedule.next_run_at)
    : defaultLocalDatetime(5);
  const intervalSecs = schedule?.interval_secs ?? 3600;
  const intervalUnit =
    intervalSecs % 86400 === 0
      ? "days"
      : intervalSecs % 3600 === 0
        ? "hours"
        : "minutes";
  const intervalValue =
    intervalUnit === "days"
      ? intervalSecs / 86400
      : intervalUnit === "hours"
        ? intervalSecs / 3600
        : Math.max(1, Math.round(intervalSecs / 60));

  const tmplOptions =
    state.templates.length === 0
      ? `<option value="">（请先在模版库创建模版）</option>`
      : state.templates
          .map(
            (t) =>
              `<option value="${escapeHtml(t.id)}"${t.id === templateId ? " selected" : ""}>${escapeHtml(t.name)}</option>`,
          )
          .join("");

  root.innerHTML = `
    <div class="panel-title-bar">
      <div class="panel-title">${isNew ? "新建定时任务" : escapeHtml(schedule!.name)}</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        ${
          !isNew
            ? `<button type="button" class="btn btn-secondary btn-sm" id="sched-run-now-btn">立即执行</button>
               <button type="button" class="btn btn-secondary btn-sm" id="sched-toggle-btn">${schedule!.enabled ? "暂停" : "启用"}</button>
               <button type="button" class="btn btn-secondary btn-sm" id="sched-del-btn">删除</button>`
            : ""
        }
        <button type="button" class="btn btn-primary btn-sm" id="sched-save-btn">${isNew ? "创建" : "保存"}</button>
      </div>
    </div>

    ${
      !isNew
        ? `<p style="font-size:12px; color:var(--fg-muted); margin:0 0 14px 0;">
            下次: ${escapeHtml(schedule!.next_run_at)} · 已跑 ${schedule!.run_count} 次
            ${schedule!.last_error ? ` · <span style="color:#b45309;">上次错误: ${escapeHtml(schedule!.last_error)}</span>` : ""}
          </p>`
        : ""
    }

    <div class="form-group">
      <label class="form-label">名称</label>
      <input class="form-input" id="sched-name" value="${escapeHtml(name)}" placeholder="例如: 早间竞品简报" />
    </div>

    <div class="form-group">
      <label class="form-label">模版</label>
      <select class="form-select" id="sched-template">${tmplOptions}</select>
    </div>

    <div class="form-group">
      <label class="form-label">执行方式</label>
      <select class="form-select" id="sched-mode">
        <option value="once"${mode === "once" ? " selected" : ""}>执行一次（指定时间）</option>
        <option value="interval"${mode === "interval" ? " selected" : ""}>按间隔重复</option>
      </select>
    </div>

    <div class="form-group">
      <label class="form-label" id="sched-when-label">${mode === "interval" ? "首次执行时间" : "执行时间"}</label>
      <input type="datetime-local" class="form-input" id="sched-when" value="${escapeHtml(nextLocal)}" />
    </div>

    <div class="form-group" id="sched-interval-group" style="${mode === "interval" ? "" : "display:none;"}">
      <label class="form-label">重复间隔</label>
      <div style="display:flex; gap:8px;">
        <input type="number" class="form-input" id="sched-interval-value" min="1" value="${intervalValue}" style="width:100px;" />
        <select class="form-select" id="sched-interval-unit" style="width:120px;">
          <option value="minutes"${intervalUnit === "minutes" ? " selected" : ""}>分钟</option>
          <option value="hours"${intervalUnit === "hours" ? " selected" : ""}>小时</option>
          <option value="days"${intervalUnit === "days" ? " selected" : ""}>天</option>
        </select>
      </div>
    </div>

    <div class="card-panel" style="margin:14px 0;">
      <div class="panel-title" style="margin-bottom:10px;">模版变量</div>
      <div id="sched-vars">${renderVarFields(templateId, values)}</div>
    </div>
  `;

  const modeEl = document.getElementById("sched-mode") as HTMLSelectElement | null;
  const intervalGroup = document.getElementById("sched-interval-group");
  const whenLabel = document.getElementById("sched-when-label");
  modeEl?.addEventListener("change", () => {
    const isInterval = modeEl.value === "interval";
    if (intervalGroup) intervalGroup.style.display = isInterval ? "" : "none";
    if (whenLabel)
      whenLabel.textContent = isInterval ? "首次执行时间" : "执行时间";
  });

  const tmplEl = document.getElementById(
    "sched-template",
  ) as HTMLSelectElement | null;
  tmplEl?.addEventListener("change", () => {
    const varsRoot = document.getElementById("sched-vars");
    if (varsRoot) {
      varsRoot.innerHTML = renderVarFields(tmplEl.value, {});
    }
  });

  document.getElementById("sched-save-btn")?.addEventListener("click", () => {
    void saveEditor(isNew ? null : schedule!.id);
  });
  document.getElementById("sched-del-btn")?.addEventListener("click", () => {
    if (schedule) void onDelete(schedule.id);
  });
  document.getElementById("sched-toggle-btn")?.addEventListener("click", () => {
    if (schedule) void onToggle(schedule);
  });
  document.getElementById("sched-run-now-btn")?.addEventListener("click", () => {
    if (schedule) void onRunNow(schedule.id);
  });
}

function readForm(): {
  name: string;
  templateId: string;
  mode: ScheduleMode;
  nextRunAt: string;
  intervalSecs: number | null;
  values: Record<string, string>;
} | null {
  const name = (
    document.getElementById("sched-name") as HTMLInputElement | null
  )?.value.trim();
  const templateId = (
    document.getElementById("sched-template") as HTMLSelectElement | null
  )?.value;
  const mode = (
    (document.getElementById("sched-mode") as HTMLSelectElement | null)
      ?.value || "once"
  ) as ScheduleMode;
  const whenLocal = (
    document.getElementById("sched-when") as HTMLInputElement | null
  )?.value;
  if (!name) {
    showToast("请填写名称", { kind: "error" });
    return null;
  }
  if (!templateId) {
    showToast("请选择模版", { kind: "error" });
    return null;
  }
  if (!whenLocal) {
    showToast("请选择执行时间", { kind: "error" });
    return null;
  }
  const nextRunAt = localDatetimeToUtcIso(whenLocal);
  if (!nextRunAt) {
    showToast("执行时间无效", { kind: "error" });
    return null;
  }

  let intervalSecs: number | null = null;
  if (mode === "interval") {
    const val = Number(
      (document.getElementById("sched-interval-value") as HTMLInputElement | null)
        ?.value || "1",
    );
    const unit =
      (document.getElementById("sched-interval-unit") as HTMLSelectElement | null)
        ?.value || "hours";
    const mult =
      unit === "days" ? 86400 : unit === "hours" ? 3600 : 60;
    intervalSecs = Math.max(1, Math.round(val)) * mult;
    if (intervalSecs < 60) {
      showToast("间隔至少 1 分钟", { kind: "error" });
      return null;
    }
  }

  const values: Record<string, string> = {};
  document.querySelectorAll("[data-sched-var]").forEach((el) => {
    const key = (el as HTMLElement).getAttribute("data-sched-var");
    if (key && el instanceof HTMLInputElement) values[key] = el.value;
  });

  return { name, templateId, mode, nextRunAt, intervalSecs, values };
}

async function saveEditor(id: string | null): Promise<void> {
  const form = readForm();
  if (!form) return;
  try {
    if (id) {
      const updated = await updateSchedule({
        id,
        name: form.name,
        templateId: form.templateId,
        values: form.values,
        mode: form.mode,
        intervalSecs: form.intervalSecs,
        nextRunAt: form.nextRunAt,
      });
      state.selectedId = updated.id;
      state.editingNew = false;
      showToast("定时任务已保存");
    } else {
      const created = await createSchedule({
        name: form.name,
        templateId: form.templateId,
        values: form.values,
        mode: form.mode,
        intervalSecs: form.intervalSecs,
        nextRunAt: form.nextRunAt,
        enabled: true,
      });
      state.selectedId = created.id;
      state.editingNew = false;
      showToast("定时任务已创建");
    }
    await refreshSchedules();
  } catch (e) {
    showToast(
      `保存失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
}

async function onDelete(id: string): Promise<void> {
  try {
    const confirmed = await confirmAction(
      "确定删除此定时任务？此操作无法撤销。",
      { title: "删除定时任务", confirmLabel: "删除" },
    );
    if (!confirmed) return;
    await deleteSchedule(id);
    state.selectedId = null;
    state.detail = null;
    showToast("已删除");
    await refreshSchedules();
  } catch (e) {
    showToast(
      `删除失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
}

async function onToggle(s: Schedule): Promise<void> {
  try {
    await setScheduleEnabled(s.id, !s.enabled);
    showToast(s.enabled ? "已暂停" : "已启用");
    await refreshSchedules();
  } catch (e) {
    showToast(
      `操作失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
}

async function onRunNow(id: string): Promise<void> {
  try {
    const { run_id } = await runScheduleNow(id);
    showToast(`已立即触发，run ${run_id.slice(0, 8)}…`);
    await refreshSchedules();
    showView("tasks");
  } catch (e) {
    showToast(
      `执行失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
}

export function initSchedules(): void {
  document
    .getElementById("btn-refresh-schedules")
    ?.addEventListener("click", () => {
      void refreshSchedules();
    });
  document.getElementById("btn-new-schedule")?.addEventListener("click", () => {
    state.editingNew = true;
    state.selectedId = null;
    state.detail = null;
    renderList();
    renderEditor(null);
  });
}
