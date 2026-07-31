/**
 * Commander workbench: Orchestrate → render intent / subtasks / routing table.
 */
import {
  orchestrate,
  orchestrateFromJson,
  type OrchestrateResult,
  type PlanAnalysis,
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

async function dispatchCurrentPlan(): Promise<void> {
  const planId = state.result?.plan_row?.id;
  const planOk = !!(state.result?.ok && state.result?.plan && planId);
  if (!planOk || !planId) {
    showToast("没有可分发的 Plan — 请先 Orchestrate", { kind: "error" });
    setDispatchEnabled(false);
    return;
  }
  try {
    const dispatched = await dispatchPlan(planId);
    await startRun(dispatched.run.id);
    showToast(`已分发 ${dispatched.nodes.length} 个节点，开始执行`, {
      kind: "success",
    });
    showView("tasks");
    window.dispatchEvent(
      new CustomEvent("agentmind:run-started", {
        detail: { runId: dispatched.run.id },
      }),
    );
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    showToast(`分发失败: ${formatActionableError(raw)}`, { kind: "error" });
  }
}

export function renderPlanWorkbench(plan: PlanAnalysis, warnings: string[]): void {
  const root = document.getElementById("orch-results");
  if (!root) return;

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

  root.innerHTML = `
    <div class="panel-title-bar">
      <div class="panel-title">智能调度拆解与路由方案</div>
      <button class="btn btn-primary btn-sm" id="dispatch-plan-btn" style="background:var(--accent-emerald);">确认并分发任务 (Dispatch)</button>
    </div>
    ${warnBlock}
    <div class="orch-step-card">
      <div class="step-number">1</div>
      <div class="step-content">
        <div class="step-header">
          <div class="step-title">意图分析 (Intent Analysis)</div>
          ${tags}
        </div>
        <p style="font-size:12px; color:var(--fg-secondary);">${escapeHtml(plan.intent.summary)}</p>
      </div>
    </div>
    <div class="orch-step-card">
      <div class="step-number">2</div>
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
      <div class="step-number">3</div>
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
    btn.innerHTML = "正在分析意图与建图 (Orchestrating)...";
    (btn as HTMLElement).style.opacity = "0.7";
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
    showToast(
      `调度拆解完成！包含 ${result.plan.subtasks.length} 个子任务与路由矩阵`,
      { kind: "success" },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    state.result = null;
    renderOrchestrateError(msg, null);
    showToast(`调度失败: ${formatActionableError(msg)}`, { kind: "error" });
  } finally {
    if (btn) {
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
