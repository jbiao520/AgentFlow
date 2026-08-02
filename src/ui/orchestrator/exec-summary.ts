/**
 * Pure aggregation for Commander "即将执行" summary (S1).
 */
import type { PlanAnalysis, PlanSubtask } from "../../lib/api/orchestrate";
import type { Agent } from "../../lib/api/agents";
import { clampConcurrency } from "../concurrency";

export type ExecSummary = {
  subtaskCount: number;
  agentCount: number;
  agentNames: string[];
  engines: string[];
  models: string[];
  modelsOverflow: number;
  crossWorkspace: boolean | null;
  concurrency: number;
  risks: string[];
  headline: string;
  detailLines: string[];
};

function uniqPreserve(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function isHighReasoning(effort: string | null | undefined): boolean {
  if (!effort) return false;
  const e = effort.trim().toLowerCase();
  return e === "high" || e === "xhigh" || e === "extra_high" || e === "max";
}

/** Longest path length in depends_on DAG (number of edges on longest chain). */
export function maxDependencyDepth(subtasks: PlanSubtask[]): number {
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const memo = new Map<string, number>();

  function depth(id: string, stack: Set<string>): number {
    if (memo.has(id)) return memo.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    const st = byId.get(id);
    const deps = st?.depends_on ?? [];
    let best = 0;
    for (const d of deps) {
      if (!byId.has(d)) continue;
      best = Math.max(best, 1 + depth(d, stack));
    }
    stack.delete(id);
    memo.set(id, best);
    return best;
  }

  let max = 0;
  for (const st of subtasks) {
    max = Math.max(max, depth(st.id, new Set()));
  }
  return max;
}

export function buildExecSummary(
  plan: PlanAnalysis,
  opts?: {
    agents?: Agent[] | null;
    concurrency?: number | null;
    warnings?: string[];
  },
): ExecSummary {
  const subtasks = plan.subtasks ?? [];
  const agentNames = uniqPreserve(subtasks.map((s) => s.agent));
  const engines = uniqPreserve(
    subtasks.map((s) => s.cli_engine || "").filter(Boolean),
  );
  const allModels = uniqPreserve(
    subtasks.map((s) => s.model || "").filter(Boolean),
  );
  const models = allModels.slice(0, 3);
  const modelsOverflow = Math.max(0, allModels.length - models.length);

  let crossWorkspace: boolean | null = null;
  if (opts?.agents && opts.agents.length > 0) {
    const paths = new Set<string>();
    for (const name of agentNames) {
      const a = opts.agents.find(
        (x) => x.name === name || x.id === name,
      );
      if (a?.workspace_path) paths.add(a.workspace_path);
    }
    if (paths.size > 0) crossWorkspace = paths.size > 1;
  }

  const highCount = subtasks.filter((s) =>
    isHighReasoning(s.reasoning_effort),
  ).length;
  const chain = maxDependencyDepth(subtasks);
  const concurrency = clampConcurrency(
    opts?.concurrency ?? plan.concurrency ?? 1,
  );

  const risks: string[] = [];
  if (highCount > 0) {
    risks.push(`含 High reasoning 节点 ×${highCount}`);
  }
  if (chain >= 2) {
    risks.push(`依赖链最长 ${chain + 1} 步`);
  }
  if (crossWorkspace === true) {
    risks.push("跨多个 Workspace 执行");
  }
  const warnings = opts?.warnings ?? [];
  for (const w of warnings) {
    if (risks.length >= 3) break;
    const t = w.trim();
    if (t) risks.push(t.length > 48 ? `${t.slice(0, 47)}…` : t);
  }

  const enginePart =
    engines.length > 0 ? engines.join(", ") : "（沿用 Agent 默认）";
  const modelPart =
    models.length > 0
      ? `${models.join(", ")}${modelsOverflow > 0 ? ` 等 ${allModels.length} 个` : ""}`
      : "（沿用 Agent 默认）";

  const headline = `将执行 ${subtasks.length} 个子任务 · 涉及 ${agentNames.length} 个 Agent`;
  const detailLines = [
    `引擎: ${enginePart}`,
    `模型: ${modelPart}`,
    `跨仓库: ${crossWorkspace === null ? "未知" : crossWorkspace ? "是" : "否"} · 并发: ${concurrency}`,
  ];

  return {
    subtaskCount: subtasks.length,
    agentCount: agentNames.length,
    agentNames,
    engines,
    models,
    modelsOverflow,
    crossWorkspace,
    concurrency,
    risks: risks.slice(0, 3),
    headline,
    detailLines,
  };
}

export function execSummaryHtml(summary: ExecSummary): string {
  const riskBlock =
    summary.risks.length > 0
      ? `<ul class="orch-exec-risks">${summary.risks
          .map((r) => `<li>${escapeHtml(r)}</li>`)
          .join("")}</ul>`
      : `<p class="orch-exec-risks-empty">未检测到额外风险提示</p>`;

  return `<div class="orch-exec-summary" id="orch-exec-summary" role="region" aria-label="即将执行">
    <div class="orch-exec-summary-kicker">即将执行</div>
    <div class="orch-exec-summary-headline">${escapeHtml(summary.headline)}</div>
    <div class="orch-exec-summary-details">
      ${summary.detailLines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}
    </div>
    <div class="orch-exec-summary-risks-label">风险提示</div>
    ${riskBlock}
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
