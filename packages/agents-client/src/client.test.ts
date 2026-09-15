import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCoreError, OpenAIAgentsClient } from "./client";
import type { EnvironmentResourceStatus, SessionEvent } from "./types";

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

  it("passes AbortSignal to durable Session, Environment, and Item reads", async () => {
    const calls: FetchCall[] = [];
    const controller = new AbortController();
    const client = new OpenAIAgentsClient({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ input, init });
        if (String(input).includes("/environments/")) {
          return jsonResponse({
            id: "environment",
            object: "agent.environment",
            type: "self_hosted",
            status: "pending",
            files: [],
            plugins: [],
            skills: [],
          });
        }
        return jsonResponse({ data: [], has_more: false });
      }) as typeof fetch,
    });

    await client.retrieveSession("session", { signal: controller.signal });
    await client.retrieveEnvironment("environment", { signal: controller.signal });
    await client.listItems("session", { signal: controller.signal, limit: 100 });

    expect(calls).toHaveLength(3);
    expect(calls[0]?.init?.signal).toBe(controller.signal);
    expect(calls[1]?.init?.signal).toBe(controller.signal);
    expect(calls[2]?.init?.signal).toBe(controller.signal);
  });

  it.each(["pending", "connected", "disconnected", "expired", "failed"] as EnvironmentResourceStatus[])(
    "retrieves and projects the exact %s Environment resource",
    async (status) => {
      const calls: FetchCall[] = [];
      const controller = new AbortController();
      const resource = {
        id: "environment/one",
        object: "agent.environment",
        type: "self_hosted",
        status,
        files: [],
        plugins: [],
        skills: [],
      } as const;
      const client = new OpenAIAgentsClient({
        baseUrl: "https://core.example/v1/",
        token: "tenant-key",
        fetch: recordingFetch(jsonResponse(resource), calls),
      });

      await expect(client.retrieveEnvironment("environment/one", { signal: controller.signal })).resolves.toEqual(resource);

      expect(calls).toHaveLength(1);
      expect(String(calls[0]?.input)).toBe("https://core.example/v1/agents/environments/environment%2Fone");
      expect(calls[0]?.init?.method).toBeUndefined();
      expect(calls[0]?.init?.body).toBeUndefined();
      expect(calls[0]?.init?.signal).toBe(controller.signal);
      const headers = new Headers(calls[0]?.init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer tenant-key");
      expect(headers.get("OpenAI-Beta")).toBe("agents=v1");
    },
  );

  it("accepts a canonical Environment UUID response for an uppercase request ID", async () => {
    const calls: FetchCall[] = [];
    const responseId = "0f745b0d-b545-49cd-8d7e-4c31c80dc564";
    const requestId = responseId.toUpperCase();
    const resource = {
      id: responseId,
      object: "agent.environment",
      type: "self_hosted",
      status: "pending",
      files: [],
      plugins: [],
      skills: [],
    } as const;
    const client = new OpenAIAgentsClient({
      baseUrl: "https://core.example/v1",
      fetch: recordingFetch(jsonResponse(resource), calls),
    });

    await expect(client.retrieveEnvironment(requestId)).resolves.toEqual(resource);
    expect(String(calls[0]?.input)).toBe(`https://core.example/v1/agents/environments/${requestId}`);
    expect(calls).toHaveLength(1);
  });

  it("rejects a non-canonical uppercase Environment UUID response without retrying", async () => {
    const calls: FetchCall[] = [];
    const requestId = "0f745b0d-b545-49cd-8d7e-4c31c80dc564";
    const client = new OpenAIAgentsClient({
      fetch: recordingFetch(
        jsonResponse({
          id: requestId.toUpperCase(),
          object: "agent.environment",
          type: "self_hosted",
          status: "pending",
          files: [],
          plugins: [],
          skills: [],
        }),
        calls,
      ),
    });

    await expect(client.retrieveEnvironment(requestId)).rejects.toMatchObject({
      status: 502,
      code: "invalid_environment_resource",
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    null,
    {},
    { id: "environment", object: "agent.environment", type: "self_hosted", status: "ready", files: [], plugins: [], skills: [] },
    { id: "another", object: "agent.environment", type: "self_hosted", status: "pending", files: [], plugins: [], skills: [] },
    { id: "environment", object: "agent.environment", type: "openai_hosted", status: "pending", files: [], plugins: [], skills: [] },
    { id: "environment", object: "agent.environment", type: "self_hosted", status: "pending", files: null, plugins: [], skills: [] },
    { id: "environment", object: "agent.environment", type: "self_hosted", status: "pending", files: [], plugins: [], skills: [], extra: true },
  ])("rejects a malformed or unsupported Environment resource without retrying", async (resource) => {
    const calls: FetchCall[] = [];
    const client = new OpenAIAgentsClient({ fetch: recordingFetch(jsonResponse(resource), calls) });

    await expect(client.retrieveEnvironment("environment")).rejects.toMatchObject({
      status: 502,
      code: "invalid_environment_resource",
      message: "Agent Core returned an invalid Environment resource.",
    });
    expect(calls).toHaveLength(1);
  });

  it.each([400, 401, 404, 405, 500])("preserves Environment retrieve HTTP %s without retrying", async (status) => {
    const calls: FetchCall[] = [];
    const client = new OpenAIAgentsClient({
      fetch: recordingFetch(jsonResponse({ error: { code: "fixture_error", message: "Safe failure." } }, status), calls),
    });

    await expect(client.retrieveEnvironment("environment")).rejects.toMatchObject({
      status,
      code: "fixture_error",
      message: "Safe failure.",
    });
    expect(calls).toHaveLength(1);
  });

  it.each([201, 202, 204, 206])("rejects Environment retrieve HTTP %s without retrying", async (status) => {
    const calls: FetchCall[] = [];
    const resource = {
      id: "environment",
      object: "agent.environment",
      type: "self_hosted",
      status: "pending",
      files: [],
      plugins: [],
      skills: [],
    };
    const response = status === 204 ? new Response(null, { status }) : jsonResponse(resource, status);
    const client = new OpenAIAgentsClient({ fetch: recordingFetch(response, calls) });

    await expect(client.retrieveEnvironment("environment")).rejects.toMatchObject({
      status,
      message: `Agent core request failed (${status}).`,
    });
    expect(calls).toHaveLength(1);
  });

  it("propagates an Environment retrieve network failure without retrying", async () => {
    const calls: FetchCall[] = [];
    const client = new OpenAIAgentsClient({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ input, init });
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
    });

    await expect(client.retrieveEnvironment("environment")).rejects.toThrow("Failed to fetch");
    expect(calls).toHaveLength(1);
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

  it("lists Turns with encoded Session scope, pagination, ordering, and cancellation", async () => {
    const calls: FetchCall[] = [];
    const controller = new AbortController();
    const client = new OpenAIAgentsClient({
      baseUrl: "https://core.example.test/v1/",
      fetch: recordingFetch(jsonResponse({ data: [], has_more: false }), calls),
    });

    await client.listTurns("session/one", {
      after: "turn/previous",
      limit: 100,
      order: "asc",
      signal: controller.signal,
    });

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe("https://core.example.test/v1/agents/sessions/session%2Fone/turns?after=turn%2Fprevious&limit=100&order=asc");
    expect(calls[0]?.init?.method).toBeUndefined();
    expect(calls[0]?.init?.signal).toBe(controller.signal);
    expect(new Headers(calls[0]?.init?.headers).get("OpenAI-Beta")).toBe("agents=v1");
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
