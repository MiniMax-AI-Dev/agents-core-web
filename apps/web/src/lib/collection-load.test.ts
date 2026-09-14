import { describe, expect, it, vi } from "vitest";

import { settleCollection } from "./collection-load";

describe("independent Agent Core collection settlement", () => {
  it("keeps the Agents 200 result when Sessions returns 500", async () => {
    const agents = [{ id: "agent_1" }];
    const loadAgents = vi.fn().mockResolvedValue({ data: agents });
    const loadSessions = vi.fn().mockRejectedValue(new Error("GET /sessions returned 500"));

    const [agentResult, sessionResult] = await Promise.all([
      settleCollection(loadAgents),
      settleCollection(loadSessions),
    ]);

    expect(agentResult).toEqual({ status: "fulfilled", value: { data: agents } });
    expect(sessionResult).toMatchObject({ status: "rejected", reason: expect.any(Error) });
    expect(loadAgents).toHaveBeenCalledOnce();
    expect(loadSessions).toHaveBeenCalledOnce();
  });

  it("keeps the Sessions 200 result when Agents returns 500", async () => {
    const sessions = [{ id: "session_1" }];
    const loadAgents = vi.fn().mockRejectedValue(new Error("GET /agents returned 500"));
    const loadSessions = vi.fn().mockResolvedValue({ data: sessions });

    const [agentResult, sessionResult] = await Promise.all([
      settleCollection(loadAgents),
      settleCollection(loadSessions),
    ]);

    expect(agentResult).toMatchObject({ status: "rejected", reason: expect.any(Error) });
    expect(sessionResult).toEqual({ status: "fulfilled", value: { data: sessions } });
    expect(loadAgents).toHaveBeenCalledOnce();
    expect(loadSessions).toHaveBeenCalledOnce();
  });
});
