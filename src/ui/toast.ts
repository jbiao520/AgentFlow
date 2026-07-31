/** Lightweight toast notifications with optional longer / error styling. */

export type ToastKind = "info" | "error" | "success";

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
  if (textSpan) textSpan.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.2s ease";
    window.setTimeout(() => toast.remove(), 200);
  }, duration);
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
    return `${msg} — 请安装对应 CLI，或在侧栏点「刷新」探测引擎。`;
  }
  if (lower.includes("unavailable") || lower.includes("not available")) {
    return `${msg} — CLI 不可用：安装后点击侧栏刷新探测。`;
  }
  if (
    lower.includes("json") ||
    lower.includes("parse") ||
    lower.includes("schema")
  ) {
    return `${msg} — 检查 Orchestrator 输出 JSON / 夹具格式（SPEC §7.4）。`;
  }
  if (
    lower.includes("path") ||
    lower.includes("permission") ||
    lower.includes("permission denied") ||
    lower.includes("no such file or directory")
  ) {
    return `${msg} — 确认 Workspace 路径存在且可读，或重新选择本地目录。`;
  }
  if (lower.includes("clone") || lower.includes("git")) {
    return `${msg} — 检查 Git URL / 网络，或改为绑定已有本地路径。`;
  }
  return msg;
}
