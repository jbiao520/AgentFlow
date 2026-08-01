import type { Agent, AgentModelProfile } from "../../lib/api/agents";
import {
  getAgentProfile,
  listAgents,
  upsertAgent,
  upsertAgentProfile,
} from "../../lib/api/agents";
import {
  bindModelCatalogPanel,
  selectedEffort,
} from "../cli-models";
import { showToast } from "../toast";
import { findCachedAgent, getSelectedAgentId, setCachedAgents } from "./state";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

let reloadCatalog:
  | ((preferred?: {
      model?: string;
      effort?: string;
      keepUnavailable?: boolean;
    }) => Promise<void>)
  | null = null;

export function applyProfileToForm(agent: Agent): void {
  const cli = el<HTMLSelectElement>("detail-cli-select");
  if (cli) cli.value = agent.default_cli || "codex";

  const desc = el<HTMLInputElement>("detail-agent-description");
  if (desc) desc.value = agent.description || "";
}

export async function loadAgentDetailConfig(
  agentId?: string | null,
): Promise<void> {
  const id = agentId ?? getSelectedAgentId();
  if (!id) return;

  let agent = findCachedAgent(id);
  if (!agent) {
    try {
      const list = await listAgents();
      setCachedAgents(list);
      agent = list.find((a) => a.id === id);
    } catch (e) {
      showToast(`加载 Agent 失败: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
  }
  if (!agent) {
    showToast(`未找到 Agent: ${id}`);
    return;
  }

  let profile: AgentModelProfile | null = null;
  try {
    profile = await getAgentProfile(agent.id);
  } catch (e) {
    showToast(
      `加载配置失败: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  applyProfileToForm(agent);

  if (reloadCatalog) {
    await reloadCatalog({
      model: profile?.preferred_model || "",
      effort: profile?.reasoning_effort || "",
      keepUnavailable: true,
    });
  }
}

export async function saveAgentDetailConfig(): Promise<void> {
  const id = getSelectedAgentId();
  if (!id) {
    showToast("请先选择一个 Agent");
    return;
  }

  let agent = findCachedAgent(id);
  if (!agent) {
    const list = await listAgents();
    setCachedAgents(list);
    agent = list.find((a) => a.id === id);
  }
  if (!agent) {
    showToast(`未找到 Agent: ${id}`);
    return;
  }

  const cli =
    el<HTMLSelectElement>("detail-cli-select")?.value.trim() ||
    agent.default_cli;
  const model =
    el<HTMLSelectElement>("detail-model-select")?.value.trim() || null;
  const pills = el<HTMLElement>("detail-reasoning-pills");
  const reasoning = pills ? selectedEffort(pills) : "";
  const description =
    el<HTMLInputElement>("detail-agent-description")?.value.trim() || null;

  if (!model) {
    showToast("请先选择可用模型");
    return;
  }

  const engine_options_json = "{}";

  try {
    await upsertAgentProfile({
      agent_id: agent.id,
      preferred_model: model,
      reasoning_effort: reasoning,
      engine_options_json,
    });

    const updated = await upsertAgent({
      id: agent.id,
      name: agent.name,
      description,
      workspace_path: agent.workspace_path,
      git_url: agent.git_url,
      default_cli: cli,
      status: agent.status,
    });

    const list = await listAgents();
    setCachedAgents(list);
    applyProfileToForm(updated);

    if (reloadCatalog) {
      await reloadCatalog({
        model,
        effort: reasoning,
        keepUnavailable: true,
      });
    }

    showToast("Agent 参数与模型路由配置已保存");
  } catch (e) {
    showToast(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function initDetailConfig(): void {
  const cli = el<HTMLSelectElement>("detail-cli-select");
  const model = el<HTMLSelectElement>("detail-model-select");
  const pills = el<HTMLElement>("detail-reasoning-pills");

  if (cli && model && pills) {
    reloadCatalog = bindModelCatalogPanel({
      cliSelect: cli,
      modelSelect: model,
      pills,
      getPreferred: () => ({
        model: model.value.trim(),
        effort: selectedEffort(pills),
      }),
    });
  }

  document
    .getElementById("btn-save-agent-config")
    ?.addEventListener("click", () => {
      void saveAgentDetailConfig();
    });
}
