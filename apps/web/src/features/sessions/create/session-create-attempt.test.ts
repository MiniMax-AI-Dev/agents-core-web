import { describe, expect, it } from "vitest";

import {
  beginSessionCreateAttempt,
  sessionCreateFingerprint,
} from "./session-create-attempt";

describe("Session create attempts", () => {
  it("reuses the original key only while the exact request stays unchanged", () => {
    const draft = { agentId: "agent-a", environment: { type: "none" } as const };
    const first = beginSessionCreateAttempt(draft, null, () => "key-1");
    const retry = beginSessionCreateAttempt(draft, first, () => "key-2");
    const changedAgent = beginSessionCreateAttempt({ ...draft, agentId: "agent-b" }, first, () => "key-3");
    const changedEnvironment = beginSessionCreateAttempt({
      agentId: "agent-a",
      environment: {
        type: "self_hosted" as const,
        workspace_directory: "/workspace",
        capability_directories: [],
      },
    }, first, () => "key-4");

    expect(first.idempotencyKey).toBe("key-1");
    expect(retry.idempotencyKey).toBe("key-1");
    expect(changedAgent.idempotencyKey).toBe("key-3");
    expect(changedEnvironment.idempotencyKey).toBe("key-4");
  });

  it("fingerprints the exact payload sent to Core", () => {
    expect(sessionCreateFingerprint({
      agentId: "agent-a",
      environment: {
        type: "self_hosted",
        workspace_directory: "/workspace/project",
        capability_directories: [],
      },
    })).toBe(JSON.stringify({
      agent_id: "agent-a",
      environment: {
        type: "self_hosted",
        workspace_directory: "/workspace/project",
        capability_directories: [],
      },
      stream: false,
    }));
  });
});
