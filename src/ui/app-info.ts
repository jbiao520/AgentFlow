import {
  appendTaskLog,
  createGoal,
  createTaskRun,
  dbHealth,
  deleteAgent,
  getAgentProfile,
  getAppInfo,
  getOrchestratorSettings,
  getTaskRun,
  insertTaskNodes,
  listAgents,
  listCliEngineStatus,
  listSkills,
  listTaskLogs,
  listTaskRuns,
  deleteTaskRun,
  clearTaskRuns,
  ping,
  probeCliEngines,
  revealInFinder,
  savePlan,
  setSkillEnabled,
  updateNodeStatus,
  updateOrchestratorSettings,
  updateRunProgress,
  upsertAgent,
  upsertAgentProfile,
  upsertSkills,
} from "../lib/tauri";

export async function initAppInfo(): Promise<void> {
  try {
    const info = await getAppInfo();
    document.title = `${info.name} v${info.version}`;
    await ping();
  } catch (err) {
    console.warn("initAppInfo failed", err);
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
    createGoal,
    savePlan,
    createTaskRun,
    insertTaskNodes,
    listTaskRuns,
    getTaskRun,
    deleteTaskRun,
    clearTaskRuns,
    updateNodeStatus,
    appendTaskLog,
    listTaskLogs,
    updateRunProgress,
    probeCliEngines,
    listCliEngineStatus,
  };
}
