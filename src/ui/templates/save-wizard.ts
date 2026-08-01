/**
 * Save-as-template wizard modal.
 */
import {
  createTemplate,
  polishTemplate,
  type PolishTemplateResult,
  type TemplateVariable,
} from "../../lib/api/templates";
import type { PlanAnalysis } from "../../lib/api/orchestrate";
import { formatActionableError, showToast } from "../toast";
import { showView } from "../router";
import { refreshTemplateLibrary } from "./page";

export type SaveTemplateSource = {
  goalId?: string | null;
  planId?: string | null;
  runId?: string | null;
  goalPrompt?: string | null;
  planJson?: string | null;
};

type WizardState = {
  source: SaveTemplateSource;
  polishMeta: PolishTemplateResult | null;
  name: string;
  description: string;
  goalPrompt: string;
  planJson: string;
  variables: TemplateVariable[];
  busy: boolean;
};

const state: WizardState = {
  source: {},
  polishMeta: null,
  name: "",
  description: "",
  goalPrompt: "",
  planJson: "",
  variables: [],
  busy: false,
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function overlay(): HTMLElement | null {
  return document.getElementById("template-save-modal");
}

function body(): HTMLElement | null {
  return document.getElementById("template-save-body");
}

export function closeSaveTemplateModal(event?: Event): void {
  if (event) {
    const t = event.target as HTMLElement | null;
    if (t && t.id !== "template-save-modal") return;
  }
  const modal = overlay();
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

function setBusy(busy: boolean): void {
  state.busy = busy;
}

function parsePlan(planJson: string): PlanAnalysis | null {
  try {
    return JSON.parse(planJson) as PlanAnalysis;
  } catch {
    return null;
  }
}

function renderLoading(msg: string): void {
  const el = body();
  if (!el) return;
  el.innerHTML = `<div style="padding:24px; text-align:center; color:var(--fg-muted); font-size:13px;">${escapeHtml(msg)}</div>`;
}

function renderConfirm(): void {
  const el = body();
  if (!el) return;
  const plan = parsePlan(state.planJson);
  const subtasks = plan?.subtasks ?? [];
  const dagReadonly = subtasks
    .map(
      (st, i) =>
        `<div style="font-size:11.5px; font-family:var(--font-mono); color:var(--fg-secondary); margin-bottom:4px;">${i + 1}. [${escapeHtml(st.agent)}] ${escapeHtml(st.title)} ← depends: [${escapeHtml((st.depends_on || []).join(", ") || "—")}]</div>`,
    )
    .join("");

  const varRows =
    state.variables.length === 0
      ? `<div style="font-size:12px; color:var(--fg-muted); margin-bottom:8px;">暂无变量 — 可在下方添加，或在文案中使用 {{snake_case}}</div>`
      : state.variables
          .map(
            (v, i) => `<div class="tpl-var-row" data-var-idx="${i}" style="display:grid; grid-template-columns:1fr 1fr 70px 1fr auto; gap:6px; margin-bottom:6px; align-items:center;">
              <input class="form-input" data-field="key" value="${escapeHtml(v.key)}" placeholder="key" />
              <input class="form-input" data-field="label" value="${escapeHtml(v.label)}" placeholder="标签" />
              <label style="font-size:11px; display:flex; align-items:center; gap:4px;"><input type="checkbox" data-field="required" ${v.required ? "checked" : ""}/>必填</label>
              <input class="form-input" data-field="default" value="${escapeHtml(v.default ?? "")}" placeholder="默认值" />
              <button type="button" class="btn btn-secondary btn-sm" data-remove-var="${i}">删</button>
            </div>`,
          )
          .join("");

  const promptEditors = subtasks
    .map((st, i) => {
      const prompt = st.prompt ?? "";
      return `<div class="form-group">
        <label class="form-label">子任务 ${i + 1} prompt · ${escapeHtml(st.title)} (${escapeHtml(st.id)})</label>
        <textarea class="form-textarea" rows="3" data-subtask-prompt="${escapeHtml(st.id)}" style="font-family:var(--font-mono); font-size:11.5px;">${escapeHtml(prompt)}</textarea>
      </div>`;
    })
    .join("");

  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h3 style="font-size:15px; font-weight:700; color:var(--fg-primary); margin:0;">确认并保存模版</h3>
      <button type="button" class="btn btn-secondary btn-sm" id="tpl-save-close">关闭</button>
    </div>
    <div class="form-group">
      <label class="form-label">名称</label>
      <input type="text" class="form-input" id="tpl-save-name" value="${escapeHtml(state.name)}" />
    </div>
    <div class="form-group">
      <label class="form-label">描述</label>
      <input type="text" class="form-input" id="tpl-save-desc" value="${escapeHtml(state.description)}" />
    </div>
    <div class="form-group">
      <label class="form-label">Goal Prompt</label>
      <textarea class="form-textarea" id="tpl-save-goal" rows="3" style="font-family:var(--font-mono); font-size:11.5px;">${escapeHtml(state.goalPrompt)}</textarea>
    </div>
    <div style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <label class="form-label" style="margin:0;">变量</label>
        <button type="button" class="btn btn-secondary btn-sm" id="tpl-add-var">添加变量</button>
      </div>
      <div id="tpl-var-list">${varRows}</div>
    </div>
    ${promptEditors}
    <div class="form-group">
      <label class="form-label">DAG 结构（只读）</label>
      <div style="background:var(--bg-muted, #f8fafc); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:10px; max-height:120px; overflow:auto;">
        ${dagReadonly || '<span style="color:var(--fg-muted); font-size:12px;">无子任务</span>'}
      </div>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
      <button type="button" class="btn btn-secondary" id="tpl-save-cancel">取消</button>
      <button type="button" class="btn btn-primary" id="tpl-save-confirm">保存模版</button>
    </div>
  `;

  el.querySelector("#tpl-save-close")?.addEventListener("click", () =>
    closeSaveTemplateModal(),
  );
  el.querySelector("#tpl-save-cancel")?.addEventListener("click", () =>
    closeSaveTemplateModal(),
  );
  el.querySelector("#tpl-add-var")?.addEventListener("click", () => {
    readFormIntoState();
    state.variables.push({
      key: "new_var",
      label: "新变量",
      required: true,
      default: null,
    });
    renderConfirm();
  });
  el.querySelectorAll("[data-remove-var]").forEach((btn) => {
    btn.addEventListener("click", () => {
      readFormIntoState();
      const idx = Number((btn as HTMLElement).getAttribute("data-remove-var"));
      state.variables.splice(idx, 1);
      renderConfirm();
    });
  });
  el.querySelector("#tpl-save-confirm")?.addEventListener("click", () => {
    void commitSave();
  });
}

function readFormIntoState(): void {
  const nameEl = document.getElementById("tpl-save-name") as HTMLInputElement | null;
  const descEl = document.getElementById("tpl-save-desc") as HTMLInputElement | null;
  const goalEl = document.getElementById(
    "tpl-save-goal",
  ) as HTMLTextAreaElement | null;
  if (nameEl) state.name = nameEl.value;
  if (descEl) state.description = descEl.value;
  if (goalEl) state.goalPrompt = goalEl.value;

  const vars: TemplateVariable[] = [];
  document.querySelectorAll(".tpl-var-row").forEach((row) => {
    const key = (
      row.querySelector('[data-field="key"]') as HTMLInputElement | null
    )?.value.trim() || "";
    const label = (
      row.querySelector('[data-field="label"]') as HTMLInputElement | null
    )?.value.trim() || key;
    const required = !!(
      row.querySelector('[data-field="required"]') as HTMLInputElement | null
    )?.checked;
    const def =
      (
        row.querySelector('[data-field="default"]') as HTMLInputElement | null
      )?.value.trim() || "";
    if (key) {
      vars.push({
        key,
        label,
        required,
        default: def || null,
      });
    }
  });
  state.variables = vars;

  const plan = parsePlan(state.planJson);
  if (plan) {
    document.querySelectorAll("[data-subtask-prompt]").forEach((ta) => {
      const id = (ta as HTMLElement).getAttribute("data-subtask-prompt");
      const st = plan.subtasks.find((s) => s.id === id);
      if (st) st.prompt = (ta as HTMLTextAreaElement).value;
    });
    state.planJson = JSON.stringify(plan);
  }
}

async function commitSave(): Promise<void> {
  if (state.busy) return;
  readFormIntoState();
  if (!state.name.trim()) {
    showToast("请填写模版名称", { kind: "error" });
    return;
  }
  setBusy(true);
  try {
    await createTemplate({
      name: state.name.trim(),
      description: state.description.trim() || null,
      sourceGoalId: state.polishMeta?.source_goal_id ?? state.source.goalId,
      sourcePlanId: state.polishMeta?.source_plan_id ?? state.source.planId,
      sourceRunId: state.polishMeta?.source_run_id ?? state.source.runId,
      goalPrompt: state.goalPrompt,
      planJson: state.planJson,
      variablesJson: JSON.stringify(state.variables),
    });
    showToast("模版已保存", { kind: "success" });
    closeSaveTemplateModal();
    void refreshTemplateLibrary();
    showView("templates");
  } catch (e) {
    showToast(
      `保存失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  } finally {
    setBusy(false);
  }
}

function applyPolish(result: PolishTemplateResult): void {
  state.polishMeta = result;
  const p = result.polish;
  if (!p.ok) {
    showToast(
      `AI 润色失败: ${formatActionableError(p.error || "unknown")} — 已载入原文，可手动编辑`,
      { kind: "error" },
    );
    // fall back handled by caller via skip
    return;
  }
  state.name = p.name || "未命名模版";
  state.description = p.description || "";
  state.goalPrompt = p.goal_prompt || state.goalPrompt;
  state.planJson = p.plan_json || state.planJson;
  state.variables = p.variables || [];
}

export async function openSaveTemplateWizard(
  source: SaveTemplateSource,
  opts?: { skipAi?: boolean },
): Promise<void> {
  const modal = overlay();
  if (!modal) return;
  state.source = source;
  state.polishMeta = null;
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  renderLoading(opts?.skipAi ? "准备模版…" : "AI 正在润色模版…");

  try {
    let result = await polishTemplate({
      goalId: source.goalId,
      planId: source.planId,
      runId: source.runId,
      goalPrompt: source.goalPrompt,
      planJson: source.planJson,
      skipAi: opts?.skipAi ?? false,
    });
    if (!result.polish.ok && !opts?.skipAi) {
      const skip = await polishTemplate({
        goalId: source.goalId,
        planId: source.planId,
        runId: source.runId,
        goalPrompt: source.goalPrompt,
        planJson: source.planJson,
        skipAi: true,
      });
      applyPolish(result); // toast error
      result = skip;
    }
    applyPolish(result);
    if (!state.goalPrompt && source.goalPrompt) {
      state.goalPrompt = source.goalPrompt;
    }
    if (!state.planJson && source.planJson) {
      state.planJson = source.planJson;
    }
    // If skip path and still empty goal from ids-only, polish returns them
    if (!result.polish.ok) {
      renderLoading(`无法准备模版: ${result.polish.error || "unknown"}`);
      return;
    }
    renderConfirm();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    renderLoading(`准备失败: ${msg}`);
    showToast(`保存模版失败: ${formatActionableError(msg)}`, { kind: "error" });
  }
}

export function initSaveTemplateWizard(): void {
  document
    .getElementById("template-save-modal")
    ?.addEventListener("click", (e) => closeSaveTemplateModal(e));
}
