export type ViewId =
  | "overview"
  | "agents"
  | "agent-detail"
  | "commander"
  | "tasks";

const VIEW_IDS: readonly ViewId[] = [
  "overview",
  "agents",
  "agent-detail",
  "commander",
  "tasks",
] as const;

export function isViewId(value: string): value is ViewId {
  return (VIEW_IDS as readonly string[]).includes(value);
}

/** Show one view pane and sync sidebar active state. */
export function showView(id: ViewId): void {
  document.querySelectorAll(".view-pane").forEach((pane) => {
    pane.classList.remove("active");
    pane.setAttribute("aria-hidden", "true");
  });

  const targetPane = document.getElementById(`view-${id}`);
  if (targetPane) {
    targetPane.classList.add("active");
    targetPane.setAttribute("aria-hidden", "false");
  }

  document.querySelectorAll(".sidebar .nav-item[data-view]").forEach((item) => {
    const active = item.getAttribute("data-view") === id;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", active ? "true" : "false");
  });

  const content = document.querySelector(".content-area");
  if (content) {
    content.scrollTop = 0;
  }
}

/** Mock agent select → detail header + agent-detail view. */
export function selectAgent(agentName: string): void {
  const nameEl = document.getElementById("detail-agent-name");
  const repoEl = document.getElementById("detail-agent-repo");
  if (nameEl) nameEl.textContent = agentName;
  if (repoEl) {
    repoEl.textContent = `绑定工作区: github.com/user/${agentName} · 分支: main`;
  }
  showView("agent-detail");
}
