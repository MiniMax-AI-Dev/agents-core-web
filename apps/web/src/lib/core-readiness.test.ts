import { describe, expect, it } from "vitest";

import { AgentCoreError } from "@agents-core-web/agents-client";

import { backendFailureStatus } from "./core-readiness";

describe("backendFailureStatus", () => {
  it.each([502, 503, 504] as const)("classifies HTTP %s as backend unavailable", (status) => {
    expect(backendFailureStatus(new AgentCoreError("Core request failed.", status))).toBe(String(status));
  });

  it("classifies browser network failures without treating unrelated errors as readiness failures", () => {
    expect(backendFailureStatus(new TypeError("Failed to fetch"))).toBe("network");
    expect(backendFailureStatus("NetworkError when attempting to fetch resource.")).toBe("network");
    expect(backendFailureStatus(new AgentCoreError("Request rejected.", 400))).toBeNull();
    expect(backendFailureStatus(new Error("Agent core request failed (500)."))).toBeNull();
  });
});
