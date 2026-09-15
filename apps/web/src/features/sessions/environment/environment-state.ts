import type {
  AgentSession,
  EnvironmentStatus,
  SessionEvent,
  StreamError,
} from "@agents-core-web/agents-client";

const knownStatuses = new Set<EnvironmentStatus>([
  "pending",
  "ready",
  "connected",
  "disconnected",
  "failed",
]);

export interface EnvironmentObservation {
  environmentId: string;
  environmentType: string;
  status: EnvironmentStatus;
  error: StreamError | null;
  eventId: string;
}

export interface ScopedEnvironmentObservation {
  observation: EnvironmentObservation;
  sessionId: string;
  streamEpoch: number;
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
  if (!knownStatuses.has(status as EnvironmentStatus)) return null;
  if (typeof event.event_id !== "string" || !event.event_id) return null;
  if (typeof event.session_id !== "string" || !event.session_id) return null;
  const environment = record("environment" in event ? event.environment : undefined);
  if (
    !environment ||
    typeof environment.id !== "string" ||
    !environment.id ||
    typeof environment.type !== "string" ||
    !environment.type ||
    environment.status !== status
  ) return null;

  return {
    environmentId: environment.id,
    environmentType: environment.type,
    status: status as EnvironmentStatus,
    error: safeError(environment.error),
    eventId: event.event_id,
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
): EnvironmentObservation | null {
  const type = typeof event.type === "string" ? event.type : "";
  if (!type.startsWith("agent.session.environment.")) return current;
  if (
    expectedSessionId &&
    typeof event.session_id === "string" &&
    event.session_id.length > 0 &&
    event.session_id !== expectedSessionId
  ) return current;
  return environmentObservationFromEvent(event);
}

function selfHostedIdentity(environment: unknown): string | null {
  const value = record(environment);
  if (!value || value.type !== "self_hosted") return null;
  return typeof value.id === "string" && value.id ? value.id : null;
}

/** Durable Session identity fences live observations from another Environment. */
export function reconcileEnvironmentObservation(
  observation: EnvironmentObservation | null,
  session: AgentSession,
): EnvironmentObservation | null {
  if (!observation) return null;
  const environmentId = selfHostedIdentity(session.environment);
  return environmentId === observation.environmentId && observation.environmentType === "self_hosted"
    ? observation
    : null;
}
