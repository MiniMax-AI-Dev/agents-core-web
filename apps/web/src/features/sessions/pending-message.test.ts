import { describe, expect, it } from "vitest";

import type { SessionItem } from "@agents-core-web/agents-client";

import { beginLocalPendingMessage, hasDurablePendingMessage } from "./pending-message";

function message(id: string, role: "user" | "assistant", text: string): SessionItem {
  return {
    id,
    turn_id: `turn-${id}`,
    type: "message",
    status: "completed",
    role,
    content: [{ type: role === "user" ? "input_text" : "output_text", text }],
  };
}

describe("local pending message projection", () => {
  it("waits for a new matching durable user Item", () => {
    const existing = message("item-existing", "user", "same text");
    const pending = beginLocalPendingMessage("session-1", "same text", [existing]);

    expect(hasDurablePendingMessage(pending, [existing])).toBe(false);
    expect(hasDurablePendingMessage(pending, [
      existing,
      message("item-assistant", "assistant", "same text"),
      message("item-different", "user", "different text"),
    ])).toBe(false);
    expect(hasDurablePendingMessage(pending, [
      existing,
      message("item-confirmed", "user", "same text"),
    ])).toBe(true);
  });

  it("matches split durable input text using the rendered newline projection", () => {
    const pending = beginLocalPendingMessage("session-1", "first\nsecond", []);
    const durable: SessionItem = {
      id: "item-confirmed",
      turn_id: "turn-confirmed",
      type: "message",
      status: "completed",
      role: "user",
      content: [
        { type: "input_text", text: "first" },
        { type: "input_text", text: "second" },
      ],
    };

    expect(hasDurablePendingMessage(pending, [durable])).toBe(true);
  });
});
