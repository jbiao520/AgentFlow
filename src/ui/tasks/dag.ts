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
  const pad = 20;
  const width = pad * 2 + sorted.length * w + (sorted.length - 1) * gap;
  const height = 110;

  const idToIndex = new Map(sorted.map((n, i) => [n.id, i]));

  let edges = "";
  for (const n of sorted) {
    const deps: string[] = n.depends_on_json
      ? (JSON.parse(n.depends_on_json) as string[])
      : [];
    const ti = idToIndex.get(n.id) ?? 0;
    for (const d of deps) {
      const fi = idToIndex.get(d);
      if (fi === undefined) continue;
      const x1 = pad + fi * (w + gap) + w;
      const x2 = pad + ti * (w + gap);
      const y = 55;
      const stroke = statusStroke(
        sorted[fi]?.status === "success" ? "success" : "pending",
      );
      edges += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${stroke}" stroke-width="1.5"/>`;
    }
  }

  let bodies = "";
  sorted.forEach((n, i) => {
    const x = pad + i * (w + gap);
    const stroke = statusStroke(n.status);
    const sw = selectedId === n.id ? 2.2 : 1.2;
    const title =
      n.title.length > 22 ? `${n.title.slice(0, 20)}…` : n.title;
    const engine = n.cli_engine || "—";
    bodies += `<g transform="translate(${x}, 20)" style="cursor:pointer;" data-node-id="${escapeXml(n.id)}">
      <rect width="${w}" height="${h}" rx="6" fill="#ffffff" stroke="${stroke}" stroke-width="${sw}"/>
      <text x="10" y="22" fill="#0f172a" font-size="11" font-weight="bold" font-family="var(--font-mono)">${i + 1}. ${escapeXml(title)}</text>
      <text x="10" y="40" fill="${stroke}" font-size="10" font-weight="600">${escapeXml(statusLabel(n.status))}</text>
      <text x="10" y="56" fill="#64748b" font-size="9" font-family="var(--font-mono)">${escapeXml(engine)} · r${n.retry_count}</text>
    </g>`;
  });

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" style="width:100%; height:${height}px; background:#f8fafc; border:1px solid var(--border-color); border-radius:6px;">${edges}${bodies}</svg>`;

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
      edges += `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="#94a3b8" stroke-width="1.4" marker-end="url(#tpl-dag-arrow)"/>`;
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
      <rect width="${colW}" height="${rowH}" rx="8" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.2"/>
      <rect width="3" height="${rowH}" rx="1.5" fill="#2563eb"/>
      <text x="14" y="24" fill="#0f172a" font-size="11" font-weight="700" font-family="var(--font-mono)">${idx + 1}. ${escapeXml(title)}</text>
      <text x="14" y="42" fill="#2563eb" font-size="10" font-weight="600">${escapeXml(agent)}</text>
      <text x="14" y="58" fill="#64748b" font-size="9" font-family="var(--font-mono)">${escapeXml(sub === agent ? `id:${truncate(item.id, 16)}` : engine)}</text>
    </g>`;
  });

  container.innerHTML = `<svg class="tpl-dag-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="模版 DAG 拓扑">
    <defs>
      <marker id="tpl-dag-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8"/>
      </marker>
    </defs>
    ${edges}${bodies}
  </svg>`;
}
