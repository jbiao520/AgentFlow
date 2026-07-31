/**
 * AgentMind Tauri IPC convention (Phase 2+):
 * - Domain APIs live in `src/lib/api/*` (agents, settings, tasks).
 * - This module keeps system hello-path helpers (`ping`, `app_info`, `reveal_in_finder`).
 * - Command names are snake_case and match Rust `#[tauri::command]` fn names.
 * - Browser-only Vite preview must not crash: mock when Tauri globals are absent.
 * - CamelCase TS args map to snake_case Rust via Tauri serde rename (agentId → agent_id).
 */
import { invoke } from "@tauri-apps/api/core";

export type AppInfo = {
  name: string;
  version: string;
  tauri_version: string;
};

export type DbHealth = {
  path: string;
  ok: boolean;
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

export async function dbHealth(): Promise<DbHealth> {
  if (!isTauri()) {
    return { path: "(browser)", ok: true };
  }
  return invoke<DbHealth>("db_health");
}

export * from "./api/agents";
export * from "./api/settings";
