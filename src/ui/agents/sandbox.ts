import {
  onSandboxLog,
  sandboxCancel,
  sandboxRun,
  type SandboxLogPayload,
} from "../../lib/api/sandbox";
import { listCliEngineStatus } from "../../lib/api/cli";
import { getSelectedAgentId, findCachedAgent } from "./state";
import { formatActionableError, showToast } from "../toast";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(isoOrLocal?: string): string {
  if (!isoOrLocal) {
    return new Date().toTimeString().split(" ")[0] ?? "";
  }
  const t = isoOrLocal.includes("T")
    ? isoOrLocal.split("T")[1]?.replace(/Z$/, "").slice(0, 8)
    : isoOrLocal.slice(0, 8);
  return t || isoOrLocal;
}

function appendLogLine(payload: SandboxLogPayload): void {
  const term = document.getElementById("sandbox-term");
  if (!term) return;
  const level =
    payload.stream === "stderr"
      ? payload.line.startsWith("$")
        ? "log-exec"
        : "log-warn"
      : "log-ok";
  const tag =
    payload.stream === "stderr"
      ? payload.line.startsWith("$")
        ? "[EXEC]"
        : "[ERR]"
      : "[OUT]";
  const line = document.createElement("div");
  line.className = "log-line";
  line.innerHTML = `<span class="log-time">${escapeHtml(formatTime(payload.ts))}</span><span class="${level}">${tag}</span> ${escapeHtml(payload.line)}`;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

function setExitCode(code: number | string): void {
  const el = document.getElementById("sandbox-exit-code");
  if (el) el.textContent = `Exit: ${code}`;
}

let engineAvailable = true;
let engineHint = "";

function setRunning(running: boolean): void {
  const btn = document.getElementById(
    "sandbox-run-btn",
  ) as HTMLButtonElement | null;
  const cancelBtn = document.getElementById(
    "sandbox-cancel-btn",
  ) as HTMLButtonElement | null;
  if (btn) {
    const allow = engineAvailable && !running;
    btn.disabled = !allow;
    btn.textContent = running
      ? "运行中…"
      : engineAvailable
        ? "运行测试"
        : "CLI 不可用";
    btn.title = engineAvailable
      ? "在 Agent Workspace 中运行沙盒 Prompt"
      : engineHint || "当前 Agent 的 CLI 引擎不可用";
    btn.style.opacity = allow ? "1" : "0.55";
  }
  if (cancelBtn) {
    cancelBtn.disabled = !running;
  }
}

let running = false;
let unlisten: (() => void) | null = null;

export async function refreshSandboxAvailability(): Promise<void> {
  const agentId = getSelectedAgentId();
  const agent = agentId ? findCachedAgent(agentId) : null;
  const engine = agent?.default_cli?.trim() || "";
  if (!engine) {
    engineAvailable = false;
    engineHint = "请先选择 Agent";
    setRunning(running);
    return;
  }
  try {
    const statuses = await listCliEngineStatus();
    const st = statuses.find((s) => s.engine === engine);
    engineAvailable = !!st?.available;
    engineHint = engineAvailable
      ? ""
      : `${engine} 未安装或不可用 — 安装后点侧栏刷新探测`;
  } catch {
    engineAvailable = true;
    engineHint = "";
  }
  setRunning(running);
  const hintEl = document.getElementById("sandbox-engine-hint");
  if (hintEl) {
    hintEl.textContent = engineAvailable ? "" : engineHint;
    (hintEl as HTMLElement).style.display = engineAvailable ? "none" : "block";
  }
}

export async function runSandboxTest(): Promise<void> {
  if (running) {
    showToast("沙盒已在运行中");
    return;
  }

  await refreshSandboxAvailability();
  if (!engineAvailable) {
    showToast(engineHint || "CLI 引擎不可用，无法运行沙盒", { kind: "error" });
    return;
  }

  const agentId = getSelectedAgentId();
  if (!agentId) {
    showToast("请先选择一个 Agent", { kind: "error" });
    return;
  }

  const promptEl = document.getElementById(
    "sandbox-prompt",
  ) as HTMLInputElement | null;
  const prompt = promptEl?.value?.trim() ?? "";
  if (!prompt) {
    showToast("请输入沙盒 Prompt");
    return;
  }

  const agent = findCachedAgent(agentId);
  const engine = agent?.default_cli ?? "cli";
  const header = document.getElementById("sandbox-term-header");
  if (header) {
    header.textContent = `Terminal Stream · ${engine}`;
  }

  const term = document.getElementById("sandbox-term");
  if (term) {
    term.innerHTML = "";
  }
  setExitCode("…");

  running = true;
  setRunning(true);

  try {
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
    unlisten = await onSandboxLog(appendLogLine);

    const result = await sandboxRun({ agent_id: agentId, prompt });
    setExitCode(result.exit_code);
    if (result.exit_code === 0) {
      showToast("沙盒测试完成", { kind: "success" });
    } else {
      showToast(`沙盒退出码 ${result.exit_code}`, { kind: "error" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLogLine({
      ts: new Date().toISOString(),
      stream: "stderr",
      line: msg,
    });
    setExitCode("err");
    showToast(`沙盒失败: ${formatActionableError(msg)}`, { kind: "error" });
  } finally {
    running = false;
    setRunning(false);
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  }
}

export async function cancelSandboxTest(): Promise<void> {
  try {
    await sandboxCancel();
    showToast("已请求取消沙盒");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast(formatActionableError(msg), { kind: "error" });
  }
}

export function initSandbox(): void {
  setRunning(false);
  const cancelBtn = document.getElementById("sandbox-cancel-btn");
  cancelBtn?.addEventListener("click", () => {
    void cancelSandboxTest();
  });
  void refreshSandboxAvailability();
}
