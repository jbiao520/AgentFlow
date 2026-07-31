/**
 * Overview aggregation IPC wrappers. Browser mocks return empty/defaults.
 */
import { invoke } from "@tauri-apps/api/core";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type OverviewStats = {
  agent_count: number;
  agents_healthy_pct: number;
  running_tasks: number;
  completed_today: number;
  success_rate_today: number;
  tokens_display: string;
};

export type TopologyNode = {
  id: string;
  kind: string;
  label: string;
  sublabel: string;
  status: string;
};

export type TopologyEdge = {
  from_id: string;
  to_id: string;
  style: string;
};

export type OverviewTopology = {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  caption: string;
};

export type QueueItem = {
  run_id: string;
  goal_prompt: string;
  status: string;
  progress: number;
  agent_names: string[];
  cli_engines: string[];
  node_count: number;
  started_at: string | null;
  elapsed_label: string;
};

export async function getOverviewStats(): Promise<OverviewStats> {
  if (!isTauri()) {
    return {
      agent_count: 0,
      agents_healthy_pct: 100,
      running_tasks: 0,
      completed_today: 0,
      success_rate_today: 100,
      tokens_display: "n/a",
    };
  }
  return invoke<OverviewStats>("get_overview_stats");
}

export async function getOverviewTopology(): Promise<OverviewTopology> {
  if (!isTauri()) {
    return {
      nodes: [
        {
          id: "orchestrator",
          kind: "orchestrator",
          label: "Dispatch Hub",
          sublabel: "调度中枢",
          status: "idle",
        },
      ],
      edges: [],
      caption: "浏览器预览模式",
    };
  }
  return invoke<OverviewTopology>("get_overview_topology");
}

export async function listRunningQueue(): Promise<QueueItem[]> {
  if (!isTauri()) return [];
  return invoke<QueueItem[]>("list_running_queue");
}
