/**
 * Overview page: live stats, topology SVG, running queue from SQLite.
 */
import {
  getOverviewStats,
  getOverviewTopology,
  listRunningQueue,
  type OverviewStats,
  type OverviewTopology,
  type QueueItem,
  type TopologyNode,
} from "../../lib/api/overview";
import { updateNavCounts } from "../nav-counts";
import { selectAgentById, showView } from "../router";
import { openTaskRun } from "../tasks/center";
import { showToast } from "../toast";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function strokeForStatus(status: string, kind: string): string {
  if (kind === "orchestrator") return "#2563eb";
  const s = status.toLowerCase();
  if (s === "working" || s === "running") return "#d97706";
  if (s === "error") return "#dc2626";
  if (s === "idle") return "#059669";
  return "#cbd5e1";
}

function renderStats(stats: OverviewStats): void {
  const set = (id: string, text: string, color?: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (color) (el as HTMLElement).style.color = color;
  };

  set("overview-stat-agents", String(stats.agent_count));
  const healthyEl = document.getElementById("overview-stat-agents-sub");
  if (healthyEl) {
    const pct = Math.round(stats.agents_healthy_pct);
    const color =
      pct >= 90
        ? "var(--accent-emerald)"
        : pct >= 50
          ? "var(--accent-amber)"
          : "#dc2626";
    healthyEl.innerHTML = `<span class="status-dot" style="background:${color};"></span> ${pct}% 连通健康`;
  }

  const runningColor =
    stats.running_tasks > 0 ? "var(--accent-amber)" : "var(--fg-primary)";
  set("overview-stat-running", String(stats.running_tasks), runningColor);
  set(
    "overview-stat-running-sub",
    stats.running_tasks > 0 ? "queued / running" : "当前无运行任务",
  );

  set("overview-stat-completed", String(stats.completed_today));
  const rate = Math.round(stats.success_rate_today * 10) / 10;
  set(
    "overview-stat-completed-sub",
    `成功率 ${rate}%`,
    "var(--accent-emerald)",
  );

  set("overview-stat-tokens", stats.tokens_display);
  set("overview-stat-tokens-sub", "未计量 (v1)");
}

function layoutPositions(
  agents: TopologyNode[],
): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  map.set("orchestrator", { x: 30, y: 95 });

  const midX = 320;
  const rightX = 630;
  const n = agents.length;
  if (n === 0) return map;

  // Put first half in middle column, rest on right (collaboration targets)
  const midCount = Math.ceil(n / 2);
  const midAgents = agents.slice(0, midCount);
  const rightAgents = agents.slice(midCount);

  const placeCol = (
    list: TopologyNode[],
    x: number,
    startY: number,
    gap: number,
  ) => {
    list.forEach((a, i) => {
      const y =
        list.length === 1
          ? 95
          : startY + i * gap;
      map.set(a.id, { x, y });
    });
  };

  if (rightAgents.length === 0) {
    const gap = n === 1 ? 0 : Math.min(70, 180 / Math.max(n - 1, 1));
    const startY = n === 1 ? 95 : Math.max(20, 125 - ((n - 1) * gap) / 2);
    placeCol(agents, midX, startY, gap);
  } else {
    const midGap =
      midAgents.length <= 1
        ? 0
        : Math.min(70, 160 / Math.max(midAgents.length - 1, 1));
    const midStart =
      midAgents.length === 1
        ? 95
        : Math.max(20, 125 - ((midAgents.length - 1) * midGap) / 2);
    placeCol(midAgents, midX, midStart, midGap);

    const rightGap =
      rightAgents.length <= 1
        ? 0
        : Math.min(70, 160 / Math.max(rightAgents.length - 1, 1));
    const rightStart =
      rightAgents.length === 1
        ? 95
        : Math.max(20, 125 - ((rightAgents.length - 1) * rightGap) / 2);
    placeCol(rightAgents, rightX, rightStart, rightGap);
  }

  return map;
}

