import { describe, expect, it } from "vitest";

import type { SessionItem } from "@agents-core-web/agents-client";

import {
  mergeDurableAndLiveItems,
  reconcileSessionItem,
  updateLiveSessionItems,
  upsertSessionItem,
} from "./session-items";

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

  it.each(["completed", "failed", "incomplete"] as const)(
    "does not regress a durable %s Item to stale live in_progress",
    (status) => {
      const durable = message("item-1", `durable ${status}`, status);
      const staleLive = message("item-1", "stale live", "in_progress");

      expect(mergeDurableAndLiveItems([durable], [staleLive])).toEqual([durable]);
      expect(upsertSessionItem([durable], staleLive)).toEqual([durable]);
    },
  );

  it("allows a terminal live Item to replace an in-progress durable Item", () => {
    const durable = message("item-1", "durable pending", "in_progress");
    const live = message("item-1", "live completed", "completed");

    expect(reconcileSessionItem(durable, live)).toEqual(live);
  });

  it("is idempotent for duplicate same-ID terminal events", () => {
    const terminal = message("item-1", "completed", "completed");

    expect(upsertSessionItem(upsertSessionItem([], terminal), terminal)).toEqual([terminal]);
  });

  it("deduplicates out-of-order live values without regressing their terminal state", () => {
    const terminal = message("item-1", "completed", "completed");
    const stale = message("item-1", "stale", "in_progress");

    expect(mergeDurableAndLiveItems([], [terminal, stale, terminal])).toEqual([terminal]);
    expect(mergeDurableAndLiveItems([stale], [terminal, stale])).toEqual([terminal]);
  });
});
