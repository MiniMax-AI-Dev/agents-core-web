import { AgentCoreError } from "@agents-core-web/agents-client";

export const STREAM_RECONNECT_BASE_DELAY_MS = 500;
export const STREAM_RECONNECT_MAX_DELAY_MS = 8_000;
export const STREAM_RECONNECT_STABLE_MS = 10_000;

const TRANSIENT_CLIENT_STATUSES = new Set([408, 409, 425, 429]);

/**
 * Mark an accepted live-only stream ready, then reconcile durable state.
 * The read must start after acceptance so events cannot fall between an older
 * snapshot and the stream's latest-position cursor.
 */
export function beginStreamReconciliation(
  isCurrent: () => boolean,
  markListening: () => void,
  reconcile: () => void,
  now = Date.now,
): number | null {
  if (!isCurrent()) return null;
  const openedAt = now();
  markListening();
  reconcile();
  return openedAt;
}

/** Restart only the currently selected Session's read-only event stream. */
export function requestCurrentStreamRetry(
  sessionId: string | null,
  restart: (sessionId: string) => void,
): boolean {
  if (!sessionId) return false;
  restart(sessionId);
  return true;
}

export function shouldRetryStreamError(error: unknown): boolean {
  if (!(error instanceof AgentCoreError)) return true;
  return (
    error.status < 400 ||
    error.status >= 500 ||
    TRANSIENT_CLIENT_STATUSES.has(error.status)
  );
}

export function streamReconnectDelay(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(
    STREAM_RECONNECT_MAX_DELAY_MS,
    STREAM_RECONNECT_BASE_DELAY_MS * (2 ** Math.min(safeAttempt, 30)),
  );
}

export function streamConnectionWasStable(
  openedAt: number | null,
  receivedEvent: boolean,
  endedAt = Date.now(),
): boolean {
  return receivedEvent || (
    openedAt !== null && endedAt - openedAt >= STREAM_RECONNECT_STABLE_MS
  );
}

export function waitForStreamReconnect(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const finish = (elapsed: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(elapsed);
    };
    const onAbort = () => finish(false);

    signal.addEventListener("abort", onAbort, { once: true });
    if (settled || signal.aborted) {
      finish(false);
      return;
    }
    timer = globalThis.setTimeout(() => finish(true), Math.max(0, delayMs));
  });
}
