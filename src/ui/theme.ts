/** Appearance theme: light / dark / system (default). Persisted in localStorage. */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "agentflow.theme";
const THEME_EVENT = "agentflow-theme-change";

let mediaQuery: MediaQueryList | null = null;
let mediaHandler: ((event: MediaQueryListEvent) => void) | null = null;

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

function syncThemeControls(preference: ThemePreference, resolved: ResolvedTheme): void {
  document.querySelectorAll<HTMLElement>("[data-theme-option]").forEach((el) => {
    const value = el.getAttribute("data-theme-option");
    const active = value === preference;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-checked", active ? "true" : "false");
  });

  const cycle = document.getElementById("theme-cycle-btn");
  if (cycle) {
    const english = document.documentElement.lang === "en";
    const label = themeLabel(preference, english);
    const tip = english
      ? `Theme: ${label} (click to switch)`
      : `主题：${label}（点击切换）`;
    cycle.setAttribute("data-theme-current", preference);
    cycle.setAttribute("aria-label", tip);
    cycle.setAttribute("title", tip);
    cycle.querySelectorAll("[data-theme-icon]").forEach((icon) => {
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

function cyclePreference(current: ThemePreference): ThemePreference {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}

export function initTheme(): void {
  applyTheme(readThemePreference());
  bindMediaListener();

  document.querySelectorAll<HTMLElement>("[data-theme-option]").forEach((el) => {
    el.addEventListener("click", () => {
      const value = el.getAttribute("data-theme-option");
      if (value === "light" || value === "dark" || value === "system") {
        setThemePreference(value);
      }
    });
  });

  const cycle = document.getElementById("theme-cycle-btn");
  if (cycle) {
    cycle.addEventListener("click", () => {
      setThemePreference(cyclePreference(readThemePreference()));
    });
  }

  window.addEventListener("agentflow-language-change", () => {
    syncThemeControls(readThemePreference(), resolveTheme());
  });
}
