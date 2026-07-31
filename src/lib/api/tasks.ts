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
    return {
      id: "browser-mock-goal",
      prompt,
      template_key: templateKey ?? null,
      created_at: new Date().toISOString(),
    };
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
    return {
      id: "browser-mock-plan",
      goal_id: goalId,
      analysis_json: analysisJson,
      created_at: new Date().toISOString(),
    };
  }
  return invoke<Plan>("save_plan", { goalId, analysisJson });
}

export async function createTaskRun(
  goalId: string,
  planId: string,
): Promise<TaskRun> {
  if (!isTauri()) {
    return {
      id: "browser-mock-run",
      goal_id: goalId,
      plan_id: planId,
      status: "queued",
      progress: 0,
      started_at: new Date().toISOString(),
      finished_at: null,
      error: null,
    };
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

export async function updateNodeStatus(
  nodeId: string,
  status: string,
): Promise<TaskNode> {
  if (!isTauri()) {
    return {
      id: nodeId,
      run_id: "browser-mock-run",
      seq: 0,
      title: "",
      agent_id: null,
      skill_ids_json: null,
      cli_engine: null,
      model: null,
      reasoning_effort: null,
      depends_on_json: null,
      status,
      started_at: null,
      finished_at: null,
      artifact_paths_json: null,
      retry_count: 0,
    };
  }
  return invoke<TaskNode>("update_node_status", { nodeId, status });
}

export async function appendTaskLog(entry: TaskLogAppend): Promise<TaskLog> {
  if (!isTauri()) {
    return {
      id: "browser-mock-log",
      run_id: entry.run_id,
      node_id: entry.node_id ?? null,
      ts: new Date().toISOString(),
      agent_name: entry.agent_name ?? null,
      level: entry.level,
      message: entry.message,
    };
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
    return {
      id: runId,
      goal_id: "",
      plan_id: "",
      status: status ?? "running",
      progress,
      started_at: null,
      finished_at: null,
      error: null,
    };
  }
  return invoke<TaskRun>("update_run_progress", {
    runId,
    progress,
    status: status ?? null,
  });
}
