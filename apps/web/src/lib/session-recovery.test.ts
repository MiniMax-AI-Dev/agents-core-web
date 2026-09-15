import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@agents-core-web/agents-client";

import {
  createDurableRefreshCoordinator,
  createStreamRecoveryBuffer,
  terminalDurableRefreshKey,
} from "./session-recovery";

function event(type: string, eventId: string): SessionEvent {
  return { type, event_id: eventId, session_id: "session-1" } as SessionEvent;
}

describe("Session durable recovery", () => {
  it("buffers after stream acceptance, then applies events after the durable read", () => {
    const order = ["stream accepted"];
    const recovery = createStreamRecoveryBuffer();
    const token = recovery.begin();
    recovery.accept(event("unknown.future.event", "unknown-1"), () => order.push("unknown"));
    recovery.accept(event("agent.session.turn.completed", "turn-1"), () => order.push("terminal"));
    order.push("durable Session/Items");

    expect(recovery.finish(token, () => true, (value) => order.push(value.event_id))).toBe(true);
    expect(order).toEqual([
      "stream accepted",
      "durable Session/Items",
      "unknown-1",
      "turn-1",
    ]);
  });

  it("isolates buffered events after a Session or Core switch", () => {
    const apply = vi.fn();
    const recovery = createStreamRecoveryBuffer();
    const staleToken = recovery.begin();
    recovery.accept(event("agent.session.turn.completed", "late"), apply);
    recovery.invalidate();

    expect(recovery.finish(staleToken, () => true, apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("keeps unknown and no-op events from blocking later events", () => {
    const applied: string[] = [];
    const recovery = createStreamRecoveryBuffer();
    recovery.accept(event("unknown.future.event", "unknown"), (value) => applied.push(value.event_id));
    recovery.accept(event("agent.session.turn.completed", "later"), (value) => applied.push(value.event_id));

    expect(applied).toEqual(["unknown", "later"]);
  });

  it("recognizes only terminal Session, Turn, and Environment events", () => {
    expect(terminalDurableRefreshKey(event("agent.session.idle", "1"))).toBe("session:session-1");
    expect(terminalDurableRefreshKey(event("agent.session.turn.completed", "2"))).toBe("turn:current");
    expect(terminalDurableRefreshKey({
      ...event("agent.session.environment.failed", "3"),
      environment: { id: "env-1", type: "docker", status: "failed", error: null },
    } as SessionEvent)).toBe("environment:env-1");
    expect(terminalDurableRefreshKey(event("agent.session.turn.in_progress", "4"))).toBeNull();
    expect(terminalDurableRefreshKey(event("unknown.future.event", "5"))).toBeNull();
  });

  it("deduplicates duplicate terminal events and never requests a stream reconnect", async () => {
    let release: (() => void) | undefined;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const coordinator = createDurableRefreshCoordinator(refresh);
    const terminal = event("agent.session.turn.completed", "terminal-1");

    expect(coordinator.accept(terminal)).toBe(true);
    expect(coordinator.accept(terminal)).toBe(false);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    coordinator.accept(event("agent.session.environment.connected", "terminal-2"));
    coordinator.accept(event("agent.session.failed", "terminal-3"));
    release?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
