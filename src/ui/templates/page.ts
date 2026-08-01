/**
 * Template library view: list, detail, run, manage.
 */
import type { PlanAnalysis } from "../../lib/api/orchestrate";
import {
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  instantiateTemplate,
  listTemplates,
  parseTemplateVariables,
  updateTemplate,
  type Template,
  type TemplateVariable,
} from "../../lib/api/templates";
import {
  renderPlanWorkbench,
  setOrchestrateResult,
} from "../orchestrator/workbench";
import { showView } from "../router";
import { formatActionableError, showToast } from "../toast";
import { updateTemplateNavCount } from "../nav-counts";
import { renderPlanDag } from "../tasks/dag";
import { confirmAction } from "../modals";

type LibState = {
  templates: Template[];
  selectedId: string | null;
  detail: Template | null;
  variables: TemplateVariable[];
  launching: boolean;
};

const state: LibState = {
  templates: [],
  selectedId: null,
  detail: null,
  variables: [],
  launching: false,
};

// Multiple navigation/init/delete paths can refresh concurrently. Only the
// newest response is allowed to update the library state.
let templateRefreshGeneration = 0;
let templateDetailGeneration = 0;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parsePlan(json: string): PlanAnalysis | null {
  try {
    return JSON.parse(json) as PlanAnalysis;
  } catch {
    return null;
  }
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(t).toLocaleDateString();
}

function sourceLabel(t: Template): string {
  if (t.source_run_id) return "来自任务";
  if (t.source_plan_id) return "来自调度";
  return "手动";
}

