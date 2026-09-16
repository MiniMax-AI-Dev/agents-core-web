export interface ExecutionWriteScope {
  connectionGeneration: number;
  sessionId: string;
}

const verifiedExecutionCompatibility = Symbol("verified execution compatibility");

interface VerifiedSupportedExecutionCompatibility {
  state: "supported";
  proof: ExecutionWriteScope & { contractVersion: string };
  [verifiedExecutionCompatibility]: true;
}

export type ExecutionCompatibility =
  | { state: "unknown" }
  | { state: "unsupported" }
  | VerifiedSupportedExecutionCompatibility;

export const DEFAULT_EXECUTION_COMPATIBILITY: ExecutionCompatibility = Object.freeze({
  state: "unknown",
});

const UNKNOWN_EXECUTION_COPY =
  "Execution compatibility is not publicly proven by the connected Core. This Web keeps the Session read-only and will not submit execution writes.";

const UNSUPPORTED_EXECUTION_COPY =
  "The connected Core reports this execution profile as unsupported. This Web keeps the Session read-only and will not submit execution writes.";

export class ExecutionCompatibilityError extends Error {
  readonly compatibility: "unknown" | "unsupported";

  constructor(
    compatibility: "unknown" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "ExecutionCompatibilityError";
    this.compatibility = compatibility;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scopeMatches(value: unknown, scope: ExecutionWriteScope): value is ExecutionCompatibility & { state: "supported" } {
  if (!isRecord(value) || value.state !== "supported" || !isRecord(value.proof)) return false;
  const proof = value.proof;
  return (
    (value as Record<PropertyKey, unknown>)[verifiedExecutionCompatibility] === true &&
    typeof proof.contractVersion === "string" && Boolean(proof.contractVersion.trim()) &&
    Number.isSafeInteger(proof.connectionGeneration) && proof.connectionGeneration === scope.connectionGeneration &&
    typeof proof.sessionId === "string" && proof.sessionId === scope.sessionId && Boolean(proof.sessionId)
  );
}

export function normalizeExecutionCompatibility(
  value: unknown,
  scope: ExecutionWriteScope,
): ExecutionCompatibility {
  if (scopeMatches(value, scope)) return value;
  if (isRecord(value) && value.state === "unsupported") return { state: "unsupported" };
  return DEFAULT_EXECUTION_COMPATIBILITY;
}

export function executionWriteBlocker(value: unknown, scope: ExecutionWriteScope): string | null {
  const compatibility = normalizeExecutionCompatibility(value, scope);
  if (compatibility.state === "supported") return null;
  return compatibility.state === "unsupported" ? UNSUPPORTED_EXECUTION_COPY : UNKNOWN_EXECUTION_COPY;
}

export async function guardedExecutionWrite<T>(
  compatibility: unknown,
  scope: ExecutionWriteScope,
  write: () => Promise<T>,
): Promise<T> {
  const normalized = normalizeExecutionCompatibility(compatibility, scope);
  if (normalized.state === "supported") return write();
  const blocker = executionWriteBlocker(normalized, scope) ?? UNKNOWN_EXECUTION_COPY;
  throw new ExecutionCompatibilityError(normalized.state, blocker);
}
