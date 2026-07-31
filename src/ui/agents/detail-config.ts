import type { Agent, AgentModelProfile } from "../../lib/api/agents";
import {
  getAgentProfile,
  listAgents,
  upsertAgent,
  upsertAgentProfile,
} from "../../lib/api/agents";
import { findCachedAgent, getSelectedAgentId, setCachedAgents } from "./state";
import { showToast } from "../toast";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function parseEngineOptions(json: string | null | undefined): {
  playwright_mode: string;
} {
  try {
    if (json) {
      const obj = JSON.parse(json) as { playwright_mode?: string };
      if (obj.playwright_mode === "headed" || obj.playwright_mode === "headless") {
        return { playwright_mode: obj.playwright_mode };
      }
    }
  } catch {
    /* ignore */
  }
  return { playwright_mode: "headless" };
}

function selectedReasoning(): string {
  const active = document.querySelector(
    "#detail-reasoning-pills .reasoning-pill.active",
  );
  return (active?.getAttribute("data-reasoning") || "medium").toLowerCase();
}

function setReasoningActive(effort: string): void {
  const target = effort.toLowerCase();
  document
    .querySelectorAll("#detail-reasoning-pills .reasoning-pill")
    .forEach((p) => {
      const v = (p.getAttribute("data-reasoning") || "").toLowerCase();
      p.classList.toggle("active", v === target);
    });
}

export function applyProfileToForm(
  agent: Agent,
  profile: AgentModelProfile | null,
): void {
  const cli = el<HTMLSelectElement>("detail-cli-select");
  if (cli) cli.value = agent.default_cli || "codex";

  const model = el<HTMLSelectElement>("detail-model-select");
  if (model) {
    const preferred = profile?.preferred_model || "claude-3.7-sonnet";
    if (![...model.options].some((o) => o.value === preferred)) {
      const opt = document.createElement("option");
      opt.value = preferred;
      opt.textContent = preferred;
      model.appendChild(opt);
    }
    model.value = preferred;
  }

  setReasoningActive(profile?.reasoning_effort || "medium");

  const temp = el<HTMLInputElement>("detail-temperature");
  const tempVal = el<HTMLElement>("temp-val");
  const t = profile?.temperature ?? 0.2;
  if (temp) temp.value = String(t);
  if (tempVal) tempVal.textContent = String(t);

  const auto = el<HTMLInputElement>("detail-auto-route");
  if (auto) auto.checked = profile?.auto_route ?? true;

  const pw = el<HTMLSelectElement>("detail-playwright-mode");
  if (pw) {
    pw.value = parseEngineOptions(profile?.engine_options_json).playwright_mode;
  }

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
  applyProfileToForm(agent, profile);
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
  const reasoning = selectedReasoning();
  const temperature = parseFloat(
    el<HTMLInputElement>("detail-temperature")?.value || "0.2",
  );
  const autoRoute = el<HTMLInputElement>("detail-auto-route")?.checked ?? true;
  const playwright =
    el<HTMLSelectElement>("detail-playwright-mode")?.value || "headless";
  const description =
    el<HTMLInputElement>("detail-agent-description")?.value.trim() || null;

  const engine_options_json = JSON.stringify({
    playwright_mode: playwright,
  });

  try {
    await upsertAgentProfile({
      agent_id: agent.id,
      preferred_model: model,
      reasoning_effort: reasoning,
      temperature: Number.isFinite(temperature) ? temperature : 0.2,
      auto_route: autoRoute,
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

    // refresh cache entry
    const list = await listAgents();
    setCachedAgents(list);
    applyProfileToForm(updated, {
      agent_id: agent.id,
      preferred_model: model,
      reasoning_effort: reasoning,
      temperature: Number.isFinite(temperature) ? temperature : 0.2,
      auto_route: autoRoute,
      engine_options_json,
    });

    showToast("Agent 参数与模型路由配置已保存");
  } catch (e) {
    showToast(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function initDetailConfig(): void {
  document
    .getElementById("btn-save-agent-config")
    ?.addEventListener("click", () => {
      void saveAgentDetailConfig();
    });

  document
    .querySelectorAll("#detail-reasoning-pills .reasoning-pill")
    .forEach((pill) => {
      pill.addEventListener("click", () => {
        document
          .querySelectorAll("#detail-reasoning-pills .reasoning-pill")
          .forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        showToast(`推理深度已更新为: ${pill.textContent}`);
      });
    });

  const temp = el<HTMLInputElement>("detail-temperature");
  temp?.addEventListener("input", () => {
    const val = el<HTMLElement>("temp-val");
    if (val) val.textContent = temp.value;
  });
}
