import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCoreError, OpenAIAgentsClient } from "./client";
import type { SessionEvent } from "./types";

interface FetchCall {
  input: RequestInfo | URL;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recordingFetch(response: Response, calls: FetchCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return response;
  }) as typeof fetch;
}

describe("OpenAIAgentsClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("binds the host fetch implementation before storing it", async () => {
    let receiver: unknown;
    vi.stubGlobal("fetch", (function (this: unknown) {
      receiver = this;
      return Promise.resolve(jsonResponse({ data: [], has_more: false }));
    }) as typeof fetch);

    const client = new OpenAIAgentsClient();
    await client.listAgents();

    expect(receiver).toBe(globalThis);
  });

  it("builds encoded list queries and required beta/auth headers", async () => {
    const calls: FetchCall[] = [];
    const client = new OpenAIAgentsClient({
      baseUrl: "https://core.example/v1/",
      token: () => "tenant-key",
      fetch: recordingFetch(jsonResponse({ data: [], has_more: false }), calls),
    });

    await client.listSessions({ after: "sess/one", limit: 10, order: "asc", agentId: "agent one" });

    expect(String(calls[0]?.input)).toBe(
      "https://core.example/v1/agents/sessions?after=sess%2Fone&limit=10&order=asc&agent_id=agent+one",
    );
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer tenant-key");
    expect(headers.get("OpenAI-Beta")).toBe("agents=v1");
  });

  it("preserves the event-stream Accept header and decodes streamed events", async () => {
    const calls: FetchCall[] = [];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": connected\n\nevent: agent.session.turn.output_text.delt"));
        controller.enqueue(
          encoder.encode(
            'a\ndata: {"event_id":"evt_1","turn_id":"turn_1","delta":"hello"}\n\n',
          ),
        );
        controller.close();
      },
    });
    const events: SessionEvent[] = [];
    const lifecycle: string[] = [];
    const client = new OpenAIAgentsClient({
      baseUrl: "https://core.example/v1",
      fetch: recordingFetch(new Response(body, { headers: { "Content-Type": "text/event-stream" } }), calls),
    });

    await client.streamEvents("session/one", {
      onOpen: () => lifecycle.push("open"),
      onEvent: (event) => {
        lifecycle.push("event");
        events.push(event);
      },
    });

    expect(String(calls[0]?.input)).toBe("https://core.example/v1/agents/sessions/session%2Fone/events");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("OpenAI-Beta")).toBe("agents=v1");
    expect(lifecycle).toEqual(["open", "event"]);
    expect(events).toEqual([
      {
        type: "agent.session.turn.output_text.delta",
        event_id: "evt_1",
        turn_id: "turn_1",
        delta: "hello",
      },
    ]);
  });

  it("preserves the nested API error fields", async () => {
    const client = new OpenAIAgentsClient({
      fetch: recordingFetch(
        jsonResponse(
          {
            error: {
              message: "A valid key is required.",
              type: "invalid_request_error",
              code: "invalid_api_key",
              param: "Authorization",
            },
          },
          401,
        ),
        [],
      ),
    });

    const error = await client.listAgents().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AgentCoreError);
    expect(error).toMatchObject({
      message: "A valid key is required.",
      status: 401,
      code: "invalid_api_key",
      param: "Authorization",
      errorType: "invalid_request_error",
    });
  });

  it("passes AbortSignal to durable Session and Item reads", async () => {
    const calls: FetchCall[] = [];
    const controller = new AbortController();
    const client = new OpenAIAgentsClient({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ input, init });
        return jsonResponse({ data: [], has_more: false });
      }) as typeof fetch,
    });

    await client.retrieveSession("session", { signal: controller.signal });
    await client.listItems("session", { signal: controller.signal, limit: 100 });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.init?.signal).toBe(controller.signal);
    expect(calls[1]?.init?.signal).toBe(controller.signal);
  });

  it("cancels the response body when a stream callback fails", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const client = new OpenAIAgentsClient({
      fetch: recordingFetch(new Response(body), []),
    });

    await expect(
      client.streamEvents("session", {
        onOpen: () => {
          throw new Error("consumer failed");
        },
        onEvent: () => undefined,
      }),
    ).rejects.toThrow("consumer failed");
    expect(cancelled).toBe(true);
  });

  it("submits typed function-result parts with an explicit idempotency key", async () => {
    const calls: FetchCall[] = [];
    const client = new OpenAIAgentsClient({ fetch: recordingFetch(new Response(null, { status: 204 }), calls) });

    await client.submitFunctionResult(
      "session",
      {
        callId: "call_1",
        turnId: "turn_1",
        success: true,
        output: [
          { type: "input_text", text: "done" },
          { type: "input_image", image_url: "data:image/png;base64,AA==" },
        ],
      },
      "retry-1",
    );

    expect(calls[0]?.init?.method).toBe("POST");
    expect(new Headers(calls[0]?.init?.headers).get("Idempotency-Key")).toBe("retry-1");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      events: [
        {
          type: "agent.session.input.tool_result",
          call_id: "call_1",
          turn_id: "turn_1",
          success: true,
          output: [
            { type: "input_text", text: "done" },
            { type: "input_image", image_url: "data:image/png;base64,AA==" },
          ],
        },
      ],
    });
  });

  it("rejects stream=true before the JSON create method performs a request", async () => {
    const calls: FetchCall[] = [];
    const client = new OpenAIAgentsClient({
      fetch: recordingFetch(jsonResponse({}), calls),
    });

    await expect(
      client.createSession({ environment: { type: "none" }, stream: true } as never),
    ).rejects.toThrow("createSession only supports the JSON response");
    expect(calls).toHaveLength(0);
  });
});
