/**
 * CLI engine probe IPC. Browser mocks return all available with stub versions.
 */
import { invoke } from "@tauri-apps/api/core";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type EngineStatus = {
  engine: string;
  available: boolean;
  version: string | null;
  last_checked_at: string | null;
};

const BROWSER_MOCK: EngineStatus[] = [
  {
    engine: "cursor-agent",
    available: true,
    version: "browser-mock",
    last_checked_at: new Date().toISOString(),
  },
  {
    engine: "codex",
    available: true,
    version: "browser-mock",
    last_checked_at: new Date().toISOString(),
  },
  {
    engine: "opencode",
    available: true,
    version: "browser-mock",
    last_checked_at: new Date().toISOString(),
  },
];

export async function probeCliEngines(): Promise<EngineStatus[]> {
  if (!isTauri()) return BROWSER_MOCK.map((s) => ({ ...s }));
  return invoke<EngineStatus[]>("probe_cli_engines");
}

export async function listCliEngineStatus(): Promise<EngineStatus[]> {
  if (!isTauri()) return BROWSER_MOCK.map((s) => ({ ...s }));
  return invoke<EngineStatus[]>("list_cli_engine_status");
}
