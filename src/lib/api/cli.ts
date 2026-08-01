/**
 * CLI engine probe + live model catalog IPC.
 * Browser (non-Tauri) preview returns unavailable stubs — never fake readiness.
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

export type EngineModel = {
  id: string;
  display_name: string;
  efforts: string[];
  default_effort: string | null;
  /** Cursor: base model has a `-fast` catalog variant. */
  supports_fast?: boolean;
};

export type EngineModelCatalog = {
  engine: string;
  models: EngineModel[];
  fetched_at: number;
};

const BROWSER_ENGINES = ["cursor-agent", "codex", "opencode"] as const;

/** Honest preview stubs: engines exist in the UI, but none are available. */
function browserEngineStatuses(): EngineStatus[] {
  return BROWSER_ENGINES.map((engine) => ({
    engine,
    available: false,
    version: null,
    last_checked_at: null,
  }));
}

function browserEmptyCatalog(engine: string): EngineModelCatalog {
  return {
    engine,
    models: [],
    fetched_at: Date.now(),
  };
}

export async function probeCliEngines(): Promise<EngineStatus[]> {
  if (!isTauri()) return browserEngineStatuses();
  return invoke<EngineStatus[]>("probe_cli_engines");
}

export async function listCliEngineStatus(): Promise<EngineStatus[]> {
  if (!isTauri()) return browserEngineStatuses();
  return invoke<EngineStatus[]>("list_cli_engine_status");
}

export async function listEngineModels(
  engine: string,
  refresh = false,
): Promise<EngineModelCatalog> {
  const key = engine.trim() || "codex";
  if (!isTauri()) return browserEmptyCatalog(key);
  return invoke<EngineModelCatalog>("list_engine_models", {
    engine: key,
    refresh,
  });
}
