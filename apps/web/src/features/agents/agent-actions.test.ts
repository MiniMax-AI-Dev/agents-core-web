import { describe, expect, it, vi } from "vitest";

import type { AgentCore, SavedAgent } from "@agents-core-web/agents-client";

import {
  removeSavedAgent,
  replaceSavedAgent,
  requestAgentDelete,
  requestAgentDetail,
  requestAgentUpdate,
} from "./agent-actions";

const savedAgent: SavedAgent = {
  id: "agent/one",
  object: "agent",
  model: "model-a",
  name: "Builder",
  instructions: null,
  metadata: {},
  multi_agent: { enabled: false, max_concurrent_subagents: null },
  reasoning: {},
  service_tier: "auto",
  text: { format: { type: "text" }, verbosity: "medium" },
  tools: [],
  created_at: 1,
  updated_at: 1,
};

describe("Agent detail requests", () => {
  it("forwards retrieve, update, and delete exactly once without retrying writes", async () => {
    const retrieveAgent = vi.fn().mockResolvedValue(savedAgent);
    const updateAgent = vi.fn().mockResolvedValue({ ...savedAgent, model: "model-b" });
    const deleteAgent = vi.fn().mockResolvedValue({ id: savedAgent.id, object: "agent.deleted", deleted: true });
    const core = { retrieveAgent, updateAgent, deleteAgent } as unknown as AgentCore;
    const update = { model: "model-b", name: null, instructions: null, metadata: {} };

    await expect(requestAgentDetail(core, savedAgent.id)).resolves.toBe(savedAgent);
    await expect(requestAgentUpdate(core, savedAgent.id, update)).resolves.toMatchObject({ model: "model-b" });
    await expect(requestAgentDelete(core, savedAgent.id)).resolves.toMatchObject({ deleted: true });

    expect(retrieveAgent).toHaveBeenCalledOnce();
    expect(retrieveAgent).toHaveBeenCalledWith("agent/one");
    expect(updateAgent).toHaveBeenCalledOnce();
    expect(updateAgent).toHaveBeenCalledWith("agent/one", update);
    expect(deleteAgent).toHaveBeenCalledOnce();
    expect(deleteAgent).toHaveBeenCalledWith("agent/one");
  });

  it("leaves the current array unchanged when a request fails before reconciliation", async () => {
    const core = { deleteAgent: vi.fn().mockRejectedValue(new Error("delete failed")) } as unknown as AgentCore;
    const current = [savedAgent];

    await expect(requestAgentDelete(core, savedAgent.id)).rejects.toThrow("delete failed");
    expect(current).toEqual([savedAgent]);
  });

  it("reconciles only the durable Agent returned by Core and does not touch Session data", () => {
    const other = { ...savedAgent, id: "agent_two", name: "Other" };
    const updated = { ...savedAgent, name: null, updated_at: 2 };

    expect(replaceSavedAgent([savedAgent, other], updated)).toEqual([updated, other]);
    expect(removeSavedAgent([updated, other], savedAgent.id)).toEqual([other]);
  });
});
