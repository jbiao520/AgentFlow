import { listAgents } from "../lib/api/agents";
import { selectAgent, showView } from "./router";
import { filterAgents } from "./agents/matrix";
import { runSandboxTest as runSandboxTestReal } from "./agents/sandbox";
import {
  closeCmdKModal,
  closeImportModal,
  closeSkillDetailModal,
  filterCmdK,
  openCmdKModal,
  openImportModal,
  openSkillDetailModal,
  submitImportModal,
} from "./modals";
import { showToast } from "./toast";

/** Goal prompts for commander chips — capability-oriented, no fictional agent names. */
const COMMANDER_TEMPLATES: Record<number, string> = {
  1: "抓取竞品 A/B/C 网站的最新产品价格与促销活动，提取结构化 JSON 并汇总对比，生成 Markdown 竞品简报，并发送到飞书工作群。",
  2: "启动无头浏览器，对主站与商城的核心页面执行 UI 巡检与断链检测；若发现加载时延超过 2 秒则记录告警。",
  3: "将本地 Markdown 周报转换为适合微信公众号与小红书的排版草稿，整理发布清单并记录排期。",
};

/** Shared window bridges for remaining inline handlers. Task Center owns live logs. */
export function initDemoActions(): void {
  function setReasoning(pillElement: HTMLElement): void {
    const parent = pillElement.parentElement;
    parent
      ?.querySelectorAll(".reasoning-pill")
      .forEach((p) => p.classList.remove("active"));
    pillElement.classList.add("active");
    showToast(`推理深度已更新为: ${pillElement.textContent}`);
  }

  async function fillCommanderTemplate(type: number): Promise<void> {
    const textarea = document.getElementById(
      "commander-prompt-text",
    ) as HTMLTextAreaElement | null;
    if (!textarea) return;

    const prompt = COMMANDER_TEMPLATES[type];
    if (!prompt) return;

    try {
      const agents = await listAgents();
      if (agents.length === 0) {
        showToast("请先导入至少一个 Agent，再使用快捷模版");
        return;
      }
    } catch {
      // Still allow filling the prompt; orchestrate will surface a real error.
    }

    textarea.value = prompt;
    showToast("已载入模版，准备拆解");
  }

  function runSandboxTest(): void {
    void runSandboxTestReal();
  }

  const api = {
    showToast,
    switchView: (viewId: string, _nav?: Element | null) => {
      if (
        viewId === "overview" ||
        viewId === "agents" ||
        viewId === "agent-detail" ||
        viewId === "commander" ||
        viewId === "tasks" ||
        viewId === "templates" ||
        viewId === "schedules"
      ) {
        showView(viewId);
      }
    },
    selectAgent: (name: string) => {
      selectAgent(name);
    },
    filterAgents,
    setReasoning,
    openCmdKModal,
    closeCmdKModal,
    filterCmdK,
    openImportModal,
    closeImportModal,
    submitImportModal,
    openSkillDetailModal,
    closeSkillDetailModal,
    fillCommanderTemplate: (type: number) => {
      void fillCommanderTemplate(type);
    },
    runSandboxTest,
  };

  Object.assign(window, api);
}

declare global {
  interface Window {
    showToast: typeof showToast;
    switchView: (viewId: string, nav?: Element | null) => void;
    selectAgent: (name: string) => void;
    filterAgents: () => void;
    openCmdKModal: () => void;
    closeCmdKModal: (event?: Event) => void;
    openImportModal: () => void;
    closeImportModal: (event?: Event) => void;
    openSkillDetailModal: (filename: string, desc: string) => void;
    closeSkillDetailModal: (event?: Event) => void;
    fillCommanderTemplate: (type: number) => void;
    runSandboxTest: () => void;
  }
}
