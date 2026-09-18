import type {
  AgentEnvironmentResource,
  AgentSession,
  EnvironmentResourceStatus,
  OpenAIHostedAgentEnvironment,
  OpenAIHostedAgentEnvironmentResource,
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

export type SupportedEnvironmentType = "self_hosted" | "openai_hosted";

const writableHostedResourceStatuses = new Set<EnvironmentResourceStatus>([
  "pending",
  "connected",
  "disconnected",
]);

export interface EnvironmentIdentity {
  environmentId: string;
  environmentType: SupportedEnvironmentType;
}

interface EnvironmentObservationBase extends EnvironmentIdentity {
}

export interface LiveEnvironmentObservation extends EnvironmentObservationBase {
  source: "live";
  status: SessionEnvironmentStatus;
  error: StreamError | null;
  eventId: string;
  /** Retained only after an exact same-identity durable retrieve qualified it. */
  durableResource?: AgentEnvironmentResource;
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

function isTerminalEnvironmentObservation(
  observation: EnvironmentObservation | null | undefined,
): observation is LiveEnvironmentObservation | DurableEnvironmentObservation {
  return observation?.status === "failed" || observation?.status === "expired";
}

export interface ScopedEnvironmentObservation {
  observation: EnvironmentObservation;
  sessionId: string;
  streamEpoch: number;
}

export interface EnvironmentReadFence {
  coreGeneration: number;
  sessionId: string;
  environmentId: string;
  environmentType: SupportedEnvironmentType;
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
    read.environmentType === current.environmentType &&
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

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

function emptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

/**
 * Recognizes only the basic managed Session projection implemented at the
 * pinned Core revision. Future templates, restricted networking or populated
 * startup installations remain unsupported instead of being partially shown.
 */
export function isSupportedOpenAIHostedEnvironmentProjection(
  value: unknown,
): value is OpenAIHostedAgentEnvironment {
  const environment = record(value);
  if (!environment || environment.type !== "openai_hosted") return false;
  const network = record(environment.network);
  const packages = record(environment.packages);
  return exactFields(environment, [
    "type",
    "id",
    "capability_directories",
    "network",
    "packages",
    "files",
    "plugins",
    "skills",
  ]) &&
    typeof environment.id === "string" && environment.id.length > 0 &&
    emptyArray(environment.capability_directories) &&
    network !== null && exactFields(network, ["access", "allowed_domains"]) &&
    (network.access === "enabled" || network.access === "disabled") &&
    emptyArray(network.allowed_domains) &&
    packages !== null && exactFields(packages, ["npm", "python", "system"]) &&
    emptyArray(packages.npm) && emptyArray(packages.python) && emptyArray(packages.system) &&
    emptyArray(environment.files) && emptyArray(environment.plugins) && emptyArray(environment.skills);
}

/**
 * A managed Workspace mutation is offered only after the exact current
 * Environment resource confirms the basic profile is non-terminal and exposes
 * no unsupported installation metadata. A Session snapshot, live event, health
 * check or successful list request is never substituted for this durable read.
 */
export function isWritableBasicHostedEnvironmentResource(
  resource: AgentEnvironmentResource | null | undefined,
  expectedEnvironmentId: string | null | undefined,
): resource is OpenAIHostedAgentEnvironmentResource {
  return resource?.object === "agent.environment" &&
    resource.type === "openai_hosted" &&
    typeof expectedEnvironmentId === "string" && expectedEnvironmentId.length > 0 &&
    environmentIdsMatch(resource.id, expectedEnvironmentId) &&
    writableHostedResourceStatuses.has(resource.status) &&
    emptyArray(resource.files) &&
    emptyArray(resource.plugins) &&
    emptyArray(resource.skills);
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
export function environmentObservationFromEvent(event: SessionEvent): LiveEnvironmentObservation | null {
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
    Object.keys(environment).length !== 4 ||
    !Object.keys(environment).every((key) => ["id", "type", "status", "error"].includes(key)) ||
    typeof environment.id !== "string" ||
    !environment.id ||
    (environment.type !== "self_hosted" && environment.type !== "openai_hosted") ||
    environment.status !== status
  ) return null;

  return {
    source: "live",
    environmentId: environment.id,
    environmentType: environment.type,
    status,
    error: safeError(environment.error),
    eventId: event.event_id,
  };
}

export function environmentObservationFromResource(
  resource: AgentEnvironmentResource,
  expected: EnvironmentIdentity,
): DurableEnvironmentObservation | null {
  if (!environmentIdsMatch(resource.id, expected.environmentId) || resource.type !== expected.environmentType) return null;
  return {
    source: "durable",
    environmentId: resource.id,
    environmentType: resource.type,
    status: resource.status,
    resource,
  };
}

export function unavailableEnvironmentObservation(identity: EnvironmentIdentity): UnavailableEnvironmentObservation {
  return {
    source: "unavailable",
    ...identity,
    status: null,
  };
}

/**
 * A terminal observation is monotonic for one Environment identity. A refresh
 * triggered by a terminal event can briefly read an older pending resource; that
 * stale read must not restore write controls or replace the terminal claim.
 */
export function mergeDurableEnvironmentObservation(
  current: EnvironmentObservation | null | undefined,
  durable: EnvironmentObservation,
): EnvironmentObservation {
  if (
    current &&
    environmentIdentitiesMatch(current, durable) &&
    isTerminalEnvironmentObservation(current) &&
    durable.source === "durable" &&
    !isTerminalEnvironmentObservation(durable)
  ) return current;
  return durable;
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
  expectedEnvironment?: EnvironmentIdentity | null,
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
  if (next && expectedEnvironment && !environmentIdentitiesMatch(next, expectedEnvironment)) return null;
  if (expectedEnvironment === null) return null;
  if (!next) return null;
  if (
    current &&
    environmentIdentitiesMatch(current, next) &&
    isTerminalEnvironmentObservation(current) &&
    !isTerminalEnvironmentObservation(next)
  ) return current;
  const durableResource = current?.source === "durable"
    ? current.resource
    : current?.source === "live"
      ? current.durableResource
      : undefined;
  return durableResource && environmentIdentitiesMatch(next, {
    environmentId: durableResource.id,
    environmentType: durableResource.type,
  })
    ? { ...next, durableResource }
    : next;
}

export function supportedEnvironmentIdentity(environment: unknown): EnvironmentIdentity | null {
  const value = record(environment);
  if (!value || (value.type !== "self_hosted" && value.type !== "openai_hosted")) return null;
  return typeof value.id === "string" && value.id
    ? { environmentId: value.id, environmentType: value.type }
    : null;
}

export function environmentIdentitiesMatch(
  left: EnvironmentIdentity | null | undefined,
  right: EnvironmentIdentity | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.environmentType === right.environmentType && environmentIdsMatch(left.environmentId, right.environmentId);
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
  const identity = supportedEnvironmentIdentity(session.environment);
  return environmentIdentitiesMatch(identity, observation)
    ? observation
    : null;
}
