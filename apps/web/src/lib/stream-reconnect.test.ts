import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCoreError } from "@agents-core-web/agents-client";

import {
  STREAM_RECONNECT_MAX_DELAY_MS,
  STREAM_RECONNECT_STABLE_MS,
  beginStreamReconciliation,
  requestCurrentStreamRetry,
  shouldRetryStreamError,
  streamConnectionWasStable,
  streamReconnectDelay,
  waitForStreamReconnect,
} from "./stream-reconnect";

describe("stream reconnect", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("backs off exponentially and caps the delay", () => {
    expect(streamReconnectDelay(0)).toBe(500);
    expect(streamReconnectDelay(1)).toBe(1_000);
    expect(streamReconnectDelay(3)).toBe(4_000);
    expect(streamReconnectDelay(30)).toBe(STREAM_RECONNECT_MAX_DELAY_MS);
  });

  it("only resets reconnect backoff after an event or a stable interval", () => {
    const openedAt = 1_000;

    expect(streamConnectionWasStable(openedAt, false, openedAt + 25)).toBe(false);
    expect(streamConnectionWasStable(openedAt, false, openedAt + STREAM_RECONNECT_STABLE_MS)).toBe(true);
    expect(streamConnectionWasStable(openedAt, true, openedAt + 25)).toBe(true);
    expect(streamConnectionWasStable(null, false, openedAt + STREAM_RECONNECT_STABLE_MS)).toBe(false);
  });

  it("starts durable reconciliation only after the live stream is accepted", () => {
    const order: string[] = ["stream accepted"];

    const openedAt = beginStreamReconciliation(
      () => true,
      () => order.push("listening"),
      () => order.push("durable reconciliation"),
      () => 1_234,
    );

    expect(openedAt).toBe(1_234);
    expect(order).toEqual(["stream accepted", "listening", "durable reconciliation"]);
  });

  it("does not reconcile an accepted stream that is already stale", () => {
    const markListening = vi.fn();
    const reconcile = vi.fn();

    expect(beginStreamReconciliation(() => false, markListening, reconcile)).toBeNull();
    expect(markListening).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("restarts only the currently selected Session stream", () => {
    const restart = vi.fn();

    expect(requestCurrentStreamRetry("session-current", restart)).toBe(true);
    expect(restart).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledWith("session-current");

    restart.mockClear();
    expect(requestCurrentStreamRetry(null, restart)).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404, 405, 406, 410, 422])(
    "does not retry a permanent HTTP %i stream rejection",
    (status) => {
      expect(shouldRetryStreamError(new AgentCoreError("rejected", status))).toBe(false);
    },
  );

  it.each([408, 409, 425, 429, 500, 503])(
    "retries a transient HTTP %i stream failure",
    (status) => {
      expect(shouldRetryStreamError(new AgentCoreError("temporarily unavailable", status))).toBe(true);
    },
  );

  it("retries network errors", () => {
    expect(shouldRetryStreamError(new TypeError("fetch failed"))).toBe(true);
  });

  it("ends an in-flight delay when its stream is aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForStreamReconnect(8_000, controller.signal);

    controller.abort();

    await expect(waiting).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("observes an abort that happens while the listener is being registered", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const removeEventListener = vi.fn();
    const signal = {
      get aborted() {
        return aborted;
      },
      addEventListener() {
        aborted = true;
      },
      removeEventListener,
    } as unknown as AbortSignal;

    await expect(waitForStreamReconnect(8_000, signal)).resolves.toBe(false);
    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues after the delay elapses", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForStreamReconnect(500, controller.signal);

    await vi.advanceTimersByTimeAsync(500);

    await expect(waiting).resolves.toBe(true);
  });
});
