import type { Agent } from "../../lib/api/agents";
import { listAgents, syncAgentSkills } from "../../lib/api/agents";
import { selectAgentById } from "../router";
import { showToast } from "../toast";
import { getCachedAgents, setCachedAgents } from "./state";

export { getCachedAgents };

function initials(name: string): string {
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "AG";
}

function statusLabel(status: string): {
  text: string;
  badge: string;
  working: boolean;
} {
  const s = status.toLowerCase();
  if (s === "working" || s === "running") {
    return { text: "Working", badge: "badge-working", working: true };
  }
  if (s === "error") {
    return { text: "Error", badge: "badge-idle", working: false };
  }
  return { text: "Idle", badge: "badge-idle", working: false };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function avatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const gradients = [
    "linear-gradient(135deg, rgba(22, 78, 43, 0.18), rgba(5, 150, 105, 0.12))",
    "linear-gradient(135deg, rgba(2, 132, 199, 0.18), rgba(56, 189, 248, 0.12))",
    "linear-gradient(135deg, rgba(124, 58, 237, 0.18), rgba(192, 132, 252, 0.12))",
    "linear-gradient(135deg, rgba(217, 119, 6, 0.18), rgba(251, 191, 36, 0.12))",
  ];
  return gradients[Math.abs(hash) % gradients.length];
}

function renderCard(agent: Agent): string {
  const st = statusLabel(agent.status);
  const desc =
    agent.description?.trim() ||
    "已绑定 Workspace。打开详情可配置模型并同步 Skill。";
  const repo = agent.git_url || agent.workspace_path;
  const bg = avatarGradient(agent.name);
  return `
    <div class="agent-card" data-agent-id="${escapeHtml(agent.id)}" data-agent-name="${escapeHtml(agent.name)}" data-status="${escapeHtml(agent.status.toLowerCase())}" data-cli="${escapeHtml(agent.default_cli)}" tabindex="0" role="button" aria-label="查看 Agent ${escapeHtml(agent.name)} 详情">
      <div class="agent-card-header">
        <div class="agent-avatar-badge" style="background: ${bg}">${escapeHtml(initials(agent.name))}</div>
        <div class="agent-status-badge ${st.badge}">
          <div class="status-dot${st.working ? " working" : ""}"></div>${st.text}
        </div>
      </div>
      <div class="agent-name">${escapeHtml(agent.name)}</div>
      <div class="agent-repo">${escapeHtml(repo)}</div>
      <p style="font-size:12px; color:var(--fg-muted); margin-bottom:12px; line-height:1.45;">
        ${escapeHtml(desc)}
      </p>
      <div class="agent-skills-tags" data-agent-skills="${escapeHtml(agent.id)}"></div>
      <div class="agent-footer">
        <span>CLI: ${escapeHtml(agent.default_cli)}</span>
        <span class="agent-model-pill">${escapeHtml(agent.default_cli)}</span>
      </div>
    </div>
  `;
}

export function filterAgents(): void {
  const searchVal =
    (
      document.getElementById("agent-search-input") as HTMLInputElement | null
    )?.value
      .toLowerCase()
      .trim() || "";
  const statusVal =
    (document.getElementById("agent-status-filter") as HTMLSelectElement | null)
      ?.value || "all";
  const cliVal =
    (document.getElementById("agent-cli-filter") as HTMLSelectElement | null)
      ?.value || "all";

  const cards = document.querySelectorAll("#agent-grid .agent-card");
  let visibleCount = 0;

  cards.forEach((card) => {
    const name = (card.getAttribute("data-agent-name") || "").toLowerCase();
    const status = card.getAttribute("data-status") || "";
    const cli = card.getAttribute("data-cli") || "";
    const content = (card.textContent || "").toLowerCase();

    const matchesSearch =
      !searchVal || name.includes(searchVal) || content.includes(searchVal);
    const matchesStatus = statusVal === "all" || status === statusVal;
    const matchesCli = cliVal === "all" || cli === cliVal;

    if (matchesSearch && matchesStatus && matchesCli) {
      (card as HTMLElement).style.display = "block";
      visibleCount++;
    } else {
      (card as HTMLElement).style.display = "none";
    }
  });

  const emptyState = document.getElementById("agent-empty-state");
  if (emptyState) {
    emptyState.style.display = visibleCount === 0 ? "flex" : "none";
  }
}

