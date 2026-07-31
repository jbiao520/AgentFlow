import { showView } from "./router";
import { showToast } from "./toast";

function isOverlayClick(event: Event | undefined, overlayId: string): boolean {
  if (!event) return true;
  const target = event.target as HTMLElement | null;
  return !!target && target.id === overlayId;
}

export function openCmdKModal(): void {
  const modal = document.getElementById("cmdk-modal");
  if (!modal) return;
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  const input = modal.querySelector("input");
  if (input instanceof HTMLInputElement) {
    input.value = "";
    input.focus();
  }
}

export function closeCmdKModal(event?: Event): void {
  if (event && !isOverlayClick(event, "cmdk-modal")) return;
  const modal = document.getElementById("cmdk-modal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

export function filterCmdK(inputEl: HTMLInputElement): void {
  const query = inputEl.value.toLowerCase().trim();
  document.querySelectorAll("#cmdk-modal .nav-item").forEach((item) => {
    const text = (item.textContent || "").toLowerCase();
    (item as HTMLElement).style.display =
      !query || text.includes(query) ? "flex" : "none";
  });
}

export function openImportModal(): void {
  const modal = document.getElementById("import-modal");
  if (!modal) return;
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
}

export function closeImportModal(event?: Event): void {
  if (event && !isOverlayClick(event, "import-modal")) return;
  const modal = document.getElementById("import-modal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

export function submitImportModal(): void {
  showToast("成功接入新 Agent 工作区！自动完成 3 个技能感知。");
  closeImportModal();
}

export function openSkillDetailModal(filename: string, desc: string): void {
  const nameEl = document.getElementById("skill-modal-filename");
  const descEl = document.getElementById("skill-modal-desc");
  if (nameEl) nameEl.textContent = filename;
  if (descEl) descEl.textContent = desc;
  document.getElementById("skill-modal")?.classList.add("active");
}

export function closeSkillDetailModal(event?: Event): void {
  if (event && !isOverlayClick(event, "skill-modal")) return;
  document.getElementById("skill-modal")?.classList.remove("active");
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

  // Cmd+K quick-nav items
  document.querySelectorAll("#cmdk-modal .nav-item[data-cmdk-view]").forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.getAttribute("data-cmdk-view");
      if (view === "overview" || view === "commander" || view === "tasks") {
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
      closeCmdKModal();
      closeImportModal();
      closeSkillDetailModal();
    }
  });
}
