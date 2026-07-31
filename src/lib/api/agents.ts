/**
 * Agent registry IPC wrappers. Browser mocks return empty/defaults when not in Tauri.
 */
import { invoke } from "@tauri-apps/api/core";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type Agent = {
  id: string;
  name: string;
  description: string | null;
  workspace_path: string;
  git_url: string | null;
  default_cli: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type AgentUpsert = {
  id?: string | null;
  name: string;
  description?: string | null;
  workspace_path: string;
  git_url?: string | null;
  default_cli: string;
  status?: string | null;
};

export type AgentModelProfile = {
  agent_id: string;
  preferred_model: string | null;
  reasoning_effort: string | null;
  temperature: number | null;
  auto_route: boolean;
  engine_options_json: string | null;
};

export type Skill = {
  id: string;
  agent_id: string;
  relative_path: string;
  title: string | null;
  description: string | null;
  enabled: boolean;
  content_hash: string | null;
  scanned_at: string | null;
};

export type SkillUpsert = {
  id?: string | null;
  agent_id: string;
  relative_path: string;
  title?: string | null;
  description?: string | null;
  enabled?: boolean | null;
  content_hash?: string | null;
};

export async function listAgents(): Promise<Agent[]> {
  if (!isTauri()) return [];
  return invoke<Agent[]>("list_agents");
}

export async function upsertAgent(agent: AgentUpsert): Promise<Agent> {
  if (!isTauri()) {
    const now = new Date().toISOString();
    return {
      id: agent.id ?? "browser-mock-agent",
      name: agent.name,
      description: agent.description ?? null,
      workspace_path: agent.workspace_path,
      git_url: agent.git_url ?? null,
      default_cli: agent.default_cli,
      status: agent.status ?? "idle",
      created_at: now,
      updated_at: now,
    };
  }
  return invoke<Agent>("upsert_agent", { agent });
}

export async function deleteAgent(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("delete_agent", { id });
}

export async function getAgentProfile(
  agentId: string,
): Promise<AgentModelProfile | null> {
  if (!isTauri()) return null;
  return invoke<AgentModelProfile | null>("get_agent_profile", {
    agentId,
  });
}

export async function upsertAgentProfile(
  profile: AgentModelProfile,
): Promise<AgentModelProfile> {
  if (!isTauri()) return profile;
  return invoke<AgentModelProfile>("upsert_agent_profile", { profile });
}

export async function listSkills(agentId: string): Promise<Skill[]> {
  if (!isTauri()) return [];
  return invoke<Skill[]>("list_skills", { agentId });
}

export async function upsertSkills(skills: SkillUpsert[]): Promise<Skill[]> {
  if (!isTauri()) return [];
  return invoke<Skill[]>("upsert_skills", { skills });
}

export async function setSkillEnabled(
  id: string,
  enabled: boolean,
): Promise<Skill> {
  if (!isTauri()) {
    return {
      id,
      agent_id: "browser-mock",
      relative_path: "",
      title: null,
      description: null,
      enabled,
      content_hash: null,
      scanned_at: null,
    };
  }
  return invoke<Skill>("set_skill_enabled", { id, enabled });
}
