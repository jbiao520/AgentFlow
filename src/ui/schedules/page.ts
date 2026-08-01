/**
 * Schedules view: list, create/edit timed template runs.
 */
import {
  createSchedule,
  deleteSchedule,
  formatInterval,
  localDatetimeToUtcIso,
  localTimeToUtc,
  listScheduleRuns,
  listSchedules,
  parseScheduleValues,
  runScheduleNow,
  setScheduleEnabled,
  updateSchedule,
  utcIsoToLocalDatetime,
  utcTimeToLocal,
  type Schedule,
  type ScheduleMode,
  type OverlapPolicy,
} from "../../lib/api/schedules";
import type { TaskRun } from "../../lib/api/tasks";
import {
  listTemplates,
  parseTemplateVariables,
  type Template,
  type TemplateVariable,
} from "../../lib/api/templates";
import {
  destroySelectsIn,
  enhanceSelectsIn,
} from "../form";
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
  history: TaskRun[];
  historyLoading: boolean;
  historyScheduleId: string | null;
  historyOpen: boolean;
};

const state: PageState = {
  schedules: [],
  templates: [],
  selectedId: null,
  detail: null,
  editingNew: false,
  history: [],
  historyLoading: false,
  historyScheduleId: null,
  historyOpen: false,
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

/** Human-readable local datetime from UTC ISO (for display only). */
function formatLocalWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(
    iso.endsWith("Z") || iso.includes("+") || iso.includes("-", 10)
      ? iso
      : `${iso}Z`,
  );
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function modeLabel(s: Schedule): string {
  if (s.mode === "interval") return formatInterval(s.interval_secs);
  if (s.mode === "cron") return `Cron ${s.cron_expr || "—"}`;
  return "执行一次";
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
    state.history = [];
    state.historyLoading = false;
    state.historyScheduleId = null;
    setHistoryOpen(false);
    renderEditor(null);
    return;
  }
  if (state.selectedId) {
    const still = state.schedules.find((s) => s.id === state.selectedId);
    if (still) {
      state.detail = still;
      renderEditor(still);
      if (state.historyOpen) void refreshScheduleHistory(still.id);
    } else {
      state.selectedId = null;
      state.detail = null;
      state.history = [];
      state.historyScheduleId = null;
      setHistoryOpen(false);
      renderEmptyDetail();
    }
  } else {
    setHistoryOpen(false);
    renderEmptyDetail();
  }
}

