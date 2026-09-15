import { createSSEDecoder } from "./sse";
import type {
  AgentCore,
  AgentDeleted,
  AgentEnvironmentResource,
  AgentSession,
  AgentTurn,
  CreateAgentInput,
  CreateSessionInput,
  FunctionResultInput,
  ListPage,
  PageOptions,
  ReadOptions,
  SavedAgent,
  SessionDeleted,
  SessionEvent,
  SessionItem,
  StreamOptions,
  UpdateAgentInput,
  EnvironmentResourceStatus,
} from "./types";

export interface OpenAIAgentsClientOptions {
  baseUrl?: string;
  token?: string | (() => string | undefined);
  fetch?: typeof fetch;
}

interface APIErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    param?: string | null;
    type?: string;
  };
}

export class AgentCoreError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly param?: string | null;
  readonly errorType?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    param?: string | null,
    errorType?: string,
  ) {
    super(message);
    this.name = "AgentCoreError";
    this.status = status;
    this.code = code;
    this.param = param;
    this.errorType = errorType;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function randomKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addPageOptions(params: URLSearchParams, options?: PageOptions): void {
  if (options?.after) params.set("after", options.after);
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.order) params.set("order", options.order);
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

const environmentResourceFields = new Set(["id", "object", "type", "status", "files", "plugins", "skills"]);

function isEnvironmentResourceStatus(value: unknown): value is EnvironmentResourceStatus {
  return value === "pending" || value === "connected" || value === "disconnected" || value === "expired" || value === "failed";
}

function projectEnvironmentResource(value: unknown, expectedId: string): AgentEnvironmentResource {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentCoreError("Agent Core returned an invalid Environment resource.", 502, "invalid_environment_resource");
  }
  const resource = value as Record<string, unknown>;
  const fields = Object.keys(resource);
  if (
    fields.length !== environmentResourceFields.size ||
    fields.some((field) => !environmentResourceFields.has(field)) ||
    resource.id !== expectedId ||
    resource.object !== "agent.environment" ||
    resource.type !== "self_hosted" ||
    !isEnvironmentResourceStatus(resource.status) ||
    !Array.isArray(resource.files) ||
    !Array.isArray(resource.plugins) ||
    !Array.isArray(resource.skills)
  ) {
    throw new AgentCoreError("Agent Core returned an invalid Environment resource.", 502, "invalid_environment_resource");
  }
  return {
    id: expectedId,
    object: "agent.environment",
    type: "self_hosted",
    status: resource.status,
    files: resource.files,
    plugins: resource.plugins,
    skills: resource.skills,
  };
}

