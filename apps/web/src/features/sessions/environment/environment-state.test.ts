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
  isSupportedOpenAIHostedEnvironmentProjection,
  isWritableBasicHostedEnvironmentResource,
  matchingSessionSnapshot,
  mergeDurableEnvironmentObservation,
  reduceEnvironmentObservation,
  reconcileEnvironmentObservation,
  unavailableEnvironmentObservation,
  visibleEnvironmentObservation,
} from "./environment-state";

const canonicalEnvironmentUuid = "0f745b0d-b545-49cd-8d7e-4c31c80dc564";
const selfHostedIdentity = { environmentId: "environment_1", environmentType: "self_hosted" as const };

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

  it("admits exact managed events and rejects cross-type identity reuse", () => {
    const hosted = event("connected", { type: "openai_hosted" });
    expect(environmentObservationFromEvent(hosted)).toMatchObject({
      environmentId: "environment_1",
      environmentType: "openai_hosted",
      status: "connected",
    });
    expect(reduceEnvironmentObservation(
      null,
      hosted,
      "session_1",
      { environmentId: "environment_1", environmentType: "self_hosted" },
    )).toBeNull();
  });

  it("recognizes only the pinned empty-install managed Session projection", () => {
    const hosted = {
      type: "openai_hosted",
      id: canonicalEnvironmentUuid,
      capability_directories: [],
      network: { access: "enabled", allowed_domains: [] },
      packages: { npm: [], python: [], system: [] },
      files: [],
      plugins: [],
      skills: [],
    };
    expect(isSupportedOpenAIHostedEnvironmentProjection(hosted)).toBe(true);
    expect(isSupportedOpenAIHostedEnvironmentProjection({
      ...hosted,
      packages: { ...hosted.packages, npm: ["future-package"] },
    })).toBe(false);
    expect(isSupportedOpenAIHostedEnvironmentProjection({
      ...hosted,
      network: { access: "restricted", allowed_domains: ["example.test"] },
    })).toBe(false);
    expect(isSupportedOpenAIHostedEnvironmentProjection({ ...hosted, template_id: "future" })).toBe(false);
  });

  it("qualifies managed Workspace writes only from an exact non-terminal empty-install resource", () => {
    const resource: AgentEnvironmentResource = {
      id: canonicalEnvironmentUuid,
      object: "agent.environment",
      type: "openai_hosted",
      status: "pending",
      files: [],
      plugins: [],
      skills: [],
    };
    expect(isWritableBasicHostedEnvironmentResource(resource, canonicalEnvironmentUuid.toUpperCase())).toBe(true);
    expect(isWritableBasicHostedEnvironmentResource({ ...resource, status: "connected" }, canonicalEnvironmentUuid)).toBe(true);
    expect(isWritableBasicHostedEnvironmentResource({ ...resource, status: "disconnected" }, canonicalEnvironmentUuid)).toBe(true);
    expect(isWritableBasicHostedEnvironmentResource({ ...resource, status: "expired" }, canonicalEnvironmentUuid)).toBe(false);
    expect(isWritableBasicHostedEnvironmentResource({ ...resource, status: "failed" }, canonicalEnvironmentUuid)).toBe(false);
    expect(isWritableBasicHostedEnvironmentResource(
      { ...resource, files: [{}] } as unknown as AgentEnvironmentResource,
      canonicalEnvironmentUuid,
    )).toBe(false);
    expect(isWritableBasicHostedEnvironmentResource(
      { ...resource, plugins: [{}] } as unknown as AgentEnvironmentResource,
      canonicalEnvironmentUuid,
    )).toBe(false);
    expect(isWritableBasicHostedEnvironmentResource(
      { ...resource, skills: [{}] } as unknown as AgentEnvironmentResource,
      canonicalEnvironmentUuid,
    )).toBe(false);
    expect(isWritableBasicHostedEnvironmentResource(resource, "another-environment")).toBe(false);
    expect(isWritableBasicHostedEnvironmentResource({ ...resource, type: "self_hosted" }, canonicalEnvironmentUuid)).toBe(false);
  });

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
      expect(environmentObservationFromResource(resource, selfHostedIdentity)).toEqual({
        source: "durable",
        environmentId: "environment_1",
        environmentType: "self_hosted",
        status,
        resource,
      });
      expect(environmentObservationFromResource(resource, { ...selfHostedIdentity, environmentId: "another_environment" })).toBeNull();
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
    expect(environmentObservationFromResource(resource, {
      ...selfHostedIdentity,
      environmentId: canonicalEnvironmentUuid.toUpperCase(),
    })).toMatchObject({
      source: "durable",
      environmentId: canonicalEnvironmentUuid,
      status: "connected",
    });
  });

  it("projects and retains an exact managed durable resource across same-identity live events", () => {
    const resource: AgentEnvironmentResource = {
      id: canonicalEnvironmentUuid,
      object: "agent.environment",
      type: "openai_hosted",
      status: "pending",
      files: [],
      plugins: [],
      skills: [],
    };
    const identity = { environmentId: canonicalEnvironmentUuid, environmentType: "openai_hosted" as const };
    const durable = environmentObservationFromResource(resource, identity);
    expect(durable).toMatchObject({ environmentType: "openai_hosted", resource });
    const live = reduceEnvironmentObservation(
      durable,
      event("connected", { id: canonicalEnvironmentUuid, type: "openai_hosted" }),
      "session_1",
      identity,
    );
    expect(live).toMatchObject({
      source: "live",
      environmentType: "openai_hosted",
      durableResource: resource,
    });
    expect(environmentObservationFromResource(resource, { ...identity, environmentType: "self_hosted" })).toBeNull();
  });

  it("does not let a stale non-terminal durable read regress a same-identity terminal observation", () => {
    const pendingResource: AgentEnvironmentResource = {
      id: canonicalEnvironmentUuid,
      object: "agent.environment",
      type: "openai_hosted",
      status: "pending",
      files: [],
      plugins: [],
      skills: [],
    };
    const identity = { environmentId: canonicalEnvironmentUuid, environmentType: "openai_hosted" as const };
    const pending = environmentObservationFromResource(pendingResource, identity)!;
    const failed = reduceEnvironmentObservation(
      pending,
      event("failed", { id: canonicalEnvironmentUuid, type: "openai_hosted" }),
      "session_1",
      identity,
    )!;

    expect(mergeDurableEnvironmentObservation(failed, pending)).toBe(failed);
    expect(reduceEnvironmentObservation(
      failed,
      event("connected", { id: canonicalEnvironmentUuid, type: "openai_hosted" }),
      "session_1",
      identity,
    )).toBe(failed);

    const durableFailed = environmentObservationFromResource(
      { ...pendingResource, status: "failed" },
      identity,
    )!;
    expect(mergeDurableEnvironmentObservation(failed, durableFailed)).toBe(durableFailed);
    const unavailable = unavailableEnvironmentObservation(identity);
    expect(mergeDurableEnvironmentObservation(failed, unavailable)).toBe(unavailable);
    expect(mergeDurableEnvironmentObservation(failed, unavailableEnvironmentObservation({
      environmentId: "another_environment",
      environmentType: "openai_hosted",
    }))).toMatchObject({ environmentId: "another_environment", source: "unavailable" });
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
      selfHostedIdentity,
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
    expect(unavailableEnvironmentObservation(selfHostedIdentity)).toEqual({
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
      environmentType: "self_hosted" as const,
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
      { ...current, environmentType: "openai_hosted" as const },
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
