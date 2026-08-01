/**
 * Modal overlays: Cmd+K, import agent, skill detail.
 */
import {
  closeCmdK,
  filterCmdKList,
  openCmdK,
} from "./cmdk";
import { submitImportModal as runImportSubmit } from "./agents/import-modal";
import { showView } from "./router";

type ConfirmActionOptions = {
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
};

let confirmResolver: ((confirmed: boolean) => void) | null = null;
let confirmPreviousFocus: HTMLElement | null = null;

function isOverlayClick(event: Event | undefined, overlayId: string): boolean {
  if (!event) return true;
  const target = event.target as HTMLElement | null;
  return !!target && target.id === overlayId;
}

export function openCmdKModal(): void {
  void openCmdK();
}

export function closeCmdKModal(event?: Event): void {
  closeCmdK(event);
}

export function filterCmdK(inputEl: HTMLInputElement): void {
  filterCmdKList(inputEl);
}

export function openImportModal(): void {
  const modal = document.getElementById("import-modal");
  if (!modal) return;
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  const nameInput = document.getElementById("import-agent-name");
  if (nameInput instanceof HTMLInputElement) nameInput.focus();
}

export function closeImportModal(event?: Event): void {
  if (event && !isOverlayClick(event, "import-modal")) return;
  const modal = document.getElementById("import-modal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

export function submitImportModal(): void {
  void runImportSubmit();
}

export function openSkillDetailModal(
  filename: string,
  desc: string,
  bodyHtmlOrText?: string,
): void {
  const nameEl = document.getElementById("skill-modal-filename");
  const descEl = document.getElementById("skill-modal-desc");
  const bodyEl = document.getElementById("skill-modal-body");
  if (nameEl) nameEl.textContent = filename;
  if (descEl) descEl.textContent = desc;
  if (bodyEl && bodyHtmlOrText !== undefined) {
    bodyEl.textContent = bodyHtmlOrText;
  }
  document.getElementById("skill-modal")?.classList.add("active");
}

export function closeSkillDetailModal(event?: Event): void {
  if (event && !isOverlayClick(event, "skill-modal")) return;
  document.getElementById("skill-modal")?.classList.remove("active");
}

export function openUsageDetailModal(): void {
  const modal = document.getElementById("usage-detail-modal");
  if (!modal) return;
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    document.getElementById("usage-detail-close")?.focus();
  });
}

export function closeUsageDetailModal(event?: Event): void {
  if (event && !isOverlayClick(event, "usage-detail-modal")) return;
  const modal = document.getElementById("usage-detail-modal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

function settleConfirmAction(confirmed: boolean): void {
  const resolver = confirmResolver;
  if (!resolver) return;

  confirmResolver = null;
  const modal = document.getElementById("confirm-modal");
  modal?.classList.remove("active");
  modal?.setAttribute("aria-hidden", "true");

  const previousFocus = confirmPreviousFocus;
  confirmPreviousFocus = null;
  previousFocus?.focus();
  resolver(confirmed);
}

/**
 * Show an app-native asynchronous confirmation dialog.
 *
 * Do not use window.confirm in Tauri's WKWebView: its synchronous JavaScript
 * dialog support is not reliable across Wry/WebKit versions.
 */
export function confirmAction(
  message: string,
  options: ConfirmActionOptions = {},
): Promise<boolean> {
  if (confirmResolver) {
    // A destructive action is already awaiting confirmation. Ignore duplicate
    // clicks instead of replacing its resolver and leaving a Promise pending.
    return Promise.resolve(false);
  }

  const modal = document.getElementById("confirm-modal");
  const title = document.getElementById("confirm-modal-title");
  const body = document.getElementById("confirm-modal-message");
  const submit = document.getElementById(
    "confirm-modal-submit",
  ) as HTMLButtonElement | null;
  const cancel = document.getElementById(
    "confirm-modal-cancel",
  ) as HTMLButtonElement | null;

  if (!modal || !title || !body || !submit || !cancel) {
    return Promise.reject(new Error("confirmation dialog is not mounted"));
  }

  title.textContent = options.title ?? "确认操作";
  body.textContent = message;
  submit.textContent = options.confirmLabel ?? "确认";
  submit.classList.toggle("btn-danger", options.destructive !== false);
  submit.classList.toggle("btn-primary", options.destructive === false);

  confirmPreviousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");

  return new Promise<boolean>((resolve) => {
    confirmResolver = resolve;
    requestAnimationFrame(() => {
      if (confirmResolver) cancel.focus();
    });
  });
}

/** Wire buttons that should not rely solely on inline handlers. */
export function bindModals(): void {
  document
    .querySelector('[data-od-id="cmd-k-btn"]')
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      openCmdKModal();
    });

  document.getElementById("cmdk-modal")?.addEventListener("click", (e) => {
    closeCmdKModal(e);
  });
  document
    .querySelector("#cmdk-modal .modal-card")
    ?.addEventListener("click", (e) => e.stopPropagation());

  document.getElementById("import-modal")?.addEventListener("click", (e) => {
    closeImportModal(e);
  });
  document
    .querySelector("#import-modal .modal-card")
    ?.addEventListener("click", (e) => e.stopPropagation());

  document.getElementById("skill-modal")?.addEventListener("click", (e) => {
    closeSkillDetailModal(e);
  });
  document
    .querySelector("#skill-modal .modal-card")
    ?.addEventListener("click", (e) => e.stopPropagation());

  document.getElementById("usage-detail-modal")?.addEventListener("click", (e) => {
    closeUsageDetailModal(e);
  });
  document
    .querySelector("#usage-detail-modal .modal-card")
    ?.addEventListener("click", (e) => e.stopPropagation());
  document
    .getElementById("usage-detail-close")
    ?.addEventListener("click", () => closeUsageDetailModal());

  document.getElementById("confirm-modal")?.addEventListener("click", (e) => {
    if (isOverlayClick(e, "confirm-modal")) settleConfirmAction(false);
  });
  document
    .querySelector("#confirm-modal .modal-card")
    ?.addEventListener("click", (e) => e.stopPropagation());
  document
    .getElementById("confirm-modal-cancel")
    ?.addEventListener("click", () => settleConfirmAction(false));
  document
    .getElementById("confirm-modal-submit")
    ?.addEventListener("click", () => settleConfirmAction(true));

  // Legacy static nav items (if present) — primary list is rendered by cmdk.ts
  document.querySelectorAll("#cmdk-modal .nav-item[data-cmdk-view]").forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.getAttribute("data-cmdk-view");
      if (
        view === "overview" ||
        view === "agents" ||
        view === "commander" ||
        view === "tasks"
      ) {
        showView(view);
        closeCmdKModal();
      }
    });
  });

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openCmdKModal();
    }
    if (e.key === "Escape") {
      // Always consume Escape in-app. On macOS, an unhandled Esc bubbles to
      // the system and exits native fullscreen (especially with focused inputs).
      e.preventDefault();

      const hadOverlay =
        !!confirmResolver ||
        document.getElementById("cmdk-modal")?.classList.contains("active") ||
        document.getElementById("import-modal")?.classList.contains("active") ||
        document.getElementById("skill-modal")?.classList.contains("active") ||
        document.getElementById("usage-detail-modal")?.classList.contains("active") ||
        document.getElementById("confirm-modal")?.classList.contains("active");

      settleConfirmAction(false);
      closeCmdKModal();
      closeImportModal();
      closeSkillDetailModal();
      closeUsageDetailModal();

      // No overlay: blur focused field (e.g. agent search) so Esc feels local.
      if (!hadOverlay) {
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement
        ) {
          active.blur();
        }
      }
    }
  });
}