function renderTopology(topo: OverviewTopology): void {
  const caption = document.getElementById("overview-topology-caption");
  if (caption) caption.textContent = topo.caption;

  const svg = document.getElementById("overview-topology-svg");
  if (!svg) return;

  const agents = topo.nodes.filter((n) => n.kind === "agent");
  const positions = layoutPositions(agents);
  const nodeW = 150;
  const nodeH = 60;
  const hubW = 140;

  const centerOf = (id: string, isHub: boolean) => {
    const p = positions.get(id) || { x: 30, y: 95 };
    const w = isHub ? hubW : nodeW;
    return { cx: p.x + w / 2, cy: p.y + nodeH / 2, x: p.x, y: p.y, w };
  };

  let paths = "";
  for (const e of topo.edges) {
    const fromHub = e.from_id === "orchestrator";
    const toHub = e.to_id === "orchestrator";
    const from = centerOf(e.from_id, fromHub);
    const to = centerOf(e.to_id, toHub);
    const x1 = fromHub ? from.x + from.w : from.cx;
    const y1 = from.cy;
    const x2 = toHub ? to.x : to.x;
    const y2 = to.cy;
    const mx = (x1 + x2) / 2;
    const dash = e.style === "dashed" ? ' stroke-dasharray="4"' : "";
    const color = fromHub ? "#2563eb" : "#059669";
    paths += `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="1.5"${dash} class="flowing-edge" marker-end="url(#arrow)"/>`;
  }

  let nodesHtml = "";
  for (const n of topo.nodes) {
    const isHub = n.kind === "orchestrator";
    const p = positions.get(n.id) || { x: 30, y: 95 };
    const w = isHub ? hubW : nodeW;
    const stroke = strokeForStatus(n.status, n.kind);
    const click = isHub
      ? `data-topo-action="commander"`
      : `data-topo-action="agent" data-agent-id="${escapeHtml(n.id)}"`;
    const statusDot =
      !isHub &&
      (n.status.toLowerCase() === "working" ||
        n.status.toLowerCase() === "running")
        ? `<circle cx="${w - 14}" cy="12" r="3.5" fill="${stroke}"/>`
        : "";
    const label = escapeHtml(truncate(n.label, 18));
    const sub = escapeHtml(truncate(n.sublabel || "", 22));
    const textAnchor = isHub ? ' text-anchor="middle"' : "";
    const hubWeight = isHub ? ' font-weight="600"' : "";
    const labelX = isHub ? w / 2 : 12;
    const labelSize = isHub ? 12 : 11;
    const subColor = isHub ? "#2563eb" : "#64748b";
    nodesHtml += `
      <g class="topology-node" transform="translate(${p.x}, ${p.y})" ${click} style="cursor:pointer">
        <rect width="${w}" height="${nodeH}" rx="8" fill="#ffffff" stroke="${stroke}" stroke-width="${isHub ? 1.5 : 1.2}"/>
        ${statusDot}
        <text x="${labelX}" y="26" fill="#0f172a" font-size="${labelSize}" font-weight="bold" font-family="var(--font-mono)"${textAnchor}>${label}</text>
        <text x="${labelX}" y="42" fill="${subColor}" font-size="10"${hubWeight}${textAnchor}>${sub}</text>
      </g>`;
  }

  if (agents.length === 0) {
    nodesHtml += `
      <text x="450" y="130" fill="#64748b" font-size="12" text-anchor="middle">暂无 Agent — 点击导入或打开 Agents</text>`;
  }

  svg.innerHTML = `
    <defs>
      <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
        <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(0,0,0,0.035)" stroke-width="1"/>
      </pattern>
      <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb"/>
      </marker>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid)" />
    ${paths}
    ${nodesHtml}
  `;

  svg.querySelectorAll("[data-topo-action]").forEach((el) => {
    el.addEventListener("click", () => {
      const action = el.getAttribute("data-topo-action");
      if (action === "commander") {
        showView("commander");
        return;
      }
      const id = el.getAttribute("data-agent-id");
      if (id) void selectAgentById(id);
    });
  });
}

function renderQueue(items: QueueItem[]): void {
  const tbody = document.getElementById("overview-queue-body");
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding:20px 10px; color:var(--fg-muted); text-align:center;">
          当前没有运行中的任务。
          <button class="btn btn-secondary btn-sm" style="margin-left:8px;" data-od-id="overview-queue-empty-cta">发起调度</button>
        </td>
      </tr>`;
    tbody
      .querySelector("[data-od-id='overview-queue-empty-cta']")
      ?.addEventListener("click", () => showView("commander"));
    return;
  }

  tbody.innerHTML = items
    .map((item) => {
      const pct = Math.round((item.progress || 0) * 100);
      const agents = item.agent_names.length
        ? item.agent_names
            .map((n) => `<span class="skill-tag">${escapeHtml(n)}</span>`)
            .join(" ")
        : `<span style="color:var(--fg-muted);">—</span>`;
      const engines = item.cli_engines.length
        ? escapeHtml(item.cli_engines.join(", "))
        : "—";
      const shortId = item.run_id.slice(0, 8);
      return `
        <tr style="border-bottom:1px solid var(--border-color); cursor:pointer;" data-run-id="${escapeHtml(item.run_id)}">
          <td style="padding:10px;">
            <div style="font-weight:600; color:var(--fg-primary);">#${escapeHtml(shortId)} ${escapeHtml(truncate(item.goal_prompt, 48))}</div>
            <div style="font-size:11px; color:var(--fg-muted);">拆解 ${item.node_count} 个子任务 · ${escapeHtml(item.status)}</div>
          </td>
          <td style="padding:10px;">${agents}</td>
          <td style="padding:10px; font-family:var(--font-mono); font-size:11px; color:#7c3aed;">${engines}</td>
          <td style="padding:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="flex:1; background:#e2e8f0; height:5px; border-radius:3px; overflow:hidden;">
                <div style="width:${pct}%; background:var(--accent-amber); height:100%;"></div>
              </div>
              <span style="font-size:11px; color:var(--accent-amber); font-family:var(--font-mono);">${pct}%</span>
            </div>
          </td>
          <td style="padding:10px; color:var(--fg-muted); font-family:var(--font-mono);">${escapeHtml(item.elapsed_label)}</td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll("tr[data-run-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const runId = (row as HTMLElement).dataset.runId;
      if (runId) void openTaskRun(runId);
      else showView("tasks");
    });
  });
}

export async function refreshOverview(): Promise<void> {
  try {
    const [stats, topo, queue] = await Promise.all([
      getOverviewStats(),
      getOverviewTopology(),
      listRunningQueue(),
    ]);
    renderStats(stats);
    renderTopology(topo);
    renderQueue(queue);
    updateNavCounts(stats.agent_count, stats.running_tasks);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast(`总览加载失败: ${msg}`);
  }
}

export function initOverview(): void {
  void refreshOverview();
}
