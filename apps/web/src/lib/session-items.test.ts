import { describe, expect, it } from "vitest";

import type { SessionItem } from "@agents-core-web/agents-client";

import { mergeDurableAndLiveItems, updateLiveSessionItems } from "./session-items";

function message(id: string, text: string, status: SessionItem["status"] = "completed"): SessionItem {
  return {
    id,
    turn_id: `turn:${id}`,
    type: "message",
    status,
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

describe("Session Item reconciliation", () => {
  it("starts from an empty timeline when Session B receives an event before its REST read", () => {
    const sessionAItems = [message("a-1", "Session A history")];
    const sessionBEvent = message("b-live", "Session B live output", "in_progress");

    const next = updateLiveSessionItems(
      sessionAItems,
      "session-a",
      "session-b",
      (current) => [...current, sessionBEvent],
    );

    expect(next).toEqual([sessionBEvent]);
    expect(next).not.toContain(sessionAItems[0]);
  });

  it("keeps durable order, prefers same-id live Items, and appends live-only Items", () => {
    const durableFirst = message("item-1", "durable first");
    const durableSecond = message("item-2", "durable old", "in_progress");
    const liveSecond = message("item-2", "live replacement");
    const liveOnly = message("stream:turn-3:0:0", "still streaming", "in_progress");

    expect(mergeDurableAndLiveItems(
      [durableFirst, durableSecond],
      [liveSecond, liveOnly],
    )).toEqual([durableFirst, liveSecond, liveOnly]);
  });
});
