import type {
  AgentCore,
  AgentDeleted,
  SavedAgent,
  UpdateAgentInput,
} from "@agents-core-web/agents-client";

export function requestAgentDetail(core: AgentCore, agentId: string): Promise<SavedAgent> {
  return core.retrieveAgent(agentId);
}

export function requestAgentUpdate(
  core: AgentCore,
  agentId: string,
  input: UpdateAgentInput,
): Promise<SavedAgent> {
  return core.updateAgent(agentId, input);
}

export function requestAgentDelete(core: AgentCore, agentId: string): Promise<AgentDeleted> {
  return core.deleteAgent(agentId);
}

export function replaceSavedAgent(agents: SavedAgent[], updated: SavedAgent): SavedAgent[] {
  return agents.map((agent) => (agent.id === updated.id ? updated : agent));
}

export function removeSavedAgent(agents: SavedAgent[], agentId: string): SavedAgent[] {
  return agents.filter((agent) => agent.id !== agentId);
}
