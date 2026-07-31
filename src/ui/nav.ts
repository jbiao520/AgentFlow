import { isViewId, showView, type ViewId } from "./router";

const NAV_TO_VIEW: Record<string, ViewId> = {
  "nav-overview": "overview",
  "nav-agents": "agents",
  "nav-agent-detail": "agent-detail",
  "nav-commander": "commander",
  "nav-tasks": "tasks",
};

/** Bind sidebar nav items (data-view preferred, data-od-id fallback). */
export function bindNav(): void {
  document.querySelectorAll(".sidebar .nav-item").forEach((item) => {
    const el = item as HTMLElement;
    let viewAttr = el.getAttribute("data-view");
    if (!viewAttr) {
      const odId = el.getAttribute("data-od-id") || "";
      viewAttr = NAV_TO_VIEW[odId] ?? null;
      if (viewAttr) el.setAttribute("data-view", viewAttr);
    }

    el.addEventListener("click", () => {
      const id = el.getAttribute("data-view");
      if (id && isViewId(id)) {
        showView(id);
      }
    });

    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        el.click();
      }
    });
  });
}
