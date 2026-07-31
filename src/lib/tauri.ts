/**
 * AgentMind Tauri IPC convention (Phase 2+):
 * - All backend calls go through typed wrappers in this module or `src/lib/api/*`.
 * - Command names are snake_case and match Rust `#[tauri::command]` fn names.
 * - Browser-only Vite preview must not crash: mock when Tauri globals are absent.
 */
import { invoke } from "@tauri-apps/api/core";

export type AppInfo = {
  name: string;
  version: string;
  tauri_version: string;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function ping(): Promise<string> {
  if (!isTauri()) return "pong";
  return invoke<string>("ping");
}

export async function getAppInfo(): Promise<AppInfo> {
  if (!isTauri()) {
    return {
      name: "AgentMind",
      version: "0.1.0",
      tauri_version: "browser",
    };
  }
  return invoke<AppInfo>("app_info");
}

export async function revealInFinder(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("reveal_in_finder", { path });
}
