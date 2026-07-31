import type { Agent } from "../../lib/api/agents";

let cachedAgents: Agent[] = [];
let selectedAgentId: string | null = null;

export function getCachedAgents(): Agent[] {
  return cachedAgents;
}

export function setCachedAgents(agents: Agent[]): void {
  cachedAgents = agents;
}

export function getSelectedAgentId(): string | null {
  return selectedAgentId;
}

export function setSelectedAgentId(id: string | null): void {
  selectedAgentId = id;
}

export function findCachedAgent(idOrName: string): Agent | undefined {
  return (
    cachedAgents.find((a) => a.id === idOrName) ||
    cachedAgents.find((a) => a.name === idOrName)
  );
}
