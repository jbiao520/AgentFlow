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
  deleted_at: string | null;
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

export type ImportAgentResult = {
  agent: Agent;
  cloned: boolean;
  workspace_path: string;
  skills_synced?: {
    added: number;
    updated: number;
    removed: number;
  } | null;
  skills_sync_error?: string | null;
};

export async function listAgents(): Promise<Agent[]> {
  if (!isTauri()) return [];
  return invoke<Agent[]>("list_agents");
}

export async function importAgent(input: {
  name: string;
  workspace_path_or_git: string;
  default_cli: string;
  description?: string | null;
}): Promise<ImportAgentResult> {
  if (!isTauri()) {
    throw new Error("导入 Agent 需要桌面应用（Tauri）运行时");
  }
  return invoke<ImportAgentResult>("import_agent", {
    name: input.name,
    workspacePathOrGit: input.workspace_path_or_git,
    defaultCli: input.default_cli,
    description: input.description ?? null,
  });
}

export async function upsertAgent(agent: AgentUpsert): Promise<Agent> {
  if (!isTauri()) {
    throw new Error("保存 Agent 需要桌面应用（Tauri）运行时");
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
    throw new Error("切换 Skill 需要桌面应用（Tauri）运行时");
  }
  return invoke<Skill>("set_skill_enabled", { id, enabled });
}

export type SyncSkillsResult = {
  added: number;
  updated: number;
  removed: number;
};

export async function syncAgentSkills(
  agentId: string,
): Promise<SyncSkillsResult> {
  if (!isTauri()) return { added: 0, updated: 0, removed: 0 };
  return invoke<SyncSkillsResult>("sync_agent_skills", { agentId });
}

export async function readSkillContent(
  agentId: string,
  relativePath: string,
): Promise<string> {
  if (!isTauri()) {
    throw new Error("读取 Skill 需要桌面应用（Tauri）运行时");
  }
  return invoke<string>("read_skill_content", {
    agentId,
    relativePath,
  });
}
