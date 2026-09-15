import { describe, expect, it, vi } from "vitest";

import { AgentCoreError } from "@agents-core-web/agents-client";

import {
  beginPendingSend,
  failPendingSend,
  isUncertainSendFailure,
} from "./pending-send";

describe("pending message send", () => {
  it.each([400, 401, 403, 404, 422])(
    "treats permanent HTTP %i rejection as definite",
    (status) => expect(isUncertainSendFailure(new AgentCoreError("rejected", status))).toBe(false),
  );

  it.each([408, 409, 425, 429, 500, 502, 503])(
    "treats transient HTTP %i as an uncertain acceptance",
    (status) => expect(isUncertainSendFailure(new AgentCoreError("uncertain", status))).toBe(true),
  );

  it("treats a network or response-loss failure as uncertain", () => {
    expect(isUncertainSendFailure(new TypeError("fetch failed"))).toBe(true);
  });

  it("reuses the original key only for an explicit retry of an unchanged uncertain payload", () => {
    const makeKey = vi.fn(() => "new-key");
    const previous = failPendingSend(
      { sessionId: "session-1", payload: "same payload", idempotencyKey: "original-key" },
      new TypeError("response lost"),
      "response lost",
    );

    expect(beginPendingSend("session-1", "same payload", previous, makeKey)).toEqual({
      sessionId: "session-1",
      payload: "same payload",
      idempotencyKey: "original-key",
    });
    expect(makeKey).not.toHaveBeenCalled();
  });

  it("generates a new key after the restored payload is edited", () => {
    const previous = failPendingSend(
      { sessionId: "session-1", payload: "original", idempotencyKey: "original-key" },
      new AgentCoreError("temporary", 503),
      "temporary",
    );

    expect(beginPendingSend("session-1", "edited", previous, () => "edited-key").idempotencyKey)
      .toBe("edited-key");
  });

  it("generates a new key after a permanent 4xx even when the payload is unchanged", () => {
    const previous = failPendingSend(
      { sessionId: "session-1", payload: "same", idempotencyKey: "rejected-key" },
      new AgentCoreError("invalid", 422),
      "invalid",
    );

    expect(previous.uncertain).toBe(false);
    expect(beginPendingSend("session-1", "same", previous, () => "fresh-key").idempotencyKey)
      .toBe("fresh-key");
  });

  it("never reuses a key across Sessions", () => {
    const previous = failPendingSend(
      { sessionId: "session-1", payload: "same", idempotencyKey: "old-key" },
      new TypeError("response lost"),
      "response lost",
    );

    expect(beginPendingSend("session-2", "same", previous, () => "session-2-key").idempotencyKey)
      .toBe("session-2-key");
  });
});
