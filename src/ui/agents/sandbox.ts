import {
  onSandboxLog,
  sandboxCancel,
  sandboxRun,
  type SandboxLogPayload,
} from "../../lib/api/sandbox";
import { getSelectedAgentId, findCachedAgent } from "./state";
import { showToast } from "../toast";

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
  // Prefer HH:MM:SS from ISO or local
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

function setRunning(running: boolean): void {
  const btn = document.getElementById(
    "sandbox-run-btn",
  ) as HTMLButtonElement | null;
  const cancelBtn = document.getElementById(
    "sandbox-cancel-btn",
  ) as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = running;
    btn.textContent = running ? "运行中…" : "运行测试";
  }
  if (cancelBtn) {
    cancelBtn.disabled = !running;
  }
}

let running = false;
let unlisten: (() => void) | null = null;

export async function runSandboxTest(): Promise<void> {
  if (running) {
    showToast("沙盒已在运行中");
    return;
  }

  const agentId = getSelectedAgentId();
  if (!agentId) {
    showToast("请先选择一个 Agent");
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
      showToast("沙盒测试完成");
    } else {
      showToast(`沙盒退出码 ${result.exit_code}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLogLine({
      ts: new Date().toISOString(),
      stream: "stderr",
      line: msg,
    });
    setExitCode("err");
    showToast(`沙盒失败: ${msg}`);
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
    showToast(msg);
  }
}

export function initSandbox(): void {
  setRunning(false);
  const cancelBtn = document.getElementById("sandbox-cancel-btn");
  cancelBtn?.addEventListener("click", () => {
    void cancelSandboxTest();
  });
}
