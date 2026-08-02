import type { Agent } from "../lib/api/agents";
import { getAgentProfile, listAgents } from "../lib/api/agents";
import {
  findCachedAgent,
  getSelectedAgentId,
  setSelectedAgentId,
} from "./agents/state";
import { showToast } from "./toast";

export type ViewId =
  | "overview"
  | "agents"
  | "agent-detail"
  | "commander"
  | "tasks"
  | "templates"
  | "schedules"
  | "settings";

const VIEW_IDS: readonly ViewId[] = [
  "overview",
  "agents",
  "agent-detail",
  "commander",
  "tasks",
  "templates",
  "schedules",
  "settings",
] as const;

export { getSelectedAgentId };

export function isViewId(value: string): value is ViewId {
  return (VIEW_IDS as readonly string[]).includes(value);
}

/** Cancels in-flight view exit animations when the user switches quickly. */
let viewTransitionGen = 0;

const VIEW_EXIT_MS = 120;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function syncNavHighlight(id: ViewId): void {
  // agent-detail is reached from Agents — keep Agents highlighted in sidebar
  const navHighlight: ViewId = id === "agent-detail" ? "agents" : id;
  document.querySelectorAll(".sidebar .nav-item[data-view]").forEach((item) => {
    const active = item.getAttribute("data-view") === navHighlight;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function refreshViewData(id: ViewId): void {
  if (id === "overview") {
    void import("./overview/page").then((m) => m.refreshOverview());
  }
  if (id === "agents") {
    void import("./agents/matrix").then((m) => m.refreshAgentMatrix());
  }
  if (id === "templates") {
    void import("./templates/page").then((m) => m.refreshTemplateLibrary());
  }
  if (id === "schedules") {
    void import("./schedules/page").then((m) => m.refreshSchedules());
  }
  if (id === "settings") {
    void import("./settings/page").then((m) => m.refreshSettings());
  }
}

function activatePane(targetPane: HTMLElement | null): void {
  document.querySelectorAll(".view-pane").forEach((pane) => {
    pane.classList.remove("active", "is-leaving");
    pane.setAttribute("aria-hidden", "true");
  });
  if (targetPane) {
    targetPane.classList.add("active");
    targetPane.setAttribute("aria-hidden", "false");
  }
  const content = document.querySelector(".content-area");
  if (content) content.scrollTop = 0;
}

/** Show one view pane and sync sidebar active state. */
export function showView(id: ViewId): void {
  const gen = ++viewTransitionGen;
  const targetPane = document.getElementById(`view-${id}`);
  // Prefer the active pane; fall back to a mid-exit pane if user switches fast.
  const current =
    document.querySelector<HTMLElement>(".view-pane.active:not(.is-leaving)") ??
    document.querySelector<HTMLElement>(".view-pane.is-leaving");

  syncNavHighlight(id);

  // Same pane already visible — refresh data only, avoid replaying enter fade.
  if (current && targetPane && current === targetPane) {
    current.classList.remove("is-leaving");
    current.classList.add("active");
    current.setAttribute("aria-hidden", "false");
    refreshViewData(id);
    return;
  }

  const exitMs = prefersReducedMotion() ? 0 : VIEW_EXIT_MS;

  const finish = (): void => {
    if (gen !== viewTransitionGen) return;
    activatePane(targetPane);
    refreshViewData(id);
  };

  if (current && exitMs > 0) {
    current.classList.remove("active");
    current.classList.add("is-leaving");
    current.setAttribute("aria-hidden", "true");
    document.querySelectorAll(".view-pane").forEach((pane) => {
      if (pane !== current) {
        pane.classList.remove("active", "is-leaving");
        pane.setAttribute("aria-hidden", "true");
      }
    });
    window.setTimeout(finish, exitMs);
    return;
  }

  finish();
}

async function resolveAgent(idOrName: string): Promise<Agent | null> {
  let agent = findCachedAgent(idOrName);
  if (agent) return agent;
  try {
    const list = await listAgents();
    return (
      list.find((a) => a.id === idOrName) ||
      list.find((a) => a.name === idOrName) ||
      null
    );
  } catch {
    return null;
  }
}

function applyDetailHeader(agent: Agent): void {
  const nameEl = document.getElementById("detail-agent-name");
  const statusEl = document.getElementById("detail-agent-status");
  if (nameEl) nameEl.textContent = agent.name;
  if (statusEl) {
    const working =
      agent.status.toLowerCase() === "working" ||
      agent.status.toLowerCase() === "running";
    statusEl.textContent = working ? "Working" : "Idle";
    statusEl.className = `agent-status-badge ${working ? "badge-working" : "badge-idle"}`;
  }
}

/** Select agent by id (preferred) or name → detail view. */
export async function selectAgentById(idOrName: string): Promise<void> {
  const agent = await resolveAgent(idOrName);
  if (!agent) {
    showToast(`未找到 Agent: ${idOrName}`);
    return;
  }
  setSelectedAgentId(agent.id);
  applyDetailHeader(agent);
  try {
    await getAgentProfile(agent.id);
  } catch {
    /* profile optional until 03-03 */
  }
  showView("agent-detail");
  void import("./agents/detail-skills").then((m) => m.refreshAgentSkills(agent.id));
  void import("./agents/detail-config").then((m) =>
    m.loadAgentDetailConfig(agent.id),
  );
  void import("./agents/sandbox").then((m) => m.refreshSandboxAvailability());
  showToast(`已载入 Agent [${agent.name}] 的全量配置`);
}

/** Back-compat for prototype onclick handlers that pass a name. */
export function selectAgent(agentName: string): void {
  void selectAgentById(agentName);
}

/** Bind back button on agent detail → Agents list. */
export function initAgentDetailNav(): void {
  document
    .getElementById("btn-back-to-agents")
    ?.addEventListener("click", () => {
      showView("agents");
    });
}
