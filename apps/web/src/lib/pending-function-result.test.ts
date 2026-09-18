import { describe, expect, it, vi } from "vitest";

import { AgentCoreError, type FunctionResultInput } from "@agents-core-web/agents-client";

import {
  beginPendingFunctionResult,
  failPendingFunctionResult,
  functionResultActionKey,
  functionResultAttemptPayload,
} from "./pending-function-result";

const textResult: FunctionResultInput = {
  callId: "call-1",
  turnId: "turn-1",
  success: true,
  output: "same result",
};

describe("pending Function result", () => {
  it("uses the Session, Turn, and call as the action identity", () => {
    expect(functionResultActionKey("session-1", textResult)).toBe(
      JSON.stringify(["session-1", "turn-1", "call-1"]),
    );
  });

  it("preserves structured content order in the retry fingerprint", () => {
    const first: FunctionResultInput = {
      ...textResult,
      output: [
        { type: "input_text", text: "first" },
        { type: "input_image", image_url: "https://example.test/image.png" },
      ],
    };
    const reordered: FunctionResultInput = {
      ...first,
      output: [...first.output!].reverse() as typeof first.output,
    };
    expect(functionResultAttemptPayload(first)).not.toBe(functionResultAttemptPayload(reordered));
  });

  it("reuses the original key only after an uncertain unchanged failure", () => {
    const original = beginPendingFunctionResult("session-1", textResult, undefined, () => "original-key");
    const failed = failPendingFunctionResult(original, new TypeError("response lost"), "response lost");
    const makeKey = vi.fn(() => "new-key");

    expect(beginPendingFunctionResult("session-1", textResult, failed, makeKey).idempotencyKey)
      .toBe("original-key");
    expect(makeKey).not.toHaveBeenCalled();
  });

  it("generates a new key after payload edits or a definite rejection", () => {
    const original = beginPendingFunctionResult("session-1", textResult, undefined, () => "original-key");
    const uncertain = failPendingFunctionResult(original, new AgentCoreError("temporary", 503), "temporary");
    const edited = { ...textResult, output: "edited result" };
    expect(beginPendingFunctionResult("session-1", edited, uncertain, () => "edited-key").idempotencyKey)
      .toBe("edited-key");

    const rejected = failPendingFunctionResult(original, new AgentCoreError("invalid", 422), "invalid");
    expect(beginPendingFunctionResult("session-1", textResult, rejected, () => "rejected-key").idempotencyKey)
      .toBe("rejected-key");
  });

  it("never reuses a key for another Session or Function action", () => {
    const original = beginPendingFunctionResult("session-1", textResult, undefined, () => "original-key");
    const failed = failPendingFunctionResult(original, new TypeError("response lost"), "response lost");
    expect(beginPendingFunctionResult("session-2", textResult, failed, () => "session-key").idempotencyKey)
      .toBe("session-key");
    expect(beginPendingFunctionResult(
      "session-1",
      { ...textResult, callId: "call-2" },
      failed,
      () => "action-key",
    ).idempotencyKey).toBe("action-key");
  });
});
