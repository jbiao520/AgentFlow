/**
 * Keep external links out of the Tauri webview.
 *
 * Clicking http(s)/mailto/tel in rendered markdown otherwise navigates the
 * entire app surface with no back affordance. Open those in the system browser
 * (or a new tab in pure browser preview).
 */
import { openUrl } from "@tauri-apps/plugin-opener";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isExternalUrl(href: string): boolean {
  try {
    const url = new URL(href, window.location.href);
    if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return false;
    // Same-origin http(s) stays in-app (Vite dev / tauri.localhost).
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin !== window.location.origin;
    }
    return true;
  } catch {
    return false;
  }
}

function findAnchor(event: Event): HTMLAnchorElement | null {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const node of path) {
    if (node instanceof HTMLAnchorElement) return node;
  }
  const t = event.target;
  if (t instanceof Element) {
    return t.closest("a[href]");
  }
  return null;
}

async function openExternal(href: string): Promise<void> {
  if (isTauriRuntime()) {
    await openUrl(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

/**
 * Install once at app boot. Safe to call multiple times.
 */
export function initExternalLinkHandler(): void {
  const flag = "__agentflowExternalLinksBound";
  const w = window as Window & { [flag]?: boolean };
  if (w[flag]) return;
  w[flag] = true;

  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented) return;
      if (!(event instanceof MouseEvent)) return;
      // Only primary button without modifiers that mean "open differently".
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = findAnchor(event);
      if (!anchor) return;
      const href = anchor.href;
      if (!href || !isExternalUrl(href)) return;

      event.preventDefault();
      event.stopPropagation();
      void openExternal(href).catch((err) => {
        console.warn("[AgentFlow] failed to open external URL", href, err);
        // Last resort: still try not to leave the app; copy is better than navigate.
      });
    },
    true,
  );
}