function renderList(): void {
  const list = document.getElementById("schedule-list");
  const count = document.getElementById("schedule-list-count");
  if (count) count.textContent = `共 ${state.schedules.length} 个`;
  if (!list) return;

  if (state.schedules.length === 0) {
    list.innerHTML = `<div class="sched-list-empty">
      <div class="sched-list-empty-title">还没有定时任务</div>
      <div class="sched-list-empty-desc">选择一个模版，设好时间后即可自动执行。</div>
    </div>`;
    return;
  }

  list.innerHTML = state.schedules
    .map((s) => {
      const tmpl = state.templates.find((t) => t.id === s.template_id);
      const active =
        !state.editingNew && s.id === state.selectedId ? " active" : "";
      const statusClass = s.enabled ? "sched-status-on" : "sched-status-off";
      const status = s.enabled ? "启用" : "暂停";
      const next = formatLocalWhen(s.next_run_at);
      return `<div class="sched-list-card${active}" data-schedule-id="${escapeHtml(s.id)}" role="button" tabindex="0">
        <div class="sched-list-card-top">
          <div class="sched-list-card-name">${escapeHtml(s.name)}</div>
          <span class="sched-status ${statusClass}">${status}</span>
        </div>
        <div class="sched-list-card-meta">
          <span class="sched-chip">${escapeHtml(tmpl?.name || s.template_id.slice(0, 8))}</span>
          <span class="sched-chip">${escapeHtml(modeLabel(s))}</span>
        </div>
        <div class="sched-list-card-next">下次 ${escapeHtml(next)}</div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-schedule-id]").forEach((el) => {
    const open = () => {
      const id = (el as HTMLElement).getAttribute("data-schedule-id");
      if (id) selectSchedule(id);
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => {
      if (
        (e as KeyboardEvent).key === "Enter" ||
        (e as KeyboardEvent).key === " "
      ) {
        e.preventDefault();
        open();
      }
    });
  });
}

function selectSchedule(id: string): void {
  state.editingNew = false;
  state.selectedId = id;
  state.detail = state.schedules.find((s) => s.id === id) ?? null;
  renderList();
  renderEditor(state.detail);
  if (state.historyOpen) void refreshScheduleHistory(id);
}

function setHistoryOpen(open: boolean): void {
  state.historyOpen = open;
  const split = document.getElementById("sched-split");
  const panel = document.getElementById("schedule-history-panel");
  if (split) split.classList.toggle("history-open", open);
  if (panel) {
    panel.hidden = !open;
    panel.setAttribute("aria-hidden", open ? "false" : "true");
  }
  const historyBtn = document.getElementById("sched-history-btn");
  if (historyBtn) {
    historyBtn.classList.toggle("active", open);
    historyBtn.setAttribute("aria-pressed", open ? "true" : "false");
  }
}

function toggleHistoryPanel(): void {
  if (state.editingNew || !state.selectedId) {
    showToast("请先选择一个定时任务", { kind: "error" });
    return;
  }
  const next = !state.historyOpen;
  setHistoryOpen(next);
  if (next && state.selectedId) {
    void refreshScheduleHistory(state.selectedId);
  }
}

function taskStatusLabel(run: TaskRun): string {
  switch (run.status) {
    case "queued":
      return "排队中";
    case "running":
      return "执行中";
    case "success":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return run.status || "未知";
  }
}

function taskStatusClass(run: TaskRun): string {
  if (run.status === "success") return "sched-run-status-success";
  if (run.status === "failed") return "sched-run-status-failed";
  if (run.status === "running" || run.status === "queued") return "sched-run-status-active";
  return "sched-run-status-muted";
}

function formatRunTime(iso: string | null): string {
  return iso ? formatLocalWhen(iso) : "等待开始";
}

function renderScheduleHistory(): void {
  const root = document.getElementById("sched-run-history");
  if (!root) return;
  if (!state.historyOpen) return;
  if (state.historyLoading) {
    root.innerHTML = `<div class="sched-history-empty">正在加载执行记录…</div>`;
    return;
  }
  if (state.history.length === 0) {
    root.innerHTML = `<div class="sched-history-empty">暂无执行记录</div>`;
    return;
  }
  root.innerHTML = state.history
    .map((run) => {
      const time = formatRunTime(run.started_at || run.finished_at);
      const detail = run.finished_at && run.started_at
        ? `结束 ${formatRunTime(run.finished_at)}`
        : run.goal_prompt || `#${run.id.slice(0, 8)}`;
      return `<button type="button" class="sched-run-row" data-sched-run-id="${escapeHtml(run.id)}">
        <span class="sched-run-row-main">
          <span class="sched-run-row-time">${escapeHtml(time)}</span>
          <span class="sched-run-row-detail">${escapeHtml(detail)}</span>
        </span>
        <span class="sched-run-row-side">
          <span class="sched-run-status ${taskStatusClass(run)}">${escapeHtml(taskStatusLabel(run))}</span>
          <span class="sched-run-trigger">${run.is_manual ? "手动" : "自动"}</span>
        </span>
      </button>`;
    })
    .join("");

  root.querySelectorAll<HTMLElement>("[data-sched-run-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const runId = el.dataset.schedRunId;
      if (runId) void import("../tasks/center").then((m) => m.openTaskRun(runId));
    });
  });
}

