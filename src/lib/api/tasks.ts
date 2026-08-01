/**
 * Task domain IPC wrappers (persistence only — execution is Phase 5).
 * Browser mocks return empty/defaults when not in Tauri.
 */
import { invoke } from "@tauri-apps/api/core";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type Goal = {
  id: string;
  prompt: string;
  template_key: string | null;
  created_at: string;
};

export type Plan = {
  id: string;
  goal_id: string;
  analysis_json: string;
  created_at: string;
};

export type TaskRun = {
  id: string;
  goal_id: string;
  plan_id: string;
  status: string;
  progress: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  delivery_report_json: string | null;
  schedule_id: string | null;
  is_manual: boolean;
  /** Goal prompt — human-readable title for history list. */
  goal_prompt?: string;
};

export type DeliveryChangedFile = {
  path: string;
  status: string;
  workspace: string;
};

export type DeliveryArtifact = {
  path: string;
  node_id: string;
  node_title: string;
  agent_id: string | null;
  exists: boolean;
};

export type DeliveryVerification = {
  label: string;
  status: "passed" | "failed" | "skipped" | "unknown" | string;
  detail: string;
};

export type DeliveryReport = {
  generated_at: string;
  summary: string;
  changed_files: DeliveryChangedFile[];
  diff: string | null;
  artifacts: DeliveryArtifact[];
  verification: DeliveryVerification[];
  risks: string[];
};

export type TaskNode = {
  id: string;
  run_id: string;
  seq: number;
  title: string;
  agent_id: string | null;
  skill_ids_json: string | null;
  cli_engine: string | null;
  model: string | null;
  reasoning_effort: string | null;
  depends_on_json: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  artifact_paths_json: string | null;
  retry_count: number;
};

export type TaskNodeInsert = {
  id?: string | null;
  seq: number;
  title: string;
  agent_id?: string | null;
  skill_ids_json?: string | null;
  cli_engine?: string | null;
  model?: string | null;
  reasoning_effort?: string | null;
  depends_on_json?: string | null;
  status?: string | null;
  artifact_paths_json?: string | null;
};

export type TaskRunWithNodes = {
  run: TaskRun;
  nodes: TaskNode[];
};

export type TaskLog = {
  id: string;
  run_id: string;
  node_id: string | null;
  ts: string;
  agent_name: string | null;
  level: string;
  message: string;
};

export type TaskLogAppend = {
  run_id: string;
  node_id?: string | null;
  agent_name?: string | null;
  level: string;
  message: string;
};

export async function createGoal(
  prompt: string,
  templateKey?: string | null,
): Promise<Goal> {
  if (!isTauri()) {
    throw new Error("createGoal requires Tauri runtime");
  }
  return invoke<Goal>("create_goal", {
    prompt,
    templateKey: templateKey ?? null,
  });
}

export async function savePlan(
  goalId: string,
  analysisJson: string,
): Promise<Plan> {
  if (!isTauri()) {
    throw new Error("savePlan requires Tauri runtime");
  }
  return invoke<Plan>("save_plan", { goalId, analysisJson });
}

export async function createTaskRun(
  goalId: string,
  planId: string,
): Promise<TaskRun> {
  if (!isTauri()) {
    throw new Error("createTaskRun requires Tauri runtime");
  }
  return invoke<TaskRun>("create_task_run", { goalId, planId });
}

export async function insertTaskNodes(
  runId: string,
  nodes: TaskNodeInsert[],
): Promise<TaskNode[]> {
  if (!isTauri()) return [];
  return invoke<TaskNode[]>("insert_task_nodes", { runId, nodes });
}

export async function listTaskRuns(limit = 50): Promise<TaskRun[]> {
  if (!isTauri()) return [];
  return invoke<TaskRun[]>("list_task_runs", { limit });
}

export async function getTaskRun(
  id: string,
): Promise<TaskRunWithNodes | null> {
  if (!isTauri()) return null;
  return invoke<TaskRunWithNodes | null>("get_task_run", { id });
}

export async function deleteTaskRun(runId: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("deleteTaskRun requires Tauri runtime");
  }
  await invoke("delete_task_run", { runId });
}

