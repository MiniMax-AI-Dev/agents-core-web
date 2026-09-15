import {
  AgentCoreError,
  type AgentCore,
  type AgentSession,
  type SessionDeleted,
} from "@agents-core-web/agents-client";

export interface SessionMetadataValues {
  title: string;
  metadata: string;
}

export interface SessionMetadataValidation {
  metadata?: Record<string, string>;
  metadataError?: string;
}

export type SessionActionFailureKind =
  | "not_found"
  | "lifecycle_conflict"
  | "core_unavailable"
  | "metadata_conflict"
  | "request_failed"
  | "unknown_write";

export type SessionDeleteReconciliation =
  | { state: "missing" }
  | { state: "present"; session: AgentSession }
  | { state: "unknown"; error: unknown };

export class SessionActionError extends Error {
  readonly kind: SessionActionFailureKind;

  constructor(message: string, kind: SessionActionFailureKind, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionActionError";
    this.kind = kind;
  }
}

export class SessionMetadataConflictError extends SessionActionError {
  readonly keys: string[];
  readonly latestSession?: AgentSession;

  constructor(keys: string[], latestSession?: AgentSession) {
    const sorted = [...keys].sort((left, right) => left.localeCompare(right));
    super(
      `Metadata changed in Agent Core while you were editing: ${sorted.join(", ")}. Your draft was kept; review the latest values before saving again.`,
      "metadata_conflict",
    );
    this.name = "SessionMetadataConflictError";
    this.keys = sorted;
    this.latestSession = latestSession;
  }
}

function withoutTitle(metadata: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "title"));
}

export function valuesFromMetadata(metadata: Record<string, string>): SessionMetadataValues {
  return {
    title: metadata.title ?? "",
    metadata: JSON.stringify(withoutTitle(metadata), null, 2),
  };
}

export function valuesFromSession(session: AgentSession): SessionMetadataValues {
  return valuesFromMetadata(session.metadata);
}

export function validateSessionMetadata(values: SessionMetadataValues): SessionMetadataValidation {
  let parsed: unknown;
  try {
    parsed = values.metadata.trim() ? JSON.parse(values.metadata) : {};
  } catch {
    return { metadataError: "Metadata must be valid JSON." };
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return { metadataError: "Metadata must be a JSON object." };
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([, value]) => typeof value !== "string")) {
    return { metadataError: "Every metadata value must be a string." };
  }
  if (entries.some(([key]) => key === "title")) {
    return { metadataError: "Edit title in the Title field, not in additional metadata." };
  }

  const metadata = Object.fromEntries(entries) as Record<string, string>;
  const title = values.title.trim();
  if (title) metadata.title = title;
  if (Object.keys(metadata).length > 16) {
    return { metadataError: "Session metadata supports at most 16 pairs, including title." };
  }
  if (Object.entries(metadata).some(([key, value]) => (
    Array.from(key).length > 64 || Array.from(value).length > 512
  ))) {
    return { metadataError: "Metadata keys must be at most 64 characters and values at most 512 characters." };
  }
  return { metadata };
}

function metadataValueEquals(
  left: Record<string, string>,
  right: Record<string, string>,
  key: string,
): boolean {
  return Object.hasOwn(left, key) === Object.hasOwn(right, key) && left[key] === right[key];
}

function metadataEquals(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => metadataValueEquals(left, right, key));
}

function isSessionUpdateConfirmation(value: unknown, sessionId: string): value is AgentSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Partial<AgentSession>;
  const metadata = session.metadata;
  return session.id === sessionId &&
    session.object === "agent.session" &&
    Boolean(session.agent) && typeof session.agent === "object" &&
    typeof session.agent.model === "string" &&
    Boolean(session.environment) && typeof session.environment === "object" &&
    typeof session.environment.type === "string" &&
    ["idle", "in_progress", "requires_action", "failed"].includes(String(session.status)) &&
    (session.error === null || typeof session.error === "string") &&
    Boolean(metadata) && typeof metadata === "object" && !Array.isArray(metadata) &&
    Object.values(metadata).every((entry) => typeof entry === "string") &&
    Array.isArray(session.required_actions) &&
    Array.isArray(session.vault_ids) && session.vault_ids.every((entry) => typeof entry === "string") &&
    (session.usage === null || Boolean(session.usage) && typeof session.usage === "object") &&
    typeof session.created_at === "number" && Number.isFinite(session.created_at) &&
    typeof session.last_active_at === "number" && Number.isFinite(session.last_active_at);
}

export function mergeSessionMetadata(
  baseline: Record<string, string>,
  draft: Record<string, string>,
  latest: Record<string, string>,
): Record<string, string> {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(draft)]);
  const changed = [...keys].filter((key) => !metadataValueEquals(baseline, draft, key));
  const conflicts = changed.filter((key) => (
    !metadataValueEquals(latest, baseline, key) && !metadataValueEquals(latest, draft, key)
  ));
  if (conflicts.length) throw new SessionMetadataConflictError(conflicts);

  return rebaseSessionMetadataDraft(baseline, draft, latest);
}

export function rebaseSessionMetadataDraft(
  baseline: Record<string, string>,
  draft: Record<string, string>,
  latest: Record<string, string>,
): Record<string, string> {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(draft)]);
  const changed = [...keys].filter((key) => !metadataValueEquals(baseline, draft, key));
  const merged = { ...latest };
  for (const key of changed) {
    if (Object.hasOwn(draft, key)) merged[key] = draft[key]!;
    else delete merged[key];
  }
  return merged;
}

function actionLabel(action: "update" | "delete"): string {
  return action === "update" ? "update" : "deletion";
}

