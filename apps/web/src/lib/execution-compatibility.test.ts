import { describe, expect, it, vi } from "vitest";

import {
  ExecutionCompatibilityError,
  executionWriteBlocker,
  guardedExecutionWrite,
  normalizeExecutionCompatibility,
} from "./execution-compatibility";

describe("execution compatibility", () => {
  const scope = { connectionGeneration: 7, sessionId: "session-1" };
  const forgedSupported = {
    state: "supported" as const,
    proof: { ...scope, contractVersion: "agents-execution/v1" },
  };

  it.each([
    undefined,
    null,
    "",
    "ready",
    { state: "supported" },
    { state: "supported", proof: { ...scope, contractVersion: "" } },
    { state: "supported", proof: { ...scope, connectionGeneration: 6, contractVersion: "agents-execution/v1" } },
    { state: "supported", proof: { ...scope, sessionId: "session-2", contractVersion: "agents-execution/v1" } },
    forgedSupported,
  ])("normalizes malformed or unproven input to unknown", (value) => {
    expect(normalizeExecutionCompatibility(value, scope)).toEqual({ state: "unknown" });
    expect(executionWriteBlocker(value, scope)).toContain("not publicly proven");
  });

  it("keeps unsupported distinct without enabling writes", () => {
    expect(normalizeExecutionCompatibility({ state: "unsupported" }, scope)).toEqual({ state: "unsupported" });
    expect(executionWriteBlocker({ state: "unsupported" }, scope)).toContain("reports this execution profile as unsupported");
  });

  it.each([{ state: "unknown" }, { state: "unsupported" }, { state: "supported" }, forgedSupported])(
    "blocks the final write callback for %j",
    async (compatibility) => {
      const write = vi.fn(async () => "written");

      await expect(guardedExecutionWrite(compatibility, scope, write)).rejects.toBeInstanceOf(
        ExecutionCompatibilityError,
      );
      expect(write).not.toHaveBeenCalled();
    },
  );

});