export async function clearTaskRuns(): Promise<number> {
  if (!isTauri()) {
    throw new Error("clearTaskRuns requires Tauri runtime");
  }
  return invoke<number>("clear_task_runs");
}

export async function updateNodeStatus(
  nodeId: string,
  status: string,
): Promise<TaskNode> {
  if (!isTauri()) {
    throw new Error("updateNodeStatus requires Tauri runtime");
  }
  return invoke<TaskNode>("update_node_status", { nodeId, status });
}

export async function appendTaskLog(entry: TaskLogAppend): Promise<TaskLog> {
  if (!isTauri()) {
    throw new Error("appendTaskLog requires Tauri runtime");
  }
  return invoke<TaskLog>("append_task_log", { entry });
}

export async function listTaskLogs(
  runId: string,
  agentFilter?: string | null,
): Promise<TaskLog[]> {
  if (!isTauri()) return [];
  return invoke<TaskLog[]>("list_task_logs", {
    runId,
    agentFilter: agentFilter ?? null,
  });
}

export async function updateRunProgress(
  runId: string,
  progress: number,
  status?: string | null,
): Promise<TaskRun> {
  if (!isTauri()) {
    throw new Error("updateRunProgress requires Tauri runtime");
  }
  return invoke<TaskRun>("update_run_progress", {
    runId,
    progress,
    status: status ?? null,
  });
}

export type DispatchResult = {
  run: TaskRun;
  nodes: TaskNode[];
};

export type StartRunResult = {
  run_id: string;
  started: boolean;
};

export type TaskLogEvent = {
  run_id: string;
  node_id: string | null;
  ts: string;
  agent_name: string | null;
  level: string;
  message: string;
};

export type TaskRunUpdatedEvent = {
  run: TaskRun;
  nodes: TaskNode[];
};

export type WorkspaceFileResult = {
  path: string;
  content: string;
};

export type RevealArtifactResult = {
  revealed_path: string;
  existed: boolean;
  fallback: boolean;
};

export async function dispatchPlan(planId: string): Promise<DispatchResult> {
  if (!isTauri()) {
    throw new Error("dispatchPlan requires Tauri runtime");
  }
  return invoke<DispatchResult>("dispatch_plan", { planId });
}

export async function startRun(
  runId: string,
  concurrency?: number | null,
): Promise<StartRunResult> {
  if (!isTauri()) {
    throw new Error("startRun requires Tauri runtime");
  }
  return invoke<StartRunResult>("start_run", {
    runId,
    concurrency: concurrency ?? null,
  });
}

export async function cancelRun(runId: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("cancelRun requires Tauri runtime");
  }
  await invoke("cancel_run", { runId });
}

export async function retryNode(
  runId: string,
  nodeId: string,
): Promise<TaskNode> {
  if (!isTauri()) {
    throw new Error("retryNode requires Tauri runtime");
  }
  return invoke<TaskNode>("retry_node", { runId, nodeId });
}

export async function retryRun(runId: string): Promise<StartRunResult> {
  if (!isTauri()) {
    throw new Error("retryRun requires Tauri runtime");
  }
  return invoke<StartRunResult>("retry_run", { runId });
}

export async function skipNode(
  runId: string,
  nodeId: string,
): Promise<TaskNode> {
  if (!isTauri()) {
    throw new Error("skipNode requires Tauri runtime");
  }
  return invoke<TaskNode>("skip_node", { runId, nodeId });
}

export async function readWorkspaceFile(
  agentId: string,
  relativePath: string,
): Promise<WorkspaceFileResult> {
  if (!isTauri()) {
    throw new Error("readWorkspaceFile requires Tauri runtime");
  }
  return invoke<WorkspaceFileResult>("read_workspace_file", {
    agentId,
    relativePath,
  });
}

export async function revealWorkspaceArtifact(
  agentId: string,
  relativePath: string,
): Promise<RevealArtifactResult> {
  if (!isTauri()) {
    throw new Error("revealWorkspaceArtifact requires Tauri runtime");
  }
  return invoke<RevealArtifactResult>("reveal_workspace_artifact", {
    agentId,
    relativePath,
  });
}
