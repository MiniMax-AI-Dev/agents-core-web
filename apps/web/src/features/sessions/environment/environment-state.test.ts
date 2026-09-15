import { describe, expect, it } from "vitest";

import type { AgentSession, SessionEvent } from "@agents-core-web/agents-client";

import {
  environmentObservationFromEvent,
  reduceEnvironmentObservation,
  reconcileEnvironmentObservation,
  visibleEnvironmentObservation,
} from "./environment-state";

function event(status: string, environment: Record<string, unknown> = {}): SessionEvent {
  return {
    type: `agent.session.environment.${status}`,
    event_id: `event_${status}`,
    session_id: "session_1",
    environment: {
      id: "environment_1",
      type: "self_hosted",
      status,
      error: null,
      ...environment,
    },
  } as unknown as SessionEvent;
}

function session(environment: AgentSession["environment"]): AgentSession {
  return { id: "session_1", environment } as AgentSession;
}

describe("Environment live state", () => {
  it.each(["pending", "ready", "connected", "disconnected", "failed"])(
    "admits pinned %s events",
    (status) => {
      expect(environmentObservationFromEvent(event(status))).toMatchObject({
        environmentId: "environment_1",
        environmentType: "self_hosted",
        status,
        eventId: `event_${status}`,
      });
    },
  );

  it("fails closed for future, mismatched, and missing event fields", () => {
    expect(environmentObservationFromEvent(event("expired"))).toBeNull();
    expect(environmentObservationFromEvent(event("paused"))).toBeNull();
    expect(environmentObservationFromEvent(event("connected", { status: "failed" }))).toBeNull();
    expect(environmentObservationFromEvent(event("connected", { id: "" }))).toBeNull();
    expect(environmentObservationFromEvent({ ...event("connected"), event_id: "" } as SessionEvent)).toBeNull();
    expect(environmentObservationFromEvent({ ...event("connected"), session_id: undefined } as SessionEvent)).toBeNull();
    expect(environmentObservationFromEvent({
      type: "agent.session.environment.connected",
      event_id: "missing",
    } as SessionEvent)).toBeNull();
  });

  it("clears a prior connected claim on expired, future, or malformed Environment events", () => {
    const connected = environmentObservationFromEvent(event("connected"));
    expect(reduceEnvironmentObservation(connected, event("expired"))).toBeNull();
    expect(reduceEnvironmentObservation(connected, event("paused"))).toBeNull();
    expect(reduceEnvironmentObservation(connected, event("connected", { status: "failed" }))).toBeNull();
    expect(reduceEnvironmentObservation(connected, { ...event("connected"), event_id: "" } as SessionEvent)).toBeNull();
    expect(reduceEnvironmentObservation(connected, { ...event("connected"), session_id: undefined } as SessionEvent)).toBeNull();
    expect(reduceEnvironmentObservation(connected, {
      ...event("connected"),
      session_id: 42,
    } as unknown as SessionEvent, "session_1")).toBeNull();
    expect(reduceEnvironmentObservation(connected, {
      ...event("connected"),
      session_id: { forged: true },
    } as unknown as SessionEvent, "session_1")).toBeNull();
    expect(reduceEnvironmentObservation(
      connected,
      { ...event("failed"), session_id: "another_session" } as SessionEvent,
      "session_1",
    )).toBe(connected);
    expect(reduceEnvironmentObservation(connected, {
      type: "agent.session.turn.completed",
      event_id: "turn_done",
    } as SessionEvent)).toBe(connected);
  });

  it("retains structured errors without treating malformed fields as trusted", () => {
    expect(environmentObservationFromEvent(event("failed", {
      error: { code: 9, type: null, message: ["private"] },
    }))).toMatchObject({
      error: {
        code: "unknown_error",
        type: "environment_error",
        message: "The Environment reported an error without a safe message.",
      },
    });
  });

  it("keeps an observation only while durable Environment identity still matches", () => {
    const observation = environmentObservationFromEvent(event("connected"));
    expect(reconcileEnvironmentObservation(observation, session({
      type: "self_hosted",
      id: "environment_1",
      remote_url: "https://executor.example",
      workspace_directory: "/workspace",
      capability_directories: [],
    }))).toBe(observation);
    expect(reconcileEnvironmentObservation(observation, session({ type: "none" }))).toBeNull();
    expect(reconcileEnvironmentObservation(observation, session({
      type: "self_hosted",
      id: "environment_2",
      remote_url: "https://executor.example",
      workspace_directory: "/workspace",
      capability_directories: [],
    }))).toBeNull();
    expect(reconcileEnvironmentObservation(observation, {
      id: "session_1",
      environment: null,
    } as unknown as AgentSession)).toBeNull();
  });

  it("does not render a cached observation across an A to B to A stream epoch switch", () => {
    const connected = environmentObservationFromEvent(event("connected"));
    expect(connected).not.toBeNull();
    const cachedA = { observation: connected!, sessionId: "session_1", streamEpoch: 1 };

    expect(visibleEnvironmentObservation(cachedA, "session_2", "session_1", 1)).toBeNull();
    expect(visibleEnvironmentObservation(cachedA, "session_1", "session_2", 2)).toBeNull();
    expect(visibleEnvironmentObservation(cachedA, "session_1", "session_1", 3)).toBeNull();
    expect(visibleEnvironmentObservation(
      { ...cachedA, streamEpoch: 3 },
      "session_1",
      "session_1",
      3,
    )).toBe(connected);
  });
});
