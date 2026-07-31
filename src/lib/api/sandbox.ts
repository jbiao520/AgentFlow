/**
 * Ephemeral Agent sandbox CLI run. Streams `sandbox-log` events; no task_runs rows.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type SandboxRunArgs = {
  agent_id: string;
  prompt: string;
};

export type SandboxRunResult = {
  exit_code: number;
};

export type SandboxLogPayload = {
  ts: string;
  stream: string;
  line: string;
};

export async function sandboxRun(
  args: SandboxRunArgs,
): Promise<SandboxRunResult> {
  if (!isTauri()) {
    return { exit_code: 0 };
  }
  return invoke<SandboxRunResult>("sandbox_run", { args });
}

export async function sandboxCancel(): Promise<void> {
  if (!isTauri()) return;
  await invoke("sandbox_cancel");
}

export async function onSandboxLog(
  handler: (payload: SandboxLogPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => {};
  }
  return listen<SandboxLogPayload>("sandbox-log", (event) => {
    handler(event.payload);
  });
}
