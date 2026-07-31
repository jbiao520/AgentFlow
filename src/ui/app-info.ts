import {
  dbHealth,
  deleteAgent,
  getAgentProfile,
  getAppInfo,
  getOrchestratorSettings,
  listAgents,
  listSkills,
  ping,
  revealInFinder,
  setSkillEnabled,
  updateOrchestratorSettings,
  upsertAgent,
  upsertAgentProfile,
  upsertSkills,
} from "../lib/tauri";

export async function initAppInfo(): Promise<void> {
  const badge = document.querySelector(".titlebar-badge");
  try {
    const info = await getAppInfo();
    if (badge) {
      badge.textContent = `${info.name} v${info.version}`;
      (badge as HTMLElement).title = `Tauri ${info.tauri_version} — click to reveal /Applications`;
      badge.addEventListener("click", () => {
        void revealInFinder("/Applications").catch((err) => {
          console.warn("revealInFinder failed", err);
        });
      });
    }

    const pong = await ping();
    const footer = document.querySelector(".cli-engine-widget");
    if (footer && pong === "pong") {
      const hint = document.createElement("div");
      hint.style.cssText =
        "font-size:10px;color:var(--fg-muted);margin-top:8px;font-family:var(--font-mono);";
      hint.textContent = "IPC: ping → pong";
      footer.appendChild(hint);
    }
  } catch (err) {
    console.warn("initAppInfo failed", err);
    if (badge) badge.textContent = "AgentMind";
  }

  (window as unknown as { __agentmindDebug: unknown }).__agentmindDebug = {
    ping,
    getAppInfo,
    revealInFinder,
    dbHealth,
    listAgents,
    upsertAgent,
    deleteAgent,
    getAgentProfile,
    upsertAgentProfile,
    listSkills,
    upsertSkills,
    setSkillEnabled,
    getOrchestratorSettings,
    updateOrchestratorSettings,
  };
}
