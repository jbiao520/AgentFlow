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

/** Remaining prototype demos (logs, commander). Sandbox uses real CLI (Phase 4). */
export function initDemoActions(): void {
  let isStreamActive = true;
  let streamInterval: number | null = null;

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

  function dispatchCommanderTask(): void {
    const w = window as unknown as { dispatchCommanderTask?: () => void };
    // workbench overwrites this after init
    showToast("请先完成调度拆解后再分发");
    void w;
  }

  function runSandboxTest(): void {
    void runSandboxTestReal();
  }

  function clearLogs(): void {
    const body = document.getElementById("live-terminal-body");
    if (body) {
      body.innerHTML =
        '<div class="log-line"><span class="log-time">System</span> Logs cleared.</div>';
    }
    showToast("终端日志已清空");
  }

  function copyTerminalLogs(): void {
    showToast("终端日志已复制到剪贴板！");
  }

  function startLogSimulation(): void {
    if (streamInterval) window.clearInterval(streamInterval);
    const mockLogs = [
      {
        time: "10:15:26",
        agent: "[research-collector]",
        tag: "log-ok",
        label: "[SYNC]",
        text: "Syncing markdown payload to feishu-webhook buffer...",
      },
      {
        time: "10:15:30",
        agent: "[workflow-orchestrator]",
        tag: "log-exec",
        label: "[BOT]",
        text: "Feishu Webhook triggered successfully. HTTP 200 OK.",
      },
      {
        time: "10:15:35",
        agent: "[web-browser-ops]",
        tag: "log-ok",
        label: "[CLEANUP]",
        text: "Playwright browser context closed cleanly.",
      },
    ];
    let idx = 0;
    streamInterval = window.setInterval(() => {
      if (!isStreamActive) return;
      if (idx >= mockLogs.length) {
        if (streamInterval) window.clearInterval(streamInterval);
        return;
      }
      const item = mockLogs[idx++];
      const body = document.getElementById("live-terminal-body");
      if (body) {
        const line = document.createElement("div");
        line.className = "log-line";
        line.setAttribute("data-agent", "collector");
        line.innerHTML = `<span class="log-time">${item.time}</span><span class="log-agent">${item.agent}</span><span class="${item.tag}">${item.label}</span> ${item.text}`;
        body.appendChild(line);
        body.scrollTop = body.scrollHeight;
      }
    }, 4500);
  }

  function toggleLiveLogStream(): void {
    const btn = document.getElementById("toggle-stream-btn");
    if (!btn) return;
    if (isStreamActive) {
      isStreamActive = false;
      btn.textContent = "▶ 恢复日志流";
      if (streamInterval) window.clearInterval(streamInterval);
      showToast("已暂停日志流");
    } else {
      isStreamActive = true;
      btn.textContent = "⏸ 暂停日志流";
      startLogSimulation();
      showToast("已恢复日志流");
    }
  }

  function filterTermTab(tabEl: HTMLElement, filterType: string): void {
    document
      .querySelectorAll(".term-tab")
      .forEach((t) => t.classList.remove("active"));
    tabEl.classList.add("active");
    document.querySelectorAll("#live-terminal-body .log-line").forEach((line) => {
      if (filterType === "all") {
        (line as HTMLElement).style.display = "block";
      } else {
        const agent = line.getAttribute("data-agent");
        (line as HTMLElement).style.display =
          agent === filterType ? "block" : "none";
      }
    });
  }

  function filterTerminalByAgent(agentName: string): void {
    showToast(`已按 Agent [${agentName}] 过滤日志视角`);
  }

  function switchTaskHistory(cardEl: HTMLElement, taskId: string): void {
    document
      .querySelectorAll(".task-item-card")
      .forEach((c) => c.classList.remove("active"));
    cardEl.classList.add("active");
    showToast(`切换至任务视角: ${taskId}`);
  }

  /** Bridge for remaining inline onclick handlers in app-shell.html */
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
    dispatchCommanderTask,
    runSandboxTest,
    clearLogs,
    copyTerminalLogs,
    toggleLiveLogStream,
    filterTermTab,
    filterTerminalByAgent,
    switchTaskHistory,
  };

  Object.assign(window, api);
  startLogSimulation();
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