export class OpenAIAgentsClient implements AgentCore {
  private readonly baseUrl: string;
  private readonly token: OpenAIAgentsClientOptions["token"];
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIAgentsClientOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? "/v1");
    this.token = options.token;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private headers(extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    headers.set("OpenAI-Beta", "agents=v1");
    const token = typeof this.token === "function" ? this.token() : this.token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  private async toError(response: Response): Promise<AgentCoreError> {
    let envelope: APIErrorEnvelope | undefined;
    try {
      envelope = (await response.json()) as APIErrorEnvelope;
    } catch {
      // Keep the customer-safe HTTP fallback when an intermediary returns HTML.
    }
    return new AgentCoreError(
      envelope?.error?.message ?? `Agent core request failed (${response.status}).`,
      response.status,
      envelope?.error?.code,
      envelope?.error?.param,
      envelope?.error?.type,
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = this.headers(init.headers);
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) throw await this.toError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  listAgents(options?: PageOptions): Promise<ListPage<SavedAgent>> {
    const params = new URLSearchParams();
    addPageOptions(params, options);
    return this.request(withQuery("/agents", params));
  }

  createAgent(input: CreateAgentInput): Promise<SavedAgent> {
    return this.request("/agents", { method: "POST", body: JSON.stringify(input) });
  }

  retrieveAgent(agentId: string): Promise<SavedAgent> {
    return this.request(`/agents/${encodeURIComponent(agentId)}`);
  }

  updateAgent(agentId: string, input: UpdateAgentInput): Promise<SavedAgent> {
    return this.request(`/agents/${encodeURIComponent(agentId)}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  deleteAgent(agentId: string): Promise<AgentDeleted> {
    return this.request(`/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" });
  }

  listSessions(options?: PageOptions & { agentId?: string }): Promise<ListPage<AgentSession>> {
    const params = new URLSearchParams();
    addPageOptions(params, options);
    if (options?.agentId) params.set("agent_id", options.agentId);
    return this.request(withQuery("/agents/sessions", params));
  }

  createSession(input: CreateSessionInput, idempotencyKey = randomKey()): Promise<AgentSession> {
    if ((input as { stream?: boolean }).stream === true) {
      return Promise.reject(
        new TypeError("createSession only supports the JSON response; connect streamEvents after creation."),
      );
    }
    return this.request("/agents/sessions", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    });
  }

  retrieveSession(sessionId: string, options?: ReadOptions): Promise<AgentSession> {
    return this.request(`/agents/sessions/${encodeURIComponent(sessionId)}`, { signal: options?.signal });
  }

  async retrieveEnvironment(environmentId: string, options?: ReadOptions): Promise<AgentEnvironmentResource> {
    const value = await this.request<unknown>(
      `/agents/environments/${encodeURIComponent(environmentId)}`,
      { signal: options?.signal },
    );
    return projectEnvironmentResource(value, environmentId);
  }

  updateSession(sessionId: string, metadata: Record<string, string> | null): Promise<AgentSession> {
    return this.request(`/agents/sessions/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: JSON.stringify({ metadata }),
    });
  }

  deleteSession(sessionId: string): Promise<SessionDeleted> {
    return this.request(`/agents/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }

  listItems(sessionId: string, options?: PageOptions & { signal?: AbortSignal }): Promise<ListPage<SessionItem>> {
    const params = new URLSearchParams();
    addPageOptions(params, options);
    return this.request(withQuery(`/agents/sessions/${encodeURIComponent(sessionId)}/items`, params), {
      signal: options?.signal,
    });
  }

  listTurns(sessionId: string, options?: PageOptions): Promise<ListPage<AgentTurn>> {
    const params = new URLSearchParams();
    addPageOptions(params, options);
    return this.request(withQuery(`/agents/sessions/${encodeURIComponent(sessionId)}/turns`, params));
  }

  retrieveTurn(sessionId: string, turnId: string): Promise<AgentTurn> {
    return this.request(
      `/agents/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}`,
    );
  }

  private submitEvents(sessionId: string, events: unknown[], idempotencyKey = randomKey()): Promise<void> {
    return this.request(`/agents/sessions/${encodeURIComponent(sessionId)}/events`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ events }),
    });
  }

  sendMessage(sessionId: string, text: string, idempotencyKey?: string): Promise<void> {
    return this.submitEvents(
      sessionId,
      [
        {
          type: "agent.session.input.message",
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text }],
            },
          ],
        },
      ],
      idempotencyKey,
    );
  }

  cancelTurn(sessionId: string, idempotencyKey?: string): Promise<void> {
    return this.submitEvents(sessionId, [{ type: "agent.session.input.cancel" }], idempotencyKey);
  }

  submitFunctionResult(sessionId: string, input: FunctionResultInput, idempotencyKey?: string): Promise<void> {
    return this.submitEvents(
      sessionId,
      [
        {
          type: "agent.session.input.tool_result",
          call_id: input.callId,
          turn_id: input.turnId,
          success: input.success,
          output: input.output,
          error: input.error,
        },
      ],
      idempotencyKey,
    );
  }

  async streamEvents(sessionId: string, options: StreamOptions): Promise<void> {
    const headers = this.headers({ Accept: "text/event-stream" });
    const response = await this.fetchImpl(
      `${this.baseUrl}/agents/sessions/${encodeURIComponent(sessionId)}/events`,
      { headers, signal: options.signal },
    );
    if (!response.ok) throw await this.toError(response);
    if (!response.body) throw new AgentCoreError("Agent core returned an empty event stream.", 502, "empty_stream");

    const decoder = createSSEDecoder((message) => {
      if (message.data === "[DONE]") return;
      const event = JSON.parse(message.data) as SessionEvent;
      if (!event.type && message.event) (event as { type?: string }).type = message.event;
      options.onEvent(event);
    });
    const text = new TextDecoder();
    const reader = response.body.getReader();

    try {
      options.onOpen?.();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        decoder.push(text.decode(value, { stream: true }));
      }
      decoder.push(text.decode());
      decoder.finish();
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
}
