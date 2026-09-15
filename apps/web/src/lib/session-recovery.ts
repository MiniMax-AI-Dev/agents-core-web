import type { SessionEvent } from "@agents-core-web/agents-client";

export interface StreamRecoveryBuffer {
  begin(): number;
  accept(event: SessionEvent, apply: (event: SessionEvent) => void): void;
  finish(
    token: number,
    isCurrent: () => boolean,
    apply: (event: SessionEvent) => void,
  ): boolean;
  invalidate(): void;
}

/**
 * Buffers events immediately after an SSE response is accepted. The caller
 * starts its durable reads after begin(), then calls finish() only after those
 * reads have settled. A stale token cannot release events into a new Session.
 */
export function createStreamRecoveryBuffer(): StreamRecoveryBuffer {
  let generation = 0;
  let buffering = false;
  let buffered: SessionEvent[] = [];

  return {
    begin() {
      generation += 1;
      buffering = true;
      buffered = [];
      return generation;
    },
    accept(event, apply) {
      if (buffering) buffered.push(event);
      else apply(event);
    },
    finish(token, isCurrent, apply) {
      if (token !== generation || !isCurrent()) return false;
      const pending = buffered;
      buffered = [];
      buffering = false;
      for (const event of pending) {
        if (!isCurrent()) return false;
        apply(event);
      }
      return true;
    },
    invalidate() {
      generation += 1;
      buffering = false;
      buffered = [];
    },
  };
}

const TERMINAL_SESSION_EVENTS = new Set([
  "agent.session.idle",
  "agent.session.requires_action",
  "agent.session.failed",
]);
const TERMINAL_TURN_EVENTS = new Set([
  "agent.session.turn.completed",
  "agent.session.turn.failed",
  "agent.session.turn.cancelled",
]);
const TERMINAL_ENVIRONMENT_EVENTS = new Set([
  "agent.session.environment.ready",
  "agent.session.environment.connected",
  "agent.session.environment.disconnected",
  "agent.session.environment.failed",
]);

export function terminalDurableRefreshKey(event: SessionEvent): string | null {
  const type = typeof event.type === "string" ? event.type : "";
  if (TERMINAL_SESSION_EVENTS.has(type)) return `session:${event.session_id ?? event.session?.id ?? "current"}`;
  if (TERMINAL_TURN_EVENTS.has(type)) return `turn:${event.turn_id ?? event.turn?.id ?? "current"}`;
  if (TERMINAL_ENVIRONMENT_EVENTS.has(type)) {
    const environment = "environment" in event && event.environment && typeof event.environment === "object"
      ? event.environment as { id?: unknown }
      : undefined;
    const environmentId = typeof environment?.id === "string" ? environment.id : "current";
    return `environment:${environmentId}`;
  }
  return null;
}

export interface DurableRefreshCoordinator {
  accept(event: SessionEvent): boolean;
  dispose(): void;
}

/** Coalesces terminal projections into durable reads without touching SSE. */
export function createDurableRefreshCoordinator(
  refresh: () => Promise<unknown>,
): DurableRefreshCoordinator {
  const seen = new Set<string>();
  let disposed = false;
  let scheduled = false;
  let running = false;
  let pending = false;

  const run = async () => {
    if (disposed) return;
    scheduled = false;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    do {
      pending = false;
      await refresh();
    } while (!disposed && pending);
    running = false;
  };

  return {
    accept(event) {
      const key = terminalDurableRefreshKey(event);
      if (!key || disposed) return false;
      const identity = event.event_id || `${event.type}:${key}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      if (running) pending = true;
      else if (!scheduled) {
        scheduled = true;
        void Promise.resolve().then(run);
      }
      return true;
    },
    dispose() {
      disposed = true;
      pending = false;
    },
  };
}
