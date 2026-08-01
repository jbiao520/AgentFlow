/**
 * Render a simple horizontal DAG SVG from task nodes + depends_on.
 * Also supports readonly Plan subtask graphs for the template library.
 */
import type { PlanSubtask } from "../../lib/api/orchestrate";
import type { TaskNode } from "../../lib/api/tasks";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Topological depth for layered DAG layout (0 = roots). */
function computeLevels(
  items: { id: string; depends_on: string[] }[],
): Map<string, number> {
  const byId = new Map(items.map((s) => [s.id, s]));
  const levels = new Map<string, number>();

  const levelOf = (id: string, stack: Set<string>): number => {
    const cached = levels.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) return 0;
    stack.add(id);
    const deps = byId.get(id)?.depends_on ?? [];
    const lvl =
      deps.length === 0
        ? 0
        : Math.max(0, ...deps.map((d) => levelOf(d, stack))) + 1;
    levels.set(id, lvl);
    stack.delete(id);
    return lvl;
  };

  for (const item of items) levelOf(item.id, new Set());
  return levels;
}

function statusStroke(status: string): string {
  switch (status) {
    case "success":
      return "#059669";
    case "running":
      return "#d97706";
    case "failed":
      return "#dc2626";
    case "skipped":
      return "#94a3b8";
    default:
      return "#cbd5e1";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "success":
      return "Success";
    case "running":
      return "Running";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return "Pending";
  }
}

export type DagSelectHandler = (nodeId: string) => void;

export function renderDag(
  container: HTMLElement,
  nodes: TaskNode[],
  selectedId: string | null,
  onSelect: DagSelectHandler,
): void {
  if (nodes.length === 0) {
    container.innerHTML =
      '<div style="padding:16px; color:var(--fg-muted); font-size:12px;">暂无 DAG 节点</div>';
    return;
  }

  const sorted = [...nodes].sort((a, b) => a.seq - b.seq);
  const w = 170;
  const h = 70;
  const gap = 40;
  const padX = 24;
  const padY = 28;
  const width = padX * 2 + sorted.length * w + (sorted.length - 1) * gap;
  const height = padY * 2 + h;

  const idToIndex = new Map(sorted.map((n, i) => [n.id, i]));
  const midY = padY + h / 2;

  let edges = "";
  for (const n of sorted) {
    const deps: string[] = n.depends_on_json
      ? (JSON.parse(n.depends_on_json) as string[])
      : [];
    const ti = idToIndex.get(n.id) ?? 0;
    for (const d of deps) {
      const fi = idToIndex.get(d);
      if (fi === undefined) continue;
      const from = sorted[fi];
      const x1 = padX + fi * (w + gap) + w;
      const x2 = padX + ti * (w + gap);
      const mx = (x1 + x2) / 2;
      const dPath = `M ${x1} ${midY} C ${mx} ${midY}, ${mx} ${midY}, ${x2} ${midY}`;
      const flowing = from?.status === "success" && n.status === "running";
      if (flowing) {
        edges += `<path class="dag-edge-base" d="${dPath}" fill="none" stroke="rgba(79, 70, 229, 0.22)" stroke-width="2.5" marker-end="url(#dag-arrow-flow)"/>`;
        edges += `<path class="dag-edge-flow" d="${dPath}" fill="none" stroke="url(#dag-edge-grad)" stroke-width="2.2" stroke-linecap="round"/>`;
      } else {
        const stroke = statusStroke(
          from?.status === "success" ? "success" : "pending",
        );
        edges += `<path class="dag-edge" d="${dPath}" fill="none" stroke="${stroke}" stroke-width="2" marker-end="url(#dag-arrow)" opacity="0.85"/>`;
      }
    }
  }

  let bodies = "";
  sorted.forEach((n, i) => {
    const x = padX + i * (w + gap);
    const stroke = statusStroke(n.status);
    const isSel = selectedId === n.id;
    const isRunning = n.status === "running";
    const sw = isSel ? 2.5 : isRunning ? 1.8 : 1.2;
    const fill = isSel
      ? "var(--accent-tint)"
      : isRunning
        ? "var(--accent-tint)"
        : "var(--bg-card)";
    const title =
      n.title.length > 20 ? `${n.title.slice(0, 18)}…` : n.title;
    const engine = n.cli_engine || "—";
    const pulse =
      isRunning
        ? `<rect class="dag-pulse-ring dag-pulse-ring--a" x="-6" y="-6" width="${w + 12}" height="${h + 12}" rx="14" fill="none"/>
      <rect class="dag-pulse-ring dag-pulse-ring--b" x="-6" y="-6" width="${w + 12}" height="${h + 12}" rx="14" fill="none"/>`
        : "";
    bodies += `<g class="dag-node${isRunning ? " is-running" : ""}${isSel ? " is-selected" : ""}" transform="translate(${x}, ${padY})" style="cursor:pointer;" data-node-id="${escapeXml(n.id)}">
      ${pulse}
      <rect class="dag-node-card" width="${w}" height="${h}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
      <text x="12" y="24" fill="var(--fg-primary)" font-size="11.5" font-weight="700" font-family="var(--font-mono)">${i + 1}. ${escapeXml(title)}</text>
      <text x="12" y="42" fill="${stroke}" font-size="10.5" font-weight="700">${escapeXml(statusLabel(n.status))}</text>
      <text x="12" y="58" fill="var(--fg-muted)" font-size="9.5" font-family="var(--font-mono)">${escapeXml(engine)} · retry: ${n.retry_count}</text>
    </g>`;
  });

  container.innerHTML = `<svg class="task-dag-svg" viewBox="0 0 ${width} ${height}" style="width:100%; height:${height}px;">
    <defs>
      <linearGradient id="dag-edge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#4f46e5"/>
        <stop offset="55%" stop-color="#06b6d4"/>
        <stop offset="100%" stop-color="#4f46e5"/>
      </linearGradient>
      <marker id="dag-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--accent-primary)"/>
      </marker>
      <marker id="dag-arrow-flow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#06b6d4"/>
      </marker>
    </defs>
    ${edges}${bodies}
  </svg>`;

  container.querySelectorAll("[data-node-id]").forEach((g) => {
    g.addEventListener("click", () => {
      const id = (g as HTMLElement).getAttribute("data-node-id");
      if (id) onSelect(id);
    });
  });
}

