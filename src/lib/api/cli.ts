/**
 * CLI engine probe + live model catalog IPC.
 * Browser mocks return stub catalogs so Vite preview does not fail.
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
};

export type EngineModelCatalog = {
  engine: string;
  models: EngineModel[];
  fetched_at: number;
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

const BROWSER_MODEL_MOCK: Record<string, EngineModelCatalog> = {
  "cursor-agent": {
    engine: "cursor-agent",
    fetched_at: Date.now(),
    models: [
      {
        id: "auto",
        display_name: "Auto (default)",
        efforts: [],
        default_effort: null,
      },
      {
        id: "gpt-5.6-sol",
        display_name: "GPT-5.6 Sol",
        efforts: ["high", "xhigh"],
        default_effort: "high",
      },
      {
        id: "composer-2.5",
        display_name: "Composer 2.5",
        efforts: [],
        default_effort: null,
      },
    ],
  },
  codex: {
    engine: "codex",
    fetched_at: Date.now(),
    models: [
      {
        id: "gpt-5.6-sol",
        display_name: "GPT-5.6-Sol",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        default_effort: "low",
      },
      {
        id: "gpt-5.4",
        display_name: "GPT-5.4",
        efforts: ["low", "medium", "high"],
        default_effort: "medium",
      },
    ],
  },
  opencode: {
    engine: "opencode",
    fetched_at: Date.now(),
    models: [
      {
        id: "opencode/big-pickle",
        display_name: "Big Pickle",
        efforts: [],
        default_effort: null,
      },
      {
        id: "openai/gpt-5.6-sol",
        display_name: "GPT-5.6 Sol",
        efforts: ["low", "medium", "high"],
        default_effort: "medium",
      },
    ],
  },
};

export async function probeCliEngines(): Promise<EngineStatus[]> {
  if (!isTauri()) return BROWSER_MOCK.map((s) => ({ ...s }));
  return invoke<EngineStatus[]>("probe_cli_engines");
}

export async function listCliEngineStatus(): Promise<EngineStatus[]> {
  if (!isTauri()) return BROWSER_MOCK.map((s) => ({ ...s }));
  return invoke<EngineStatus[]>("list_cli_engine_status");
}

export async function listEngineModels(
  engine: string,
  refresh = false,
): Promise<EngineModelCatalog> {
  const key = engine.trim() || "codex";
  if (!isTauri()) {
    const mock = BROWSER_MODEL_MOCK[key] ?? BROWSER_MODEL_MOCK.codex;
    return {
      ...mock,
      models: mock.models.map((m) => ({ ...m, efforts: [...m.efforts] })),
      fetched_at: Date.now(),
    };
  }
  return invoke<EngineModelCatalog>("list_engine_models", {
    engine: key,
    refresh,
  });
}
