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

  function fillCommanderTemplate(type: number): void {
    const textarea = document.getElementById(
      "commander-prompt-text",
    ) as HTMLTextAreaElement | null;
    if (!textarea) return;
    if (type === 1) {
      textarea.value =
        "启动 Playwright 抓取竞品 A/B/C 网站的最新产品价格与促销活动，由 research-collector 提取 JSON 并汇总对比，生成 Markdown 竞品简报，并调用 workflow-orchestrator 自动发送到飞书工作群。";
    } else if (type === 2) {
      textarea.value =
        "使用 qa-regression-bot 启动无头浏览器，对主站与商城的 12 个核心页面执行 UI 巡检与断链检测，若发现加载时延超 2s 则触发告警。";
    } else if (type === 3) {
      textarea.value =
        "将本地 Markdown 周报自动转换为微信公众号与小红书美化排版，调用 web-browser-ops 登录后台发布草稿并记录排期。";
    }
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
        viewId === "tasks"
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
    fillCommanderTemplate,
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
    runSandboxTest: () => void;
  }
}