async function syncAllAgentSkills(): Promise<void> {
  const button = document.getElementById(
    "btn-sync-all-agents",
  ) as HTMLButtonElement | null;
  if (button) {
    button.disabled = true;
    button.textContent = "Sync 中...";
  }

  try {
    const agents = await listAgents();
    let added = 0;
    let updated = 0;
    let removed = 0;
    let failed = 0;

    for (const agent of agents) {
      try {
        const result = await syncAgentSkills(agent.id);
        added += result.added;
        updated += result.updated;
        removed += result.removed;
      } catch {
        // Keep syncing the remaining workspaces when one path is unavailable.
        failed++;
      }
    }

    await refreshAgentMatrix();
    const suffix = failed ? `，${failed} 个失败` : "";
    showToast(`Sync 完成：+${added} / ~${updated} / -${removed}${suffix}`, {
      kind: failed ? "error" : "success",
      durationMs: 5000,
    });
  } catch (e) {
    showToast(`Sync 失败: ${e instanceof Error ? e.message : String(e)}`, {
      kind: "error",
    });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Sync 全部 Agent";
    }
  }
}

function bindCardClicks(grid: HTMLElement): void {
  grid.querySelectorAll(".agent-card").forEach((card) => {
    const el = card as HTMLElement;
    const open = () => {
      const id = el.getAttribute("data-agent-id");
      if (id) void selectAgentById(id);
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

export async function refreshAgentMatrix(): Promise<void> {
  const grid = document.getElementById("agent-grid");
  if (!grid) return;

  try {
    setCachedAgents(await listAgents());
  } catch (e) {
    showToast(`加载 Agent 失败: ${e instanceof Error ? e.message : String(e)}`);
    setCachedAgents([]);
  }

  const cachedAgents = getCachedAgents();
  const agentsEl = document.getElementById("nav-count-agents");
  const overviewEl = document.getElementById("nav-count-overview");
  if (agentsEl) agentsEl.textContent = String(cachedAgents.length);
  if (overviewEl) overviewEl.textContent = String(cachedAgents.length);

  if (cachedAgents.length === 0) {
    grid.innerHTML = `
      <div id="agent-empty-state" class="empty-state" style="display:flex; flex-direction:column; align-items:center; gap:10px; padding:28px 16px;">
        <div style="font-weight:600; font-size:14px; color:var(--fg-primary);">还没有注册任何 Agent</div>
        <div style="font-size:12px; color:var(--fg-muted); text-align:center; max-width:360px;">
          导入本地 Workspace 或 Git URL，系统会扫描 <code>.agent/skills/</code> 并写入 SQLite。
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="agent-empty-import-cta">导入 / 新建 Agent</button>
      </div>`;
    document
      .getElementById("agent-empty-import-cta")
      ?.addEventListener("click", () => {
        void import("../modals").then((m) => m.openImportModal());
      });
    return;
  }

  const emptyHtml = `
    <div id="agent-empty-state" class="empty-state" style="display:none;">
      <div style="font-weight:600; font-size:14px; margin-bottom:4px; color:var(--fg-primary);">未找到匹配的 Agent 工作区</div>
      <div style="font-size:12px; color:var(--fg-muted);">请尝试调整搜索关键词或重置筛选条件，或通过右上角按钮新建导入。</div>
    </div>
  `;

  grid.innerHTML = cachedAgents.map(renderCard).join("\n") + emptyHtml;
  bindCardClicks(grid);
  filterAgents();
}

export function initAgentMatrix(): void {
  document
    .getElementById("btn-sync-all-agents")
    ?.addEventListener("click", () => {
      void syncAllAgentSkills();
    });
  void refreshAgentMatrix();
}
