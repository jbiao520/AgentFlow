/**
 * Render a simple horizontal DAG SVG from task nodes + depends_on.
 */
import type { TaskNode } from "../../lib/api/tasks";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
