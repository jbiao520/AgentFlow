/**
 * Cmd+K palette: navigation, actions, and agent jump.
 */
import { listAgents, type Agent } from "../lib/api/agents";
import { refreshCliWidget } from "./cli-widget";
import { selectAgentById, showView, type ViewId } from "./router";
import { showToast } from "./toast";

export type CmdKAction = {
  id: string;
  label: string;
  keywords: string;
  group: "nav" | "action" | "agent";
  run: () => void | Promise<void>;
};

let cachedActions: CmdKAction[] = [];

function closePalette(): void {
  const modal = document.getElementById("cmdk-modal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

function navAction(view: ViewId, label: string): CmdKAction {
  return {
    id: `nav-${view}`,
    label,
    keywords: `${label} ${view}`.toLowerCase(),
    group: "nav",
    run: () => {
      showView(view);
      closePalette();
    },
  };
}

async function buildActions(): Promise<CmdKAction[]> {
  const actions: CmdKAction[] = [
    navAction("overview", "跳转至 全局总览"),
    navAction("agents", "跳转至 Agent 矩阵"),
    navAction("commander", "打开 调度中枢"),
    navAction("tasks", "查看 任务中心"),
    {
      id: "action-probe-cli",
      label: "Probe CLIs — 探测本机 CLI 引擎",
      keywords: "probe cli engines 探测",
      group: "action",
      run: async () => {
        closePalette();
        await refreshCliWidget(true);
        showToast("已重新探测 CLI 引擎");
      },
    },
    {
      id: "action-import",
      label: "New import — 导入 / 新建 Agent",
      keywords: "import new agent 导入 新建",
      group: "action",
      run: () => {
        closePalette();
        const modal = document.getElementById("import-modal");
        if (!modal) return;
        modal.classList.add("active");
        modal.setAttribute("aria-hidden", "false");
        const nameInput = document.getElementById("import-agent-name");
        if (nameInput instanceof HTMLInputElement) nameInput.focus();
      },
    },
    {
      id: "action-commander",
      label: "Open commander — 调度中枢工作台",
      keywords: "commander orchestrate dispatch 调度",
      group: "action",
      run: () => {
        showView("commander");
        closePalette();
      },
    },
  ];

  let agents: Agent[] = [];
  try {
    agents = await listAgents();
  } catch {
    agents = [];
  }

  for (const a of agents) {
    actions.push({
      id: `agent-${a.id}`,
      label: `打开 Agent · ${a.name}`,
      keywords: `agent ${a.name} ${a.default_cli} ${a.workspace_path}`.toLowerCase(),
      group: "agent",
      run: () => {
        closePalette();
        void selectAgentById(a.id);
      },
    });
  }

  return actions;
}

function renderList(actions: CmdKAction[], query: string): void {
  const root = document.getElementById("cmdk-results");
  if (!root) return;

  const q = query.toLowerCase().trim();
  const filtered = q
    ? actions.filter(
        (a) => a.keywords.includes(q) || a.label.toLowerCase().includes(q),
      )
    : actions;

  if (filtered.length === 0) {
    root.innerHTML =
      '<div style="padding:12px; font-size:12px; color:var(--fg-muted);">无匹配结果</div>';
    return;
  }

  const groups: Array<{ key: CmdKAction["group"]; title: string }> = [
    { key: "nav", title: "Quick Nav" },
    { key: "action", title: "Actions" },
    { key: "agent", title: "Agents" },
  ];

  let html = "";
  for (const g of groups) {
    const items = filtered.filter((a) => a.group === g.key);
    if (items.length === 0) continue;
    html += `<div style="font-size:10.5px; color:var(--fg-muted); margin:10px 0 6px; text-transform:uppercase; letter-spacing:0.05em;">${g.title}</div>`;
    html += `<div style="display:flex; flex-direction:column; gap:4px;">`;
    for (const a of items) {
      html += `<div class="nav-item" data-cmdk-id="${a.id}" role="button" tabindex="0"><span>${a.label}</span></div>`;
    }
    html += `</div>`;
  }
  root.innerHTML = html;

  root.querySelectorAll("[data-cmdk-id]").forEach((el) => {
    const id = el.getAttribute("data-cmdk-id");
    const action = actions.find((a) => a.id === id);
    if (!action) return;
    const run = () => {
      void Promise.resolve(action.run());
    };
    el.addEventListener("click", run);
    el.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        run();
      }
    });
  });
}

export async function refreshCmdK(query = ""): Promise<void> {
  cachedActions = await buildActions();
  renderList(cachedActions, query);
}

export function filterCmdKList(inputEl: HTMLInputElement): void {
  renderList(cachedActions, inputEl.value);
}

export async function openCmdK(): Promise<void> {
  const modal = document.getElementById("cmdk-modal");
  if (!modal) return;
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  const input = modal.querySelector("input");
  if (input instanceof HTMLInputElement) {
    input.value = "";
    input.focus();
  }
  await refreshCmdK("");
}

export function closeCmdK(event?: Event): void {
  if (event) {
    const target = event.target as HTMLElement | null;
    if (target && target.id !== "cmdk-modal") return;
  }
  closePalette();
}
