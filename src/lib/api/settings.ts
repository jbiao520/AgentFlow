/**
 * Orchestrator settings IPC wrappers. Browser mocks return defaults when not in Tauri.
 */
import { invoke } from "@tauri-apps/api/core";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type OrchestratorSettings = {
  id: number;
  cli_engine: string;
  model: string;
  reasoning_effort: string;
  use_fast: boolean;
  updated_at: string;
};

export type OrchestratorSettingsUpdate = {
  cli_engine: string;
  model: string;
  reasoning_effort: string;
  use_fast: boolean;
};

const DEFAULT_SETTINGS: OrchestratorSettings = {
  id: 1,
  cli_engine: "codex",
  model: "sol",
  reasoning_effort: "medium",
  use_fast: false,
  updated_at: new Date(0).toISOString(),
};

export async function getOrchestratorSettings(): Promise<OrchestratorSettings> {
  if (!isTauri()) return { ...DEFAULT_SETTINGS };
  return invoke<OrchestratorSettings>("get_orchestrator_settings");
}

export async function updateOrchestratorSettings(
  settings: OrchestratorSettingsUpdate,
): Promise<OrchestratorSettings> {
  if (!isTauri()) {
    return {
      id: 1,
      ...settings,
      updated_at: new Date().toISOString(),
    };
  }
  return invoke<OrchestratorSettings>("update_orchestrator_settings", {
    settings,
  });
}