async function refreshScheduleHistory(scheduleId: string): Promise<void> {
  state.historyScheduleId = scheduleId;
  state.historyLoading = true;
  state.history = [];
  renderScheduleHistory();
  try {
    const history = await listScheduleRuns(scheduleId);
    if (state.historyScheduleId !== scheduleId) return;
    state.history = history;
  } catch (e) {
    if (state.historyScheduleId !== scheduleId) return;
    showToast(
      `加载执行历史失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  } finally {
    if (state.historyScheduleId === scheduleId) {
      state.historyLoading = false;
      renderScheduleHistory();
    }
  }
}

function renderEmptyDetail(): void {
  const root = document.getElementById("schedule-detail");
  if (!root) return;
  destroySelectsIn(root);
  root.innerHTML = `<div class="sched-detail-empty">
    <div class="sched-detail-empty-icon" aria-hidden="true">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="9"/>
        <path d="M12 7v5l3 2"/>
      </svg>
    </div>
    <div class="sched-detail-empty-title">选择一个定时任务</div>
    <div class="sched-detail-empty-desc">查看下次执行时间、编辑调度策略，或点击「新建定时任务」。</div>
  </div>`;
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
    return `<div class="sched-hint">此模版无变量。</div>`;
  }
  return `<div class="sched-var-grid">${vars
    .map(
      (v) => `<div class="form-group sched-var-field">
        <label class="form-label">${escapeHtml(v.label || v.key)}${v.required ? '<span class="sched-req">*</span>' : ""}</label>
        <input class="form-input" data-sched-var="${escapeHtml(v.key)}" value="${escapeHtml(values[v.key] ?? v.default ?? "")}" placeholder="${escapeHtml(v.key)}" />
      </div>`,
    )
    .join("")}</div>`;
}

function renderEditor(schedule: Schedule | null): void {
  const root = document.getElementById("schedule-detail");
  if (!root) return;

  const isNew = schedule === null;
  const name = schedule?.name ?? "";
  const templateId = schedule?.template_id ?? state.templates[0]?.id ?? "";
  const mode = (schedule?.mode as ScheduleMode) || "once";
  const cronExpr = schedule?.cron_expr ?? "";
  const windowStart = schedule ? utcTimeToLocal(schedule.window_start) : "";
  const windowEnd = schedule ? utcTimeToLocal(schedule.window_end) : "";
  const overlapPolicy = (schedule?.overlap_policy as OverlapPolicy) || "queue";
  const maxRetries = schedule?.max_retries ?? 0;
  const retryDelaySecs = schedule?.retry_delay_secs ?? 300;
  const values = schedule ? parseScheduleValues(schedule.values_json) : {};
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

  const statusBadge = !isNew
    ? `<span class="sched-status ${schedule!.enabled ? "sched-status-on" : "sched-status-off"}">${schedule!.enabled ? "启用中" : "已暂停"}</span>`
    : "";

  destroySelectsIn(root);
  root.innerHTML = `
    <div class="sched-detail">
      <header class="sched-detail-header">
        <div class="sched-detail-heading">
          <div class="sched-detail-title-row">
            <h2 class="sched-detail-name">${isNew ? "新建定时任务" : escapeHtml(schedule!.name)}</h2>
            ${statusBadge}
          </div>
          ${
            !isNew
              ? `<p class="sched-detail-summary">
                  下次 <strong>${escapeHtml(formatLocalWhen(schedule!.next_run_at))}</strong>
                  · 已跑 ${schedule!.run_count} 次
                  · ${escapeHtml(modeLabel(schedule!))}
                </p>
                ${
                  schedule!.last_error
                    ? `<p class="sched-detail-error">上次错误: ${escapeHtml(schedule!.last_error)}</p>`
                    : ""
                }`
              : `<p class="sched-detail-summary">绑定模版并设置触发方式后创建。</p>`
          }
        </div>
        <div class="sched-detail-actions">
          ${
            !isNew
              ? `<button type="button" class="btn btn-secondary btn-sm${state.historyOpen ? " active" : ""}" id="sched-history-btn" aria-pressed="${state.historyOpen ? "true" : "false"}">执行历史</button>
                 <button type="button" class="btn btn-secondary btn-sm" id="sched-run-now-btn">立即执行</button>
                 <button type="button" class="btn btn-secondary btn-sm" id="sched-toggle-btn">${schedule!.enabled ? "暂停" : "启用"}</button>
                 <button type="button" class="btn btn-secondary btn-sm sched-btn-danger" id="sched-del-btn">删除</button>`
              : ""
          }
          <button type="button" class="btn btn-primary btn-sm" id="sched-save-btn">${isNew ? "创建" : "保存"}</button>
        </div>
      </header>

      <section class="sched-section">
        <div class="sched-section-head">
          <h3 class="sched-section-title">基本信息</h3>
        </div>
        <div class="form-group">
          <label class="form-label">名称</label>
          <input class="form-input" id="sched-name" value="${escapeHtml(name)}" placeholder="例如: 早间竞品简报" />
        </div>
        <div class="form-group">
          <label class="form-label">模版</label>
          <select class="form-select" id="sched-template">${tmplOptions}</select>
        </div>
      </section>

      <section class="sched-section">
        <div class="sched-section-head">
          <h3 class="sched-section-title">触发方式</h3>
        </div>
        <div class="form-group">
          <label class="form-label">执行方式</label>
          <select class="form-select" id="sched-mode">
            <option value="once"${mode === "once" ? " selected" : ""}>执行一次（指定时间）</option>
            <option value="interval"${mode === "interval" ? " selected" : ""}>按间隔重复</option>
            <option value="cron"${mode === "cron" ? " selected" : ""}>Cron 表达式</option>
          </select>
        </div>

        <div class="form-group" id="sched-when-group" style="${mode === "cron" ? "display:none;" : ""}">
          <label class="form-label" id="sched-when-label">${mode === "interval" ? "首次执行时间" : "执行时间"}</label>
          <input type="datetime-local" class="form-input" id="sched-when" value="${escapeHtml(nextLocal)}" />
        </div>

        <div class="form-group" id="sched-interval-group" style="${mode === "interval" ? "" : "display:none;"}">
          <label class="form-label">重复间隔</label>
          <div class="sched-inline-row">
            <input type="number" class="form-input sched-num-input" id="sched-interval-value" min="1" value="${intervalValue}" />
            <select class="form-select sched-unit-select" id="sched-interval-unit">
              <option value="minutes"${intervalUnit === "minutes" ? " selected" : ""}>分钟</option>
              <option value="hours"${intervalUnit === "hours" ? " selected" : ""}>小时</option>
              <option value="days"${intervalUnit === "days" ? " selected" : ""}>天</option>
            </select>
          </div>
        </div>

        <div class="form-group" id="sched-cron-group" style="${mode === "cron" ? "" : "display:none;"}">
          <label class="form-label">Cron 表达式</label>
          <input class="form-input" id="sched-cron" value="${escapeHtml(cronExpr)}" placeholder="0 9 * * 1-5" />
          <div class="sched-field-hint">5 段：分 时 日 月 周（例如工作日 09:00）。下次执行时间由表达式自动计算。</div>
        </div>
      </section>

      <section class="sched-section">
        <div class="sched-section-head">
          <h3 class="sched-section-title">运行窗口与重叠策略</h3>
          <span class="sched-section-note">窗口使用本地时间；留空表示全天允许</span>
        </div>
        <div class="sched-inline-row sched-window-row">
          <div class="form-group sched-var-field">
            <label class="form-label">开始</label>
            <input type="time" class="form-input" id="sched-window-start" value="${escapeHtml(windowStart)}" />
          </div>
          <span class="sched-window-sep" aria-hidden="true">—</span>
          <div class="form-group sched-var-field">
            <label class="form-label">结束</label>
            <input type="time" class="form-input" id="sched-window-end" value="${escapeHtml(windowEnd)}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">任务重叠时</label>
          <select class="form-select" id="sched-overlap-policy">
            <option value="queue"${overlapPolicy === "queue" ? " selected" : ""}>等待当前运行完成后再执行</option>
            <option value="skip"${overlapPolicy === "skip" ? " selected" : ""}>跳过本次</option>
            <option value="allow"${overlapPolicy === "allow" ? " selected" : ""}>允许并行</option>
          </select>
        </div>
      </section>

      <section class="sched-section">
        <div class="sched-section-head">
          <h3 class="sched-section-title">失败重试</h3>
        </div>
        <div class="sched-inline-row">
          <div class="form-group sched-var-field">
            <label class="form-label">最多重试次数</label>
            <input type="number" class="form-input sched-num-input" id="sched-max-retries" min="0" max="20" value="${maxRetries}" />
          </div>
          <div class="form-group sched-var-field">
            <label class="form-label">重试间隔（分钟）</label>
            <input type="number" class="form-input sched-num-input" id="sched-retry-delay" min="1" max="1440" value="${Math.max(1, Math.round(retryDelaySecs / 60))}" />
          </div>
        </div>
      </section>

      <section class="sched-section">
        <div class="sched-section-head">
          <h3 class="sched-section-title">模版变量</h3>
          <span class="sched-section-note">触发时注入到模版</span>
        </div>
        <div id="sched-vars">${renderVarFields(templateId, values)}</div>
      </section>
    </div>
  `;

  const modeEl = document.getElementById("sched-mode") as HTMLSelectElement | null;
  const intervalGroup = document.getElementById("sched-interval-group");
  const cronGroup = document.getElementById("sched-cron-group");
  const whenGroup = document.getElementById("sched-when-group");
  const whenLabel = document.getElementById("sched-when-label");
  modeEl?.addEventListener("change", () => {
    const isInterval = modeEl.value === "interval";
    const isCron = modeEl.value === "cron";
    if (intervalGroup) intervalGroup.style.display = isInterval ? "" : "none";
    if (cronGroup) cronGroup.style.display = isCron ? "" : "none";
    if (whenGroup) whenGroup.style.display = isCron ? "none" : "";
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
  document.getElementById("sched-history-btn")?.addEventListener("click", () => {
    toggleHistoryPanel();
  });

  enhanceSelectsIn(root);
}

function readForm(): {
  name: string;
  templateId: string;
  mode: ScheduleMode;
  nextRunAt: string;
  intervalSecs: number | null;
  values: Record<string, string>;
  cronExpr: string;
  windowStart: string;
  windowEnd: string;
  overlapPolicy: OverlapPolicy;
  maxRetries: number;
  retryDelaySecs: number;
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
  const cronExpr =
    (document.getElementById("sched-cron") as HTMLInputElement | null)?.value.trim() ||
    "";
  const windowStartLocal =
    (document.getElementById("sched-window-start") as HTMLInputElement | null)
      ?.value || "";
  const windowEndLocal =
    (document.getElementById("sched-window-end") as HTMLInputElement | null)
      ?.value || "";
  if (!name) {
    showToast("请填写名称", { kind: "error" });
    return null;
  }
  if (!templateId) {
    showToast("请选择模版", { kind: "error" });
    return null;
  }

  // Cron first-fire is computed server-side from the expression; the datetime
  // field is hidden and only a placeholder is sent for API compatibility.
  let nextRunAt: string;
  if (mode === "cron") {
    nextRunAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  } else {
    if (!whenLocal) {
      showToast("请选择执行时间", { kind: "error" });
      return null;
    }
    const parsed = localDatetimeToUtcIso(whenLocal);
    if (!parsed) {
      showToast("执行时间无效", { kind: "error" });
      return null;
    }
    nextRunAt = parsed;
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
    const mult = unit === "days" ? 86400 : unit === "hours" ? 3600 : 60;
    intervalSecs = Math.max(1, Math.round(val)) * mult;
    if (intervalSecs < 60) {
      showToast("间隔至少 1 分钟", { kind: "error" });
      return null;
    }
  }

  if (mode === "cron" && !cronExpr) {
    showToast("请填写 Cron 表达式", { kind: "error" });
    return null;
  }
  if (
    (windowStartLocal && !windowEndLocal) ||
    (!windowStartLocal && windowEndLocal)
  ) {
    showToast("运行窗口需要同时填写开始和结束时间", { kind: "error" });
    return null;
  }
  const maxRetries = Math.min(
    20,
    Math.max(
      0,
      Math.round(
        Number(
          (document.getElementById("sched-max-retries") as HTMLInputElement | null)
            ?.value || "0",
        ),
      ),
    ),
  );
  const retryDelaySecs = Math.min(
    86400,
    Math.max(
      60,
      Math.round(
        Number(
          (document.getElementById("sched-retry-delay") as HTMLInputElement | null)
            ?.value || "5",
        ) * 60,
      ),
    ),
  );
  const overlapPolicy = ((
    document.getElementById("sched-overlap-policy") as HTMLSelectElement | null
  )?.value || "queue") as OverlapPolicy;

  const values: Record<string, string> = {};
  document.querySelectorAll("[data-sched-var]").forEach((el) => {
    const key = (el as HTMLElement).getAttribute("data-sched-var");
    if (key && el instanceof HTMLInputElement) values[key] = el.value;
  });

  return {
    name,
    templateId,
    mode,
    nextRunAt,
    intervalSecs,
    values,
    cronExpr,
    windowStart: localTimeToUtc(windowStartLocal),
    windowEnd: localTimeToUtc(windowEndLocal),
    overlapPolicy,
    maxRetries,
    retryDelaySecs,
  };
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
        cronExpr: form.cronExpr,
        windowStart: form.windowStart,
        windowEnd: form.windowEnd,
        overlapPolicy: form.overlapPolicy,
        maxRetries: form.maxRetries,
        retryDelaySecs: form.retryDelaySecs,
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
        cronExpr: form.cronExpr,
        windowStart: form.windowStart,
        windowEnd: form.windowEnd,
        overlapPolicy: form.overlapPolicy,
        maxRetries: form.maxRetries,
        retryDelaySecs: form.retryDelaySecs,
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
    state.history = [];
    state.historyScheduleId = null;
    setHistoryOpen(false);
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
  void refreshSchedules();
  document
    .getElementById("btn-refresh-schedules")
    ?.addEventListener("click", () => {
      void refreshSchedules();
    });
  document.getElementById("btn-new-schedule")?.addEventListener("click", () => {
    state.editingNew = true;
    state.selectedId = null;
    state.detail = null;
    state.history = [];
    state.historyLoading = false;
    state.historyScheduleId = null;
    setHistoryOpen(false);
    renderList();
    renderEditor(null);
  });
  document
    .getElementById("sched-history-close-btn")
    ?.addEventListener("click", () => {
      setHistoryOpen(false);
    });
}
