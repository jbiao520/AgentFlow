/**
 * Commander workbench: Orchestrate → optional clarification Q&A → Dispatch / Start.
 */
import {
  confirmPlanAnswers,
  orchestrate,
  orchestrateFromJson,
  type OrchestrateResult,
  type PlanAnalysis,
  type PlanClarification,
  type PlanQuestion,
} from "../../lib/api/orchestrate";
import { dispatchPlan, startRun } from "../../lib/api/tasks";
import { showView } from "../router";
import { formatActionableError, showToast } from "../toast";

export type WorkbenchState = {
  result: OrchestrateResult | null;
};

const state: WorkbenchState = { result: null };

function setDispatchEnabled(enabled: boolean, reason?: string): void {
  const btn = document.getElementById(
    "dispatch-plan-btn",
  ) as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = !enabled;
  btn.title = enabled
    ? "确认并分发当前 Plan"
    : reason || "没有可分发的有效 Plan — 请先 Orchestrate";
  btn.style.opacity = enabled ? "1" : "0.55";
  btn.style.cursor = enabled ? "pointer" : "not-allowed";
}

export function getLastOrchestrateResult(): OrchestrateResult | null {
  return state.result;
}

/** Used by template preview to hydrate Commander with an instantiated Plan. */
export function setOrchestrateResult(result: OrchestrateResult | null): void {
  state.result = result;
  const planId = result?.plan_row?.id;
  const planOk = !!(result?.ok && result?.plan && planId);
  setDispatchEnabled(
    planOk,
    planOk ? undefined : "没有可分发的有效 Plan — 请先 Orchestrate",
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function agentColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const palette = ["#d97706", "#2563eb", "#059669", "#7c3aed", "#dc2626"];
  return palette[h % palette.length];
}

function planQuestions(plan: PlanAnalysis): PlanQuestion[] {
  return Array.isArray(plan.questions) ? plan.questions : [];
}

async function goToTaskRun(runId: string, nodeCount: number): Promise<void> {
  showToast(`已分发 ${nodeCount} 个节点，开始执行`, { kind: "success" });
  showView("tasks");
  window.dispatchEvent(
    new CustomEvent("agentmind:run-started", {
      detail: { runId },
    }),
  );
}

async function dispatchCurrentPlan(): Promise<void> {
  const planId = state.result?.plan_row?.id;
  const planOk = !!(state.result?.ok && state.result?.plan && planId);
  if (!planOk || !planId) {
    showToast("没有可分发的 Plan — 请先 Orchestrate", { kind: "error" });
    setDispatchEnabled(false);
    return;
  }
  const questions = planQuestions(state.result!.plan!);
  if (questions.length > 0) {
    showToast("请先回答澄清问题，再提交并执行", { kind: "error" });
    return;
  }
  try {
    const dispatched = await dispatchPlan(planId);
    await startRun(dispatched.run.id);
    await goToTaskRun(dispatched.run.id, dispatched.nodes.length);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    showToast(`分发失败: ${formatActionableError(raw)}`, { kind: "error" });
  }
}

function cssIdent(s: string): string {
  // Prefer CSS.escape when available (WKWebView); fall back for simple ids.
  const esc = (globalThis as { CSS?: { escape?: (x: string) => string } }).CSS
    ?.escape;
  return esc ? esc(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function collectAnswers(root: HTMLElement, questions: PlanQuestion[]): PlanClarification[] | null {
  const answers: PlanClarification[] = [];
  for (const q of questions) {
    const selected = root.querySelector(
      `input[name="clarify-${cssIdent(q.id)}"]:checked`,
    ) as HTMLInputElement | null;
    if (!selected) {
      showToast(`请选择：${q.prompt}`, { kind: "error" });
      return null;
    }
    const noteEl = root.querySelector(
      `textarea[data-clarify-note="${cssIdent(q.id)}"]`,
    ) as HTMLTextAreaElement | null;
    const note = noteEl?.value.trim() || "";
    answers.push({
      question_id: q.id,
      option: selected.value,
      note: note || null,
    });
  }
  return answers;
}

async function submitClarifications(
  planId: string,
  questions: PlanQuestion[],
): Promise<void> {
  const panel = document.getElementById("orch-clarify-panel");
  if (!panel) return;
  const answers = collectAnswers(panel, questions);
  if (!answers) return;

  const btn = document.getElementById(
    "confirm-answers-btn",
  ) as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.classList.add("is-busy");
    btn.innerHTML =
      '<span class="btn-spinner" aria-hidden="true"></span>提交并执行中…';
  }

  try {
    const result = await confirmPlanAnswers(planId, answers);
    if (state.result) {
      state.result.plan = result.plan;
    }
    await goToTaskRun(result.dispatch.run.id, result.dispatch.nodes.length);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    showToast(`提交失败: ${formatActionableError(raw)}`, { kind: "error" });
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("is-busy");
      btn.textContent = "提交并执行";
    }
  }
}

function renderClarifyPanel(questions: PlanQuestion[]): string {
  const items = questions
    .map((q, i) => {
      const opts = q.options
        .map((opt, oi) => {
          const id = `clarify-${escapeHtml(q.id)}-${oi}`;
          return `<label class="clarify-option" for="${id}">
            <input type="radio" id="${id}" name="clarify-${escapeHtml(q.id)}" value="${escapeHtml(opt)}" />
            <span>${escapeHtml(opt)}</span>
          </label>`;
        })
        .join("");
      return `<div class="clarify-item" data-question-id="${escapeHtml(q.id)}">
        <div class="clarify-prompt">${i + 1}. ${escapeHtml(q.prompt)}</div>
        <div class="clarify-options">${opts}</div>
        <textarea class="clarify-note" data-clarify-note="${escapeHtml(q.id)}" rows="2" placeholder="补充说明（可选）"></textarea>
      </div>`;
    })
    .join("");

  return `<div class="orch-step-card orch-clarify-card" id="orch-clarify-panel">
    <div class="step-number">?</div>
    <div class="step-content">
      <div class="step-header">
        <div class="step-title">澄清问答 (${questions.length})</div>
        <span style="font-size:11px; color:var(--fg-muted);">单选 + 可选补充 · 提交后直接执行</span>
      </div>
      <div class="clarify-list">${items}</div>
    </div>
  </div>`;
}

export function renderPlanWorkbench(plan: PlanAnalysis, warnings: string[]): void {
  const root = document.getElementById("orch-results");
  if (!root) return;

  const questions = planQuestions(plan);
  const needsClarify = questions.length > 0;

  const tags = plan.intent.tags
    .map(
      (t) =>
        `<span class="skill-tag" style="background:rgba(5,150,105,0.1); color:#047857;">${escapeHtml(t)}</span>`,
    )
    .join(" ");

  const subtaskLines = plan.subtasks
    .map(
      (st, i) =>
        `<div style="margin-bottom:3px;">${i + 1}. [${escapeHtml(st.agent)}] ${escapeHtml(st.title)}</div>`,
    )
    .join("");

  const rows = plan.subtasks
    .map((st, i) => {
      const skills =
        st.skills.length > 0
          ? st.skills
              .map((sk) => `<span class="skill-tag">${escapeHtml(sk)}</span>`)
              .join(" ")
          : '<span style="color:var(--fg-muted);">—</span>';
      const model = [
        st.cli_engine || "—",
        st.model || "",
        st.reasoning_effort ? `(${st.reasoning_effort})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<tr style="border-bottom:1px solid var(--border-color);">
        <td style="padding:6px;">Task #${i + 1} ${escapeHtml(st.title)}</td>
        <td style="padding:6px; font-weight:600; color:${agentColor(st.agent)}; font-family:var(--font-mono);">${escapeHtml(st.agent)}</td>
        <td style="padding:6px;">${skills}</td>
        <td style="padding:6px; font-family:var(--font-mono); color:#7c3aed;">${escapeHtml(model)}</td>
      </tr>`;
    })
    .join("");

  const warnBlock =
    warnings.length > 0
      ? `<div style="font-size:11px; color:#b45309; margin-bottom:10px;">Warnings: ${warnings.map(escapeHtml).join("; ")}</div>`
      : "";

  const actionBtn = needsClarify
    ? `<button class="btn btn-primary btn-sm" id="confirm-answers-btn" style="background:var(--accent-emerald);">提交并执行</button>`
    : `<div style="display:flex; gap:6px;">
        <button class="btn btn-secondary btn-sm" id="save-plan-template-btn">保存为模版</button>
        <button class="btn btn-primary btn-sm" id="dispatch-plan-btn" style="background:var(--accent-emerald);">确认并分发任务 (Dispatch)</button>
      </div>`;

  const clarifyBlock = needsClarify ? renderClarifyPanel(questions) : "";
  const stepOffset = needsClarify ? 1 : 0;

  root.innerHTML = `
    <div class="panel-title-bar">
      <div class="panel-title">智能调度拆解与路由方案</div>
      ${actionBtn}
    </div>
    ${warnBlock}
    ${clarifyBlock}
    <div class="orch-step-card">
      <div class="step-number">${1 + stepOffset}</div>
      <div class="step-content">
        <div class="step-header">
          <div class="step-title">意图分析 (Intent Analysis)</div>
          ${tags}
        </div>
        <p style="font-size:12px; color:var(--fg-secondary);">${escapeHtml(plan.intent.summary)}</p>
      </div>
    </div>
    <div class="orch-step-card">
      <div class="step-number">${2 + stepOffset}</div>
      <div class="step-content">
        <div class="step-header">
          <div class="step-title">任务子目标拆解 (Task Decomposition)</div>
          <span style="font-size:11px; color:var(--fg-muted);">${plan.subtasks.length} 个关联子任务</span>
        </div>
        <div style="font-size:12px; line-height:1.6; color:var(--fg-secondary); font-family:var(--font-mono);">
          ${subtaskLines}
        </div>
      </div>
    </div>
    <div class="orch-step-card">
      <div class="step-number">${3 + stepOffset}</div>
      <div class="step-content">
        <div class="step-header">
          <div class="step-title">Agent & Skill & Model 路由矩阵</div>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:6px;">
          <thead>
            <tr style="text-align:left; color:var(--fg-muted); border-bottom:1px solid var(--border-color); font-size:11px; text-transform:uppercase;">
              <th style="padding:6px;">子任务</th>
              <th style="padding:6px;">分配 Agent</th>
              <th style="padding:6px;">调用的 Skill</th>
              <th style="padding:6px;">Model & Reasoning</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;

  root.style.display = "";
  const canDispatch = plan.subtasks.length > 0;

  if (needsClarify) {
    const planId = state.result?.plan_row?.id;
    document.getElementById("confirm-answers-btn")?.addEventListener("click", () => {
      if (!canDispatch || !planId) {
        showToast("Plan 无效：至少需要一个子任务", { kind: "error" });
        return;
      }
      void submitClarifications(planId, questions);
    });
  } else {
    setDispatchEnabled(
      canDispatch,
      canDispatch ? undefined : "Plan 无子任务，无法 Dispatch",
    );
    document.getElementById("dispatch-plan-btn")?.addEventListener("click", () => {
      if (!canDispatch) {
        showToast("Plan 无效：至少需要一个子任务", { kind: "error" });
        return;
      }
      void dispatchCurrentPlan();
    });
    document
      .getElementById("save-plan-template-btn")
      ?.addEventListener("click", () => {
        void import("../templates/save-wizard").then((m) => {
          const r = state.result;
          if (!r?.ok || !r.plan_row || !r.goal) {
            showToast("没有可保存的 Plan", { kind: "error" });
            return;
          }
          void m.openSaveTemplateWizard({
            goalId: r.goal.id,
            planId: r.plan_row.id,
            goalPrompt: r.goal.prompt,
            planJson: r.plan_row.analysis_json,
          });
        });
      });
  }
}

export function renderOrchestrateError(error: string, raw: string | null): void {
  const root = document.getElementById("orch-results");
  if (!root) return;
  const actionable = formatActionableError(error);
  const rawBlock = raw
    ? `<pre style="margin-top:10px; max-height:220px; overflow:auto; font-size:11px; background:#0f172a; color:#e2e8f0; padding:10px; border-radius:6px; white-space:pre-wrap;">${escapeHtml(raw)}</pre>`
    : "";
  root.innerHTML = `
    <div class="panel-title-bar">
      <div class="panel-title">调度拆解失败</div>
      <button class="btn btn-secondary btn-sm" id="dispatch-plan-btn" disabled title="没有可分发的有效 Plan">Dispatch 不可用</button>
    </div>
    <div class="orch-step-card">
      <div class="step-number">!</div>
      <div class="step-content">
        <div class="step-title" style="color:#dc2626;">无法生成可分发的 Plan</div>
        <p style="font-size:12px; color:var(--fg-secondary); margin-top:6px;">${escapeHtml(actionable)}</p>
        <p style="font-size:11px; color:var(--fg-muted); margin-top:8px;">可尝试：安装/刷新 CLI · 修正 JSON 夹具 · 确认已注册 Agent 名称匹配。</p>
        ${rawBlock}
      </div>
    </div>
  `;
  root.style.display = "";
  setDispatchEnabled(false);
}

async function runOrchestrate(): Promise<void> {
  const textarea = document.getElementById(
    "commander-prompt-text",
  ) as HTMLTextAreaElement | null;
  const btn = document.getElementById("start-orch-btn");
  const goal = textarea?.value.trim() || "";
  if (!goal) {
    showToast("请先输入调度目标");
    return;
  }

  if (btn) {
    btn.classList.add("is-busy");
    btn.innerHTML =
      '<span class="btn-spinner" aria-hidden="true"></span>正在分析意图与建图…';
    (btn as HTMLElement).style.opacity = "0.85";
    (btn as HTMLButtonElement).disabled = true;
  }

  try {
    const fixture = (
      document.getElementById("orch-fixture-json") as HTMLTextAreaElement | null
    )?.value.trim();
    const result = fixture
      ? await orchestrateFromJson(goal, fixture)
      : await orchestrate(goal);

    state.result = result;
    if (!result.ok || !result.plan) {
      renderOrchestrateError(
        result.error || "unknown orchestrate error",
        result.raw_output,
      );
      showToast(
        formatActionableError(result.error || "调度拆解失败 — 查看原始输出"),
        { kind: "error" },
      );
      return;
    }
    renderPlanWorkbench(result.plan, result.warnings || []);
    const qn = planQuestions(result.plan).length;
    showToast(
      qn > 0
        ? `调度拆解完成：${result.plan.subtasks.length} 个子任务，请回答 ${qn} 个澄清问题`
        : `调度拆解完成！包含 ${result.plan.subtasks.length} 个子任务与路由矩阵`,
      { kind: "success" },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    state.result = null;
    renderOrchestrateError(msg, null);
    showToast(`调度失败: ${formatActionableError(msg)}`, { kind: "error" });
  } finally {
    if (btn) {
      btn.classList.remove("is-busy");
      btn.innerHTML = "启动智能调度拆解 (Orchestrate)";
      (btn as HTMLElement).style.opacity = "1";
      (btn as HTMLButtonElement).disabled = false;
    }
  }
}

export function initOrchestratorWorkbench(): void {
  document
    .getElementById("start-orch-btn")
    ?.addEventListener("click", () => {
      void runOrchestrate();
    });

  (window as unknown as { startOrchestration: () => void }).startOrchestration =
    () => {
      void runOrchestrate();
    };
  (
    window as unknown as { dispatchCommanderTask: () => void }
  ).dispatchCommanderTask = () => {
    void dispatchCurrentPlan();
  };
}
