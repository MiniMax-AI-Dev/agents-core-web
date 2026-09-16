import { describe, expect, it } from "vitest";

import type {
  AgentEnvironmentResource,
  AgentSession,
  EnvironmentResourceStatus,
  SessionEvent,
} from "@agents-core-web/agents-client";

import {
  environmentIdsMatch,
  environmentObservationFromEvent,
  environmentObservationFromResource,
  environmentReadIsCurrent,
  matchingSessionSnapshot,
  reduceEnvironmentObservation,
  reconcileEnvironmentObservation,
  unavailableEnvironmentObservation,
  visibleEnvironmentObservation,
} from "./environment-state";

const canonicalEnvironmentUuid = "0f745b0d-b545-49cd-8d7e-4c31c80dc564";

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
  it("matches UUID identities case-insensitively while keeping opaque IDs exact", () => {
    expect(environmentIdsMatch(canonicalEnvironmentUuid, canonicalEnvironmentUuid.toUpperCase())).toBe(true);
    expect(environmentIdsMatch(canonicalEnvironmentUuid, "1f745b0d-b545-49cd-8d7e-4c31c80dc564")).toBe(false);
    expect(environmentIdsMatch("environment_1", "environment_1")).toBe(true);
    expect(environmentIdsMatch("environment_1", "ENVIRONMENT_1")).toBe(false);
    expect(environmentIdsMatch(null, null)).toBe(true);
    expect(environmentIdsMatch(null, canonicalEnvironmentUuid)).toBe(false);
  });

  it.each(["pending", "ready", "connected", "disconnected", "failed"])(
    "admits pinned %s events",
    (status) => {
      expect(environmentObservationFromEvent(event(status))).toMatchObject({
        source: "live",
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
    expect(environmentObservationFromEvent(event("connected", { type: "future_remote" }))).toBeNull();
    expect(environmentObservationFromEvent({ ...event("connected"), event_id: "" } as SessionEvent)).toBeNull();
    expect(environmentObservationFromEvent({ ...event("connected"), session_id: undefined } as SessionEvent)).toBeNull();
    expect(environmentObservationFromEvent({
      type: "agent.session.environment.connected",
      event_id: "missing",
    } as SessionEvent)).toBeNull();
  });

  it.each(["pending", "connected", "disconnected", "expired", "failed"] as EnvironmentResourceStatus[])(
    "projects durable %s independently from live event status",
    (status) => {
      const resource: AgentEnvironmentResource = {
        id: "environment_1",
        object: "agent.environment",
        type: "self_hosted",
        status,
        files: [],
        plugins: [],
        skills: [],
      };
      expect(environmentObservationFromResource(resource, "environment_1")).toEqual({
        source: "durable",
        environmentId: "environment_1",
        environmentType: "self_hosted",
        status,
        resource,
      });
      expect(environmentObservationFromResource(resource, "another_environment")).toBeNull();
    },
  );

  it("retains a canonical durable UUID returned for an uppercase Session Environment ID", () => {
    const resource: AgentEnvironmentResource = {
      id: canonicalEnvironmentUuid,
      object: "agent.environment",
      type: "self_hosted",
      status: "connected",
      files: [],
      plugins: [],
      skills: [],
    };
    expect(environmentObservationFromResource(resource, canonicalEnvironmentUuid.toUpperCase())).toMatchObject({
      source: "durable",
      environmentId: canonicalEnvironmentUuid,
      status: "connected",
    });
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
    expect(reduceEnvironmentObservation(
      connected,
      event("failed", { id: "another_environment" }),
      "session_1",
      "environment_1",
    )).toBeNull();
    expect(reduceEnvironmentObservation(connected, event("failed"), "session_1", null)).toBeNull();
    expect(reduceEnvironmentObservation(connected, {
      type: "agent.session.turn.completed",
      event_id: "turn_done",
    } as SessionEvent)).toBe(connected);
  });

  it("admits only a matching embedded Session snapshot for the current stream scope", () => {
    const current = session({ type: "none" });
    expect(matchingSessionSnapshot({ ...event("connected"), session: current }, "session_1")).toBe(current);
    expect(matchingSessionSnapshot({ ...event("connected"), session: { ...current, id: "session_2" } }, "session_1")).toBeNull();
    expect(matchingSessionSnapshot({ ...event("connected"), session: { status: "idle" } } as unknown as SessionEvent, "session_1")).toBeNull();
    expect(matchingSessionSnapshot({ ...event("connected"), session: null } as unknown as SessionEvent, "session_1")).toBeNull();
  });

  it("models an unavailable durable read without retaining a readiness claim", () => {
    expect(unavailableEnvironmentObservation("environment_1")).toEqual({
      source: "unavailable",
      environmentId: "environment_1",
      environmentType: "self_hosted",
      status: null,
    });
  });

  it("fences late durable reads by Core, Session, Environment, request, epoch, and event revisions", () => {
    const read = {
      coreGeneration: 1,
      sessionId: "session_1",
      environmentId: "environment_1",
      sessionRequest: 2,
      environmentRequest: 3,
      streamEpoch: 4,
      sessionRevision: 5,
      environmentRevision: 6,
    };
    const current = { ...read, selectedSessionId: "session_1" };
    expect(environmentReadIsCurrent(read, current)).toBe(true);
    for (const stale of [
      { ...current, coreGeneration: 2 },
      { ...current, selectedSessionId: "session_2" },
      { ...current, environmentId: "environment_2" },
      { ...current, sessionRequest: 3 },
      { ...current, environmentRequest: 4 },
      { ...current, streamEpoch: 5 },
      { ...current, sessionRevision: 6 },
      { ...current, environmentRevision: 7 },
    ]) expect(environmentReadIsCurrent(read, stale)).toBe(false);

    // An A -> B -> A selection cannot revive the first A request.
    expect(environmentReadIsCurrent(read, { ...current, streamEpoch: 8 })).toBe(false);

    const uppercaseUuidRead = { ...read, environmentId: canonicalEnvironmentUuid.toUpperCase() };
    expect(environmentReadIsCurrent(uppercaseUuidRead, {
      ...current,
      environmentId: canonicalEnvironmentUuid,
    })).toBe(true);
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

    const uuidObservation = environmentObservationFromEvent(event("connected", {
      id: canonicalEnvironmentUuid,
    }));
    expect(reconcileEnvironmentObservation(uuidObservation, session({
      type: "self_hosted",
      id: canonicalEnvironmentUuid.toUpperCase(),
      remote_url: "https://executor.example",
      workspace_directory: "/workspace",
      capability_directories: [],
    }))).toBe(uuidObservation);
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
