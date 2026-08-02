/** Lightweight toast notifications with optional longer / error styling. */

import { t } from "./i18n";

export type ToastKind = "info" | "error" | "success";

export type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

const TOAST_EXIT_MS = 200;

function dismissToast(toast: HTMLElement): void {
  if (toast.classList.contains("is-leaving")) return;
  toast.classList.add("is-leaving");
  window.setTimeout(() => toast.remove(), TOAST_EXIT_MS);
}

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

  window.setTimeout(() => dismissToast(toast), duration);
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
  const dismiss = (): void => dismissToast(toast);
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

export type NearConfirmOptions = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Auto-dismiss without confirming. Default 6s. */
  durationMs?: number;
};

type NearConfirmSession = {
  close: (confirmed: boolean) => void;
};

let nearConfirmSession: NearConfirmSession | null = null;

function placeNearConfirm(el: HTMLElement, anchor: HTMLElement): void {
  const gap = 8;
  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Measure after attach
  const pop = el.getBoundingClientRect();
  let top = rect.bottom + gap;
  let left = rect.right - pop.width;

  if (left < 8) left = 8;
  if (left + pop.width > vw - 8) left = Math.max(8, vw - pop.width - 8);
  if (top + pop.height > vh - 8) {
    top = Math.max(8, rect.top - pop.height - gap);
  }
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
}

/**
 * Small confirm chip anchored next to a button (for lightweight destructive actions).
 * Outside click / Escape / timeout → false. Confirm → true.
 */
export function confirmNear(
  anchor: HTMLElement,
  opts: NearConfirmOptions,
): Promise<boolean> {
  if (nearConfirmSession) nearConfirmSession.close(false);

  const pop = document.createElement("div");
  pop.className = "confirm-near";
  pop.setAttribute("role", "alertdialog");
  pop.setAttribute("aria-modal", "true");

  const msg = document.createElement("span");
  msg.className = "confirm-near-msg";
  msg.textContent = t(opts.message);

  const actions = document.createElement("span");
  actions.className = "confirm-near-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "confirm-near-btn";
  cancelBtn.textContent = t(opts.cancelLabel ?? "取消");

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "confirm-near-btn is-danger";
  confirmBtn.textContent = t(opts.confirmLabel ?? "删除");

  actions.append(cancelBtn, confirmBtn);
  pop.append(msg, actions);
  document.body.appendChild(pop);
  placeNearConfirm(pop, anchor);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(
      () => close(false),
      opts.durationMs ?? 6000,
    );

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
    };
    const onPointer = (e: Event): void => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (pop.contains(target) || anchor.contains(target)) return;
      close(false);
    };

    const close = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      nearConfirmSession = null;
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
      // Delay removal of outside listener so the opening click doesn't dismiss.
      window.setTimeout(() => {
        document.removeEventListener("pointerdown", onPointer, true);
      }, 0);
      pop.classList.add("is-leaving");
      window.setTimeout(() => pop.remove(), TOAST_EXIT_MS);
      resolve(confirmed);
    };

    nearConfirmSession = { close };
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      close(false);
    });
    confirmBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      close(true);
    });
    document.addEventListener("keydown", onKey, true);
    // Skip the click that opened us.
    window.setTimeout(() => {
      if (!settled) document.addEventListener("pointerdown", onPointer, true);
    }, 0);

    requestAnimationFrame(() => confirmBtn.focus());
  });
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
