/** Appearance theme: light / dark / system (default). Persisted in localStorage. */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "agentflow.theme";
const THEME_EVENT = "agentflow-theme-change";

let mediaQuery: MediaQueryList | null = null;
let mediaHandler: ((event: MediaQueryListEvent) => void) | null = null;
let menuOpen = false;

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function readThemePreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Storage can be unavailable in restricted WebViews.
  }
  return "system";
}

export function resolveTheme(preference: ThemePreference = readThemePreference()): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemPrefersDark() ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference = readThemePreference()): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-theme-pref", preference);
  syncThemeControls(preference, resolved);
  return resolved;
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Session still applies even if persistence fails.
  }
  const resolved = applyTheme(preference);
  window.dispatchEvent(
    new CustomEvent(THEME_EVENT, { detail: { preference, resolved } }),
  );
}

export function onThemeChange(
  listener: (detail: { preference: ThemePreference; resolved: ResolvedTheme }) => void,
): () => void {
  const handler = (event: Event) =>
    listener((event as CustomEvent<{ preference: ThemePreference; resolved: ResolvedTheme }>).detail);
  window.addEventListener(THEME_EVENT, handler);
  return () => window.removeEventListener(THEME_EVENT, handler);
}

function themeLabel(preference: ThemePreference, english: boolean): string {
  if (english) {
    if (preference === "light") return "Light";
    if (preference === "dark") return "Dark";
    return "System";
  }
  if (preference === "light") return "浅色";
  if (preference === "dark") return "深色";
  return "跟随系统";
}

function setThemeMenuOpen(open: boolean): void {
  const menu = document.getElementById("theme-menu");
  const btn = document.getElementById("theme-menu-btn");
  const panel = document.getElementById("theme-menu-panel");
  if (!menu || !btn || !panel) return;

  menuOpen = open;
  menu.classList.toggle("is-open", open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  panel.hidden = !open;
}

function syncThemeControls(preference: ThemePreference, resolved: ResolvedTheme): void {
  document.querySelectorAll<HTMLElement>("[data-theme-option]").forEach((el) => {
    const value = el.getAttribute("data-theme-option");
    const active = value === preference;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-checked", active ? "true" : "false");
  });

  const trigger = document.getElementById("theme-menu-btn");
  if (trigger) {
    const english = document.documentElement.lang === "en";
    const label = themeLabel(preference, english);
    const tip = english ? `Appearance: ${label}` : `外观主题：${label}`;
    trigger.setAttribute("data-theme-current", preference);
    trigger.setAttribute("aria-label", tip);
    trigger.setAttribute("title", english ? "Appearance theme" : "外观主题");
    trigger.querySelectorAll("[data-theme-icon]").forEach((icon) => {
      const show = icon.getAttribute("data-theme-icon") === preference;
      (icon as HTMLElement).hidden = !show;
    });
  }

  document.documentElement.setAttribute("data-theme-resolved", resolved);
}

function bindMediaListener(): void {
  if (!window.matchMedia) return;
  mediaQuery?.removeEventListener?.("change", mediaHandler as EventListener);
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaHandler = () => {
    if (readThemePreference() === "system") {
      const resolved = applyTheme("system");
      window.dispatchEvent(
        new CustomEvent(THEME_EVENT, {
          detail: { preference: "system" as ThemePreference, resolved },
        }),
      );
    }
  };
  mediaQuery.addEventListener("change", mediaHandler);
}

function bindThemeMenu(): void {
  const menu = document.getElementById("theme-menu");
  const btn = document.getElementById("theme-menu-btn");
  const panel = document.getElementById("theme-menu-panel");
  if (!menu || !btn || !panel) return;

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    setThemeMenuOpen(!menuOpen);
  });

  panel.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    if (menuOpen) setThemeMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuOpen) {
      setThemeMenuOpen(false);
      btn.focus();
    }
  });
}

export function initTheme(): void {
  applyTheme(readThemePreference());
  bindMediaListener();
  bindThemeMenu();

  document.querySelectorAll<HTMLElement>("[data-theme-option]").forEach((el) => {
    el.addEventListener("click", () => {
      const value = el.getAttribute("data-theme-option");
      if (value === "light" || value === "dark" || value === "system") {
        setThemePreference(value);
        if (el.closest("#theme-menu-panel")) {
          setThemeMenuOpen(false);
        }
      }
    });
  });

  window.addEventListener("agentflow-language-change", () => {
    syncThemeControls(readThemePreference(), resolveTheme());
  });
}
