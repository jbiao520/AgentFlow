/**
 * Settings page: left secondary nav + right panels (brain / cli / about).
 */
import { initOrchestratorSettings, loadOrchestratorSettings } from "../orchestrator/settings";
import { initSettingsAbout, refreshSettingsAbout } from "./about";
import { initSettingsCli, refreshCliWidget } from "./cli";

export type SettingsSection = "brain" | "cli" | "about" | "language";

const SECTIONS: readonly SettingsSection[] = ["brain", "cli", "about", "language"] as const;

let currentSection: SettingsSection = "brain";
let brainInited = false;

function isSection(value: string): value is SettingsSection {
  return (SECTIONS as readonly string[]).includes(value);
}

export function showSettingsSection(section: SettingsSection): void {
  currentSection = section;

  document.querySelectorAll(".settings-nav-item").forEach((el) => {
    const id = el.getAttribute("data-settings-section");
    const active = id === section;
    el.classList.toggle("active", active);
    el.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.querySelectorAll(".settings-panel").forEach((panel) => {
    const id = panel.getAttribute("data-settings-panel");
    const active = id === section;
    panel.classList.toggle("active", active);
    if (active) {
      panel.removeAttribute("hidden");
    } else {
      panel.setAttribute("hidden", "");
    }
  });

  if (section === "brain") {
    void loadOrchestratorSettings();
  } else if (section === "cli") {
    void refreshCliWidget(false);
  } else if (section === "about") {
    void refreshSettingsAbout();
  }
}

/** Called when the top-level settings view becomes active. */
export function refreshSettings(): void {
  showSettingsSection(currentSection);
}

export function initSettings(): void {
  document.querySelectorAll(".settings-nav-item").forEach((item) => {
    const el = item as HTMLElement;
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-settings-section");
      if (id && isSection(id)) showSettingsSection(id);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        el.click();
      }
    });
  });

  if (!brainInited) {
    initOrchestratorSettings();
    brainInited = true;
  }
  initSettingsCli();
  initSettingsAbout();
  showSettingsSection(currentSection);
}