export async function refreshTemplateLibrary(): Promise<void> {
  const generation = ++templateRefreshGeneration;
  try {
    const templates = await listTemplates();
    if (generation !== templateRefreshGeneration) return;
    state.templates = templates;
  } catch (e) {
    if (generation !== templateRefreshGeneration) return;
    state.templates = [];
    showToast(
      `加载模版失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
  updateTemplateNavCount(state.templates.length);
  renderList();
  if (state.selectedId) {
    const still = state.templates.find((t) => t.id === state.selectedId);
    if (still) await selectTemplate(still.id);
    else {
      state.selectedId = null;
      state.detail = null;
      renderDetail();
    }
  } else {
    renderDetail();
  }
}

function renderList(): void {
  const list = document.getElementById("template-list");
  const count = document.getElementById("template-list-count");
  if (count) count.textContent = `共 ${state.templates.length} 个`;
  if (!list) return;

  if (state.templates.length === 0) {
    list.innerHTML = `<div class="tpl-list-empty">
      <div class="tpl-list-empty-title">还没有模版</div>
      <div class="tpl-list-empty-desc">从任务中心或调度中枢将已执行的 Plan「保存为模版」。</div>
    </div>`;
    return;
  }

  list.innerHTML = state.templates
    .map((t) => {
      const vars = parseTemplateVariables(t.variables_json);
      const plan = parsePlan(t.plan_json);
      const nodes = plan?.subtasks?.length ?? 0;
      const active = t.id === state.selectedId ? " active" : "";
      const desc = t.description?.trim() || "无描述";
      return `<div class="tpl-list-card${active}" data-template-id="${escapeHtml(t.id)}" role="button" tabindex="0">
        <div class="tpl-list-card-top">
          <div class="tpl-list-card-name">${escapeHtml(t.name)}</div>
          <span class="tpl-list-source">${escapeHtml(sourceLabel(t))}</span>
        </div>
        <div class="tpl-list-card-desc">${escapeHtml(desc)}</div>
        <div class="tpl-list-card-meta">
          <span class="tpl-chip">${vars.length} 变量</span>
          <span class="tpl-chip">${nodes} 节点</span>
          <span class="tpl-list-time">${escapeHtml(formatRelative(t.updated_at))}</span>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-template-id]").forEach((el) => {
    const open = () => {
      const id = (el as HTMLElement).getAttribute("data-template-id");
      if (id) void selectTemplate(id);
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

async function selectTemplate(id: string): Promise<void> {
  if (state.launching) return;
  const generation = ++templateDetailGeneration;
  state.selectedId = id;
  renderList();
  let detail: Template | null = null;
  try {
    detail = await getTemplate(id);
  } catch (e) {
    if (generation !== templateDetailGeneration || state.selectedId !== id) return;
    state.detail = null;
    showToast(
      `读取模版失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
  if (generation !== templateDetailGeneration || state.selectedId !== id) return;
  state.detail = detail;
  state.variables = state.detail
    ? parseTemplateVariables(state.detail.variables_json)
    : [];
  renderDetail();
}

function renderDetail(): void {
  const root = document.getElementById("template-detail");
  if (!root) return;
  const t = state.detail;
  if (!t) {
    root.innerHTML = `<div class="tpl-detail-empty">
      <div class="tpl-detail-empty-icon" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M4 5h16v4H4zM4 11h10v8H4zM16 11h4v8h-4z"/>
        </svg>
      </div>
      <div class="tpl-detail-empty-title">选择一个模版</div>
      <div class="tpl-detail-empty-desc">查看 DAG、填写变量后一键执行，或编辑 Goal / Prompt 文案。</div>
    </div>`;
    return;
  }

  const plan = parsePlan(t.plan_json);
  const nodeCount = plan?.subtasks?.length ?? 0;
  const intent = plan?.intent?.summary?.trim();

  const varForm =
    state.variables.length === 0
      ? `<div class="tpl-hint">此模版无变量，可直接执行。</div>`
      : `<div class="tpl-var-grid">${state.variables
          .map(
            (v) => `<div class="form-group tpl-var-field">
              <label class="form-label">${escapeHtml(v.label || v.key)}${v.required ? '<span class="tpl-req">*</span>' : ""}</label>
              <input class="form-input" data-run-var="${escapeHtml(v.key)}" value="${escapeHtml(v.default ?? "")}" placeholder="${escapeHtml(v.key)}" />
            </div>`,
          )
          .join("")}</div>`;

  const promptEditors = (plan?.subtasks ?? [])
    .map(
      (st, i) => `<div class="tpl-prompt-block" data-prompt-block="${escapeHtml(st.id)}">
        <div class="tpl-prompt-head">
          <span class="tpl-prompt-idx">${i + 1}</span>
          <div class="tpl-prompt-titles">
            <div class="tpl-prompt-title">${escapeHtml(st.title)}</div>
            <div class="tpl-prompt-sub">${escapeHtml(st.agent)}${(st.depends_on || []).length ? ` · deps: ${(st.depends_on || []).join(", ")}` : ""}</div>
          </div>
        </div>
        <textarea class="form-textarea tpl-prompt-ta" rows="3" data-edit-prompt="${escapeHtml(st.id)}">${escapeHtml(st.prompt ?? "")}</textarea>
      </div>`,
    )
    .join("");

  root.innerHTML = `
    <div class="tpl-detail">
      <header class="tpl-detail-header">
        <div class="tpl-detail-heading">
          <h2 class="tpl-detail-name">${escapeHtml(t.name)}</h2>
          <p class="tpl-detail-desc">${escapeHtml(t.description || "无描述")}</p>
          <div class="tpl-detail-badges">
            <span class="tpl-chip">${state.variables.length} 变量</span>
            <span class="tpl-chip">${nodeCount} DAG 节点</span>
            <span class="tpl-chip muted">${escapeHtml(sourceLabel(t))}</span>
            <span class="tpl-chip muted">更新于 ${escapeHtml(formatRelative(t.updated_at))}</span>
          </div>
          ${intent ? `<p class="tpl-intent">${escapeHtml(intent)}</p>` : ""}
        </div>
        <div class="tpl-detail-actions">
          <button type="button" class="btn btn-primary btn-sm" id="tpl-run-btn">执行</button>
          <button type="button" class="btn btn-secondary btn-sm" id="tpl-preview-btn">先预览</button>
          <button type="button" class="btn btn-secondary btn-sm" id="tpl-save-edits-btn">保存修改</button>
          <button type="button" class="btn btn-secondary btn-sm" id="tpl-dup-btn">复制</button>
          <button type="button" class="btn btn-secondary btn-sm tpl-btn-danger" id="tpl-del-btn">删除</button>
        </div>
      </header>

      <section class="tpl-section">
        <div class="tpl-section-head">
          <h3 class="tpl-section-title">执行变量</h3>
          <span class="tpl-section-note">运行前填入；不会改动模版本身</span>
        </div>
        ${varForm}
      </section>

      <section class="tpl-section">
        <div class="tpl-section-head">
          <h3 class="tpl-section-title">任务依赖拓扑</h3>
          <span class="tpl-section-note">只读 · 结构锁定</span>
        </div>
        <div class="tpl-dag-wrap" id="tpl-dag-container"></div>
      </section>

      <section class="tpl-section">
        <div class="tpl-section-head">
          <h3 class="tpl-section-title">Goal / Prompts</h3>
          <span class="tpl-section-note">可编辑文案；DAG 结构不可改</span>
        </div>
        <div class="tpl-edit-grid">
          <div class="form-group">
            <label class="form-label">名称</label>
            <input class="form-input" id="tpl-edit-name" value="${escapeHtml(t.name)}" />
          </div>
          <div class="form-group">
            <label class="form-label">描述</label>
            <input class="form-input" id="tpl-edit-desc" value="${escapeHtml(t.description || "")}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Goal Prompt</label>
          <textarea class="form-textarea tpl-prompt-ta" id="tpl-edit-goal" rows="3">${escapeHtml(t.goal_prompt)}</textarea>
        </div>
        <div class="tpl-prompt-list">${promptEditors || '<div class="tpl-hint">无子任务 Prompt</div>'}</div>
      </section>
    </div>
  `;

  const dagEl = document.getElementById("tpl-dag-container");
  if (dagEl) renderPlanDag(dagEl, plan?.subtasks ?? []);

  document.getElementById("tpl-run-btn")?.addEventListener("click", () => {
    void runSelected(true);
  });
  document.getElementById("tpl-preview-btn")?.addEventListener("click", () => {
    void runSelected(false);
  });
  document.getElementById("tpl-save-edits-btn")?.addEventListener("click", () => {
    void saveEdits();
  });
  document.getElementById("tpl-dup-btn")?.addEventListener("click", () => {
    void onDuplicate();
  });
  document.getElementById("tpl-del-btn")?.addEventListener("click", () => {
    void onDelete();
  });
}

function collectRunValues(): Record<string, string> {
  const values: Record<string, string> = {};
  document.querySelectorAll("[data-run-var]").forEach((el) => {
    const key = (el as HTMLElement).getAttribute("data-run-var");
    if (key) values[key] = (el as HTMLInputElement).value;
  });
  return values;
}

/** Yield two frames so spinner/overlay paint before heavy IPC. */
function yieldForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function setLaunchBusy(busy: boolean, mode: "run" | "preview" | null): void {
  state.launching = busy;
  const panel = document.getElementById("template-detail");
  const runBtn = document.getElementById("tpl-run-btn") as HTMLButtonElement | null;
  const previewBtn = document.getElementById(
    "tpl-preview-btn",
  ) as HTMLButtonElement | null;
  const saveBtn = document.getElementById(
    "tpl-save-edits-btn",
  ) as HTMLButtonElement | null;
  const dupBtn = document.getElementById("tpl-dup-btn") as HTMLButtonElement | null;
  const delBtn = document.getElementById("tpl-del-btn") as HTMLButtonElement | null;

  panel?.classList.toggle("is-launching", busy);

  let overlay = document.getElementById("tpl-launch-overlay");
  if (busy) {
    if (!overlay && panel) {
      overlay = document.createElement("div");
      overlay.id = "tpl-launch-overlay";
      overlay.className = "tpl-launch-overlay";
      overlay.setAttribute("role", "status");
      overlay.setAttribute("aria-live", "polite");
      panel.appendChild(overlay);
    }
    if (overlay) {
      const label =
        mode === "preview" ? "正在生成预览 Plan…" : "正在启动模版执行…";
      overlay.innerHTML = `
        <div class="tpl-launch-card">
          <span class="tpl-launch-spinner" aria-hidden="true"></span>
          <div class="tpl-launch-text">
            <div class="tpl-launch-title">${label}</div>
            <div class="tpl-launch-sub">实例化变量 · 校验 Plan · ${mode === "preview" ? "跳转调度中枢" : "分发并启动 DAG"}</div>
          </div>
        </div>`;
    }
  } else {
    overlay?.remove();
  }

  const actionBtns = [runBtn, previewBtn, saveBtn, dupBtn, delBtn];
  for (const btn of actionBtns) {
    if (!btn) continue;
    btn.disabled = busy;
    btn.classList.remove("is-busy");
  }

  if (busy && mode === "run" && runBtn) {
    runBtn.classList.add("is-busy");
    runBtn.innerHTML =
      '<span class="btn-spinner" aria-hidden="true"></span>启动中…';
  } else if (runBtn && !busy) {
    runBtn.textContent = "执行";
  }

  if (busy && mode === "preview" && previewBtn) {
    previewBtn.classList.add("is-busy");
    previewBtn.innerHTML =
      '<span class="btn-spinner" aria-hidden="true"></span>预览中…';
  } else if (previewBtn && !busy) {
    previewBtn.textContent = "先预览";
  }
}

async function runSelected(dispatch: boolean): Promise<void> {
  if (!state.detail || state.launching) return;
  const values = collectRunValues();
  setLaunchBusy(true, dispatch ? "run" : "preview");
  await yieldForPaint();

  try {
    const result = await instantiateTemplate({
      templateId: state.detail.id,
      values,
      dispatch,
    });
    if (!result.orchestrate.ok) {
      showToast(
        `实例化失败: ${formatActionableError(result.orchestrate.error || "unknown")}`,
        { kind: "error" },
      );
      setLaunchBusy(false, null);
      return;
    }
    if (dispatch) {
      const runId = result.started?.run_id || result.dispatch?.run.id;
      showToast("模版已启动执行", { kind: "success" });
      showView("tasks");
      if (runId) {
        window.dispatchEvent(
          new CustomEvent("agentmind:run-started", { detail: { runId } }),
        );
      }
      // Navigated away — leave overlay; next selectTemplate will rebuild detail.
      state.launching = false;
    } else {
      setOrchestrateResult(result.orchestrate);
      if (result.orchestrate.plan) {
        renderPlanWorkbench(
          result.orchestrate.plan,
          result.orchestrate.warnings || [],
        );
      }
      showToast("已生成 Plan，请在调度中枢确认后分发", { kind: "success" });
      showView("commander");
      state.launching = false;
    }
  } catch (e) {
    setLaunchBusy(false, null);
    showToast(
      `执行失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
}

async function saveEdits(): Promise<void> {
  if (!state.detail) return;
  const name = (
    document.getElementById("tpl-edit-name") as HTMLInputElement | null
  )?.value.trim();
  const description = (
    document.getElementById("tpl-edit-desc") as HTMLInputElement | null
  )?.value.trim();
  const goalPrompt = (
    document.getElementById("tpl-edit-goal") as HTMLTextAreaElement | null
  )?.value;
  const plan = parsePlan(state.detail.plan_json);
  if (plan) {
    document.querySelectorAll("[data-edit-prompt]").forEach((ta) => {
      const id = (ta as HTMLElement).getAttribute("data-edit-prompt");
      const st = plan.subtasks.find((s) => s.id === id);
      if (st) st.prompt = (ta as HTMLTextAreaElement).value;
    });
  }
  try {
    await updateTemplate({
      id: state.detail.id,
      name: name || state.detail.name,
      description: description ?? "",
      goalPrompt: goalPrompt ?? state.detail.goal_prompt,
      planJson: plan ? JSON.stringify(plan) : state.detail.plan_json,
    });
    showToast("模版已更新", { kind: "success" });
    await refreshTemplateLibrary();
  } catch (e) {
    showToast(
      `更新失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
}

async function onDuplicate(): Promise<void> {
  if (!state.detail) return;
  try {
    const dup = await duplicateTemplate(state.detail.id);
    showToast("已复制模版", { kind: "success" });
    await refreshTemplateLibrary();
    await selectTemplate(dup.id);
  } catch (e) {
    showToast(
      `复制失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
}

async function onDelete(): Promise<void> {
  const template = state.detail;
  if (!template) return;
  try {
    const confirmed = await confirmAction(
      `删除模版「${template.name}」？此操作无法撤销。`,
      { title: "删除模版", confirmLabel: "删除" },
    );
    if (!confirmed) return;
    await deleteTemplate(template.id);
    // Invalidate any in-flight detail/list response started before deletion.
    templateDetailGeneration += 1;
    templateRefreshGeneration += 1;
    state.selectedId = null;
    state.detail = null;
    showToast("模版已删除", { kind: "success" });
    await refreshTemplateLibrary();
  } catch (e) {
    showToast(
      `删除失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
}

export function initTemplateLibrary(): void {
  void refreshTemplateLibrary();
  document
    .getElementById("btn-refresh-templates")
    ?.addEventListener("click", () => {
      void refreshTemplateLibrary();
    });
}
