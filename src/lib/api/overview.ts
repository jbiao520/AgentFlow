/**
 * Overview aggregation IPC wrappers. Browser mocks return empty/defaults.
 */
import { invoke } from "@tauri-apps/api/core";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type UsageBreakdown = {
  engine: string;
  provider: string;
  model: string;
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost: number | null;
  estimated: boolean;
  runs: number;
};

export type OverviewStats = {
  agent_count: number;
  agents_healthy_pct: number;
  running_tasks: number;
  completed_today: number;
  success_rate_today: number;
  tokens_total: number;
  tokens_cost: number | null;
  usage_breakdown: UsageBreakdown[];
};

export type RecentAgentUsage = {
  agent_id: string;
  name: string;
  default_cli: string;
  status: string;
  calls_1d: number;
  calls_7d: number;
  calls_30d: number;
  last_used_at: string | null;
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
      tokens_total: 0,
      tokens_cost: null,
      usage_breakdown: [],
    };
  }
  return invoke<OverviewStats>("get_overview_stats");
}

export async function listRecentAgents(): Promise<RecentAgentUsage[]> {
  if (!isTauri()) return [];
  return invoke<RecentAgentUsage[]>("list_recent_agents");
}

export async function listRunningQueue(): Promise<QueueItem[]> {
  if (!isTauri()) return [];
  return invoke<QueueItem[]>("list_running_queue");
}