function normalizeSessionActionError(
  error: unknown,
  action: "update" | "delete",
  phase: "read" | "write",
): SessionActionError {
  if (error instanceof SessionActionError) return error;
  const label = actionLabel(action);
  if (error instanceof AgentCoreError) {
    if (error.status === 404) {
      return new SessionActionError(
        "This Session was not found in Agent Core. The Web kept its current durable view; refresh Sessions before trying again.",
        "not_found",
        { cause: error },
      );
    }
    if (error.status === 409) {
      if (phase === "read") {
        return new SessionActionError(
          "The latest Session could not be retrieved because this compatible Core returned a lifecycle conflict (409), so no update request was sent. Your draft and current durable view were kept.",
          "lifecycle_conflict",
          { cause: error },
        );
      }
      return new SessionActionError(
        `This compatible Core rejected the Session ${label} because it conflicts with the current lifecycle state. The Web did not retry.`,
        "lifecycle_conflict",
        { cause: error },
      );
    }
    if (error.status === 503 || error.status >= 500) {
      const suffix = phase === "read"
        ? "No update request was sent."
        : "The write result is unknown. The Web kept its current durable view and did not retry; refresh before deciding whether to try again.";
      return new SessionActionError(
        `Agent Core could not complete the Session ${label} (${error.status}). ${suffix}`,
        phase === "read" ? "core_unavailable" : "unknown_write",
        { cause: error },
      );
    }
    if (phase === "write" && [408, 425, 429].includes(error.status)) {
      return new SessionActionError(
        `The Session ${label} result is uncertain after Agent Core returned ${error.status}. The Web kept its current durable view and did not retry; refresh before deciding whether to try again.`,
        "unknown_write",
        { cause: error },
      );
    }
    return new SessionActionError(
      phase === "read"
        ? `${error.message} No update request was sent; your draft and current durable view were kept.`
        : `${error.message} The Web kept its current durable view and did not retry.`,
      "request_failed",
      { cause: error },
    );
  }

  if (phase === "read") {
    return new SessionActionError(
      "The latest Session could not be retrieved, so no update request was sent. Your draft and the current durable view were kept.",
      "request_failed",
      { cause: error },
    );
  }
  return new SessionActionError(
    `The Session ${label} result is unknown because the connection ended before Core confirmed it. The Web kept its current durable view and did not retry; refresh before deciding whether to try again.`,
    "unknown_write",
    { cause: error },
  );
}

export function requestSessionDetail(core: AgentCore, sessionId: string): Promise<AgentSession> {
  return core.retrieveSession(sessionId);
}

export async function requestSessionUpdate(
  core: AgentCore,
  sessionId: string,
  baselineMetadata: Record<string, string>,
  draftMetadata: Record<string, string>,
): Promise<AgentSession> {
  let latest: AgentSession;
  try {
    latest = await core.retrieveSession(sessionId);
  } catch (error) {
    throw normalizeSessionActionError(error, "update", "read");
  }

  let metadata: Record<string, string>;
  try {
    metadata = mergeSessionMetadata(baselineMetadata, draftMetadata, latest.metadata);
  } catch (error) {
    if (error instanceof SessionMetadataConflictError) {
      throw new SessionMetadataConflictError(error.keys, latest);
    }
    throw error;
  }
  try {
    const updated: unknown = await core.updateSession(sessionId, metadata);
    if (!isSessionUpdateConfirmation(updated, sessionId) || !metadataEquals(updated.metadata, metadata)) {
      throw new SessionActionError(
        "Agent Core returned an invalid Session update confirmation. The write result is unknown; the Web kept its current durable view and did not retry.",
        "unknown_write",
      );
    }
    return { ...latest, metadata: { ...updated.metadata } };
  } catch (error) {
    throw normalizeSessionActionError(error, "update", "write");
  }
}

export async function requestSessionDelete(core: AgentCore, sessionId: string): Promise<SessionDeleted> {
  let deleted: SessionDeleted;
  try {
    deleted = await core.deleteSession(sessionId);
  } catch (error) {
    throw normalizeSessionActionError(error, "delete", "write");
  }
  if (
    deleted?.id !== sessionId ||
    deleted.object !== "agent.session.deleted" ||
    deleted.deleted !== true
  ) {
    throw new SessionActionError(
      "Agent Core returned an invalid deletion confirmation. The Web kept the Session; refresh durable state before taking another action.",
      "unknown_write",
    );
  }
  return deleted;
}

export async function reconcileUnknownSessionDelete(
  core: AgentCore,
  sessionId: string,
): Promise<SessionDeleteReconciliation> {
  try {
    return { state: "present", session: await core.retrieveSession(sessionId) };
  } catch (error) {
    if (error instanceof AgentCoreError && error.status === 404) return { state: "missing" };
    return { state: "unknown", error };
  }
}

export function replaceSessionMetadata(sessions: AgentSession[], updated: AgentSession): AgentSession[] {
  return sessions.map((session) => (
    session.id === updated.id ? { ...session, metadata: updated.metadata } : session
  ));
}

export function removeSession(sessions: AgentSession[], sessionId: string): AgentSession[] {
  return sessions.filter((session) => session.id !== sessionId);
}

export function selectionAfterSessionDelete(
  sessions: AgentSession[],
  selectedId: string | null,
  deletedId: string,
): string | null {
  if (selectedId !== deletedId) return selectedId;
  const deletedIndex = sessions.findIndex((session) => session.id === deletedId);
  const remaining = removeSession(sessions, deletedId);
  if (deletedIndex < 0) return remaining[0]?.id ?? null;
  return remaining[deletedIndex]?.id ?? remaining[deletedIndex - 1]?.id ?? null;
}