export type PlanDagNode = {
  id: string;
  title: string;
  agent: string;
  depends_on: string[];
  cli_engine?: string | null;
};

/**
 * Readonly layered DAG for Plan / template subtasks (no status, no selection).
 */
export function renderPlanDag(
  container: HTMLElement,
  subtasks: PlanSubtask[] | PlanDagNode[],
): void {
  if (subtasks.length === 0) {
    container.innerHTML =
      '<div class="tpl-dag-empty">此模版暂无子任务节点</div>';
    return;
  }

  const items = subtasks.map((s) => ({
    id: s.id,
    title: s.title,
    agent: s.agent,
    depends_on: s.depends_on || [],
    cli_engine: s.cli_engine ?? null,
  }));

  const levels = computeLevels(items);
  const byLevel = new Map<number, typeof items>();
  for (const item of items) {
    const lvl = levels.get(item.id) ?? 0;
    const row = byLevel.get(lvl) ?? [];
    row.push(item);
    byLevel.set(lvl, row);
  }

  const maxLevel = Math.max(...levels.values(), 0);
  const colW = 168;
  const colGap = 48;
  const rowH = 72;
  const rowGap = 14;
  const padX = 24;
  const padY = 20;

  let maxRows = 1;
  for (const row of byLevel.values()) maxRows = Math.max(maxRows, row.length);

  const width = padX * 2 + (maxLevel + 1) * colW + maxLevel * colGap;
  const height = padY * 2 + maxRows * rowH + (maxRows - 1) * rowGap;

  const pos = new Map<string, { x: number; y: number; cx: number; cy: number }>();
  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const row = byLevel.get(lvl) ?? [];
    const blockH = row.length * rowH + Math.max(0, row.length - 1) * rowGap;
    const startY = padY + (height - padY * 2 - blockH) / 2;
    row.forEach((item, i) => {
      const x = padX + lvl * (colW + colGap);
      const y = startY + i * (rowH + rowGap);
      pos.set(item.id, { x, y, cx: x + colW / 2, cy: y + rowH / 2 });
    });
  }

  let edges = "";
  for (const item of items) {
    const to = pos.get(item.id);
    if (!to) continue;
    for (const dep of item.depends_on) {
      const from = pos.get(dep);
      if (!from) continue;
      const x1 = from.x + colW;
      const y1 = from.cy;
      const x2 = to.x;
      const y2 = to.cy;
      const mx = (x1 + x2) / 2;
      edges += `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="var(--fg-muted)" stroke-width="1.4" marker-end="url(#tpl-dag-arrow)"/>`;
    }
  }

  let bodies = "";
  items.forEach((item, idx) => {
    const p = pos.get(item.id);
    if (!p) return;
    const title = truncate(item.title, 20);
    const agent = truncate(item.agent, 22);
    const engine = item.cli_engine ? truncate(item.cli_engine, 14) : "";
    const sub = engine ? `${agent} · ${engine}` : agent;
    bodies += `<g transform="translate(${p.x}, ${p.y})" class="tpl-dag-node">
      <rect width="${colW}" height="${rowH}" rx="8" fill="var(--bg-card)" stroke="var(--border-hover)" stroke-width="1.2"/>
      <rect width="3" height="${rowH}" rx="1.5" fill="var(--accent-primary)"/>
      <text x="14" y="24" fill="var(--fg-primary)" font-size="11" font-weight="700" font-family="var(--font-mono)">${idx + 1}. ${escapeXml(title)}</text>
      <text x="14" y="42" fill="var(--accent-primary)" font-size="10" font-weight="600">${escapeXml(agent)}</text>
      <text x="14" y="58" fill="var(--fg-muted)" font-size="9" font-family="var(--font-mono)">${escapeXml(sub === agent ? `id:${truncate(item.id, 16)}` : engine)}</text>
    </g>`;
  });

  container.innerHTML = `<svg class="tpl-dag-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="模版 DAG 拓扑">
    <defs>
      <marker id="tpl-dag-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill="var(--fg-muted)"/>
      </marker>
    </defs>
    ${edges}${bodies}
  </svg>`;
}
