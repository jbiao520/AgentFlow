/** Lightweight toast notifications with optional longer / error styling. */

import { t } from "./i18n";

export type ToastKind = "info" | "error" | "success";

export type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

export function showToast(
  message: string,
  opts?: { kind?: ToastKind; durationMs?: number },
): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const kind = opts?.kind ?? "info";
  const duration = opts?.durationMs ?? (kind === "error" ? 4200 : 2400);

  const toast = document.createElement("div");
  toast.className = "toast-msg";
  if (kind === "error") {
    toast.style.borderColor = "rgba(220,38,38,0.35)";
  } else if (kind === "success") {
    toast.style.borderColor = "rgba(5,150,105,0.35)";
  }
  const dotColor =
    kind === "error"
      ? "#dc2626"
      : kind === "success"
        ? "var(--accent-emerald)"
        : "";
  const dotStyle = dotColor ? ` style="background:${dotColor};"` : "";
  toast.innerHTML = `<span class="status-dot"${dotStyle}></span><span></span>`;
  const textSpan = toast.querySelector("span:last-child");
  if (textSpan) textSpan.textContent = t(message);
  container.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.2s ease";
    window.setTimeout(() => toast.remove(), 200);
  }, duration);
}

/** Show a persistent in-app notification with direct next actions. */
export function showActionToast(
  message: string,
  actions: ToastAction[],
  opts?: { kind?: ToastKind; durationMs?: number },
): void {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const kind = opts?.kind ?? "error";
  const toast = document.createElement("div");
  toast.className = "toast-msg toast-action-msg";
  if (kind === "error") toast.style.borderColor = "rgba(220,38,38,0.35)";

  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.style.background = kind === "success" ? "var(--accent-emerald)" : "#dc2626";
  const body = document.createElement("span");
  body.textContent = t(message);
  const actionBox = document.createElement("span");
  actionBox.className = "toast-actions";
  toast.append(dot, body, actionBox);
  const dismiss = (): void => toast.remove();
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action-btn";
    button.textContent = t(action.label);
    button.addEventListener("click", () => {
      dismiss();
      void action.onClick();
    });
    actionBox.appendChild(button);
  }
  container.appendChild(toast);
  window.setTimeout(dismiss, opts?.durationMs ?? 12_000);
}

/** Map common backend errors to actionable copy. */
export function formatActionableError(raw: string): string {
  const msg = raw.trim();
  const lower = msg.toLowerCase();
  if (
    lower.includes("not found") &&
    (lower.includes("cli") ||
      lower.includes("cursor-agent") ||
      lower.includes("codex") ||
      lower.includes("opencode") ||
      lower.includes("no such file") ||
      lower.includes("command"))
  ) {
    return t(`${msg} — 请安装对应 CLI，或点击侧栏左下角状态刷新探测。`);
  }
  if (lower.includes("unavailable") || lower.includes("not available")) {
    return t(`${msg} — CLI 不可用：安装后点击侧栏左下角状态刷新探测。`);
  }
  if (
    lower.includes("json") ||
    lower.includes("parse") ||
    lower.includes("schema")
  ) {
    return t(`${msg} — 检查 Orchestrator 输出 JSON 格式（SPEC §7.4）。`);
  }
  if (
    lower.includes("path") ||
    lower.includes("permission") ||
    lower.includes("permission denied") ||
    lower.includes("no such file or directory")
  ) {
    return t(`${msg} — 确认 Workspace 路径存在且可读，或重新选择本地目录。`);
  }
  if (lower.includes("clone") || lower.includes("git")) {
    return t(`${msg} — 检查 Git URL / 网络，或改为绑定已有本地路径。`);
  }
  return msg;
}
