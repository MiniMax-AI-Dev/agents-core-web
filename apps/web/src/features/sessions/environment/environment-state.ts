import type {
  AgentEnvironmentResource,
  AgentSession,
  EnvironmentResourceStatus,
  SessionEnvironmentStatus,
  SessionEvent,
  StreamError,
} from "@agents-core-web/agents-client";

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** UUID identities are case-insensitive; opaque Environment IDs remain exact. */
export function environmentIdsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return left === right;
  }
  const canonicalLeft = left.toLowerCase();
  const canonicalRight = right.toLowerCase();
  if (canonicalUuidPattern.test(canonicalLeft) && canonicalUuidPattern.test(canonicalRight)) {
    return canonicalLeft === canonicalRight;
  }
  return left === right;
}

function isSessionEnvironmentStatus(value: string): value is SessionEnvironmentStatus {
  return value === "pending" || value === "ready" || value === "connected" || value === "disconnected" || value === "failed";
}

interface EnvironmentObservationBase {
  environmentId: string;
  environmentType: "self_hosted";
}

export interface LiveEnvironmentObservation extends EnvironmentObservationBase {
  source: "live";
  status: SessionEnvironmentStatus;
  error: StreamError | null;
  eventId: string;
}

export interface DurableEnvironmentObservation extends EnvironmentObservationBase {
  source: "durable";
  status: EnvironmentResourceStatus;
  resource: AgentEnvironmentResource;
}

export interface UnavailableEnvironmentObservation extends EnvironmentObservationBase {
  source: "unavailable";
  status: null;
}

export type EnvironmentObservation =
  | LiveEnvironmentObservation
  | DurableEnvironmentObservation
  | UnavailableEnvironmentObservation;

export interface ScopedEnvironmentObservation {
  observation: EnvironmentObservation;
  sessionId: string;
  streamEpoch: number;
}

export interface EnvironmentReadFence {
  coreGeneration: number;
  sessionId: string;
  environmentId: string;
  sessionRequest: number;
  environmentRequest: number;
  streamEpoch: number;
  sessionRevision: number;
  environmentRevision: number;
}

export interface CurrentEnvironmentReadScope extends EnvironmentReadFence {
  selectedSessionId: string | null;
}

export function environmentReadIsCurrent(
  read: EnvironmentReadFence,
  current: CurrentEnvironmentReadScope,
): boolean {
  return read.coreGeneration === current.coreGeneration &&
    read.sessionId === current.sessionId &&
    read.sessionId === current.selectedSessionId &&
    environmentIdsMatch(read.environmentId, current.environmentId) &&
    read.sessionRequest === current.sessionRequest &&
    read.environmentRequest === current.environmentRequest &&
    read.streamEpoch === current.streamEpoch &&
    read.sessionRevision === current.sessionRevision &&
    read.environmentRevision === current.environmentRevision;
}

/** Prevents a cached A observation from rendering during an A -> B -> A switch. */
export function visibleEnvironmentObservation(
  entry: ScopedEnvironmentObservation | undefined,
  selectedSessionId: string | null,
  streamSessionId: string | null,
  streamEpoch: number,
): EnvironmentObservation | null {
  return entry &&
    entry.sessionId === selectedSessionId &&
    streamSessionId === selectedSessionId &&
    entry.streamEpoch === streamEpoch
    ? entry.observation
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeError(value: unknown): StreamError | null {
  if (value === null || value === undefined) return null;
  const error = record(value);
  if (!error) return null;
  return {
    code: typeof error.code === "string" ? error.code : "unknown_error",
    type: typeof error.type === "string" ? error.type : "environment_error",
    message: typeof error.message === "string" ? error.message : "The Environment reported an error without a safe message.",
  };
}

/**
 * Admits only the pinned Environment event vocabulary. Future event/status
 * variants remain unknown instead of being projected as a supported state.
 */
export function environmentObservationFromEvent(event: SessionEvent): EnvironmentObservation | null {
  const type = typeof event.type === "string" ? event.type : "";
  const prefix = "agent.session.environment.";
  if (!type.startsWith(prefix)) return null;

  const status = type.slice(prefix.length);
  if (!isSessionEnvironmentStatus(status)) return null;
  if (typeof event.event_id !== "string" || !event.event_id) return null;
  if (typeof event.session_id !== "string" || !event.session_id) return null;
  const environment = record("environment" in event ? event.environment : undefined);
  if (
    !environment ||
    typeof environment.id !== "string" ||
    !environment.id ||
    environment.type !== "self_hosted" ||
    environment.status !== status
  ) return null;

  return {
    source: "live",
    environmentId: environment.id,
    environmentType: "self_hosted",
    status,
    error: safeError(environment.error),
    eventId: event.event_id,
  };
}

export function environmentObservationFromResource(
  resource: AgentEnvironmentResource,
  expectedEnvironmentId: string,
): DurableEnvironmentObservation | null {
  if (!environmentIdsMatch(resource.id, expectedEnvironmentId) || resource.type !== "self_hosted") return null;
  return {
    source: "durable",
    environmentId: resource.id,
    environmentType: "self_hosted",
    status: resource.status,
    resource,
  };
}

export function unavailableEnvironmentObservation(environmentId: string): UnavailableEnvironmentObservation {
  return {
    source: "unavailable",
    environmentId,
    environmentType: "self_hosted",
    status: null,
  };
}

/**
 * Non-Environment events preserve the current observation. Any unsupported or
 * malformed Environment event clears it so a previous connected state cannot
 * survive a future lifecycle transition as a false claim.
 */
export function reduceEnvironmentObservation(
  current: EnvironmentObservation | null,
  event: SessionEvent,
  expectedSessionId?: string,
  expectedEnvironmentId?: string | null,
): EnvironmentObservation | null {
  const type = typeof event.type === "string" ? event.type : "";
  if (!type.startsWith("agent.session.environment.")) return current;
  if (
    expectedSessionId &&
    typeof event.session_id === "string" &&
    event.session_id.length > 0 &&
    event.session_id !== expectedSessionId
  ) return current;
  const next = environmentObservationFromEvent(event);
  if (next && expectedEnvironmentId && !environmentIdsMatch(next.environmentId, expectedEnvironmentId)) return null;
  if (expectedEnvironmentId === null) return null;
  return next;
}

export function selfHostedEnvironmentId(environment: unknown): string | null {
  const value = record(environment);
  if (!value || value.type !== "self_hosted") return null;
  return typeof value.id === "string" && value.id ? value.id : null;
}

export function matchingSessionSnapshot(
  event: SessionEvent,
  expectedSessionId: string,
): AgentSession | null {
  const session = record(event.session);
  return session?.id === expectedSessionId ? event.session as AgentSession : null;
}

/** Durable Session identity fences live observations from another Environment. */
export function reconcileEnvironmentObservation(
  observation: EnvironmentObservation | null,
  session: AgentSession,
): EnvironmentObservation | null {
  if (!observation) return null;
  const environmentId = selfHostedEnvironmentId(session.environment);
  return environmentIdsMatch(environmentId, observation.environmentId) && observation.environmentType === "self_hosted"
    ? observation
    : null;
}
