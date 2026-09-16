import http from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.AGENTS_FIXTURE_PORT ?? 18092);
const baseline = 1_789_438_800;
const canonicalEnvironmentUuid = "0f745b0d-b545-49cd-8d7e-4c31c80dc564";
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function patchItems() {
  const longLine = `+export const longValue = "${"x".repeat(2_000)}";`;
  return [
    { id: "patch_intro", turn_id: "turn_patch_intro", type: "message", status: "completed", role: "user", content: [{ type: "input_text", text: "Review the fixture patch" }] },
    {
      id: "patch_completed", turn_id: "turn_patch_completed", type: "function_call", status: "completed", name: "apply_patch", call_id: "call_completed",
      arguments: { changes: [
        { path: "src/<safe>.ts", kind: { type: "add", move_path: null }, diff: `--- /dev/null\n+++ b/src/<safe>.ts\n@@ -0,0 +1,2 @@\n+<script>alert("safe")</script>\n${longLine}` },
        { path: "src/modify.ts", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-old value\n+new value" },
        { path: "src/delete.ts", kind: { type: "delete", move_path: null }, diff: "@@ -1 +0,0 @@\n-removed" },
      ] },
    },
    { id: "patch_output", turn_id: "turn_patch_completed", type: "function_call_output", status: "completed", call_id: "call_completed", output: { applied: true }, duration_ms: 41 },
    { id: "patch_running", turn_id: "turn_patch_running", type: "function_call", status: "in_progress", name: "apply_patch", call_id: "call_running", arguments: { changes: [{ path: "src/running.ts", kind: { type: "update" }, diff: "@@ -1 +1 @@\n-wait\n+working" }] } },
    { id: "patch_failed", turn_id: "turn_patch_failed", type: "function_call", status: "failed", name: "apply_patch", call_id: "call_failed", arguments: { changes: [{ path: "src/failed.ts", kind: { type: "delete" }, diff: "@@ -1 +0,0 @@\n-failed" }] }, error: { message: "fixture failure" } },
    { id: "patch_alternate", turn_id: "turn_patch_alternate", type: "function_call", status: "in_progress", name: "apply_patch", call_id: "call_alternate", arguments: { patch: "*** Begin Patch\nmalformed alternate shape" } },
  ];
}

function observableTurns() {
  return [
    { id: "turn_queued", agent_id: "agent_a", session_id: "session_snapshot", object: "agent.session.turn", status: "queued", created_at: baseline - 18, started_at: null, completed_at: null, error: null, usage: null },
    { id: "turn_in_progress", agent_id: "agent_a", session_id: "session_snapshot", object: "agent.session.turn", status: "in_progress", created_at: baseline - 17, started_at: baseline - 16, completed_at: null, error: null, usage: null },
    { id: "turn_waiting", agent_id: "agent_a", session_id: "session_snapshot", object: "agent.session.turn", status: "waiting", created_at: baseline - 15, started_at: baseline - 14, completed_at: null, error: null, usage: null },
    { id: "turn_completed", agent_id: "agent_a", session_id: "session_snapshot", object: "agent.session.turn", status: "completed", created_at: baseline - 13, started_at: baseline - 12, completed_at: baseline - 5, error: null, usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 2 } } },
    { id: "turn_failed", agent_id: "agent_a", session_id: "session_snapshot", object: "agent.session.turn", status: "failed", created_at: baseline - 4, started_at: baseline - 3, completed_at: baseline - 2, error: { code: "internal_error", message: "The execution could not complete." }, usage: null },
    { id: "turn_cancelled", agent_id: "agent_a", session_id: "session_snapshot", object: "agent.session.turn", status: "cancelled", created_at: baseline - 1, started_at: baseline, completed_at: baseline + 1, error: null, usage: null },
    { id: "turn_terminal_refresh", agent_id: "agent_a", session_id: "session_snapshot", object: "agent.session.turn", status: "in_progress", created_at: baseline + 2, started_at: baseline + 3, completed_at: null, error: null, usage: null },
  ];
}

function observableTurnItems() {
  return [
    { id: "turn_message", turn_id: "turn_completed", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "Completed Turn output remains in the conversation." }] },
    { id: "failed_input", turn_id: "turn_failed", type: "message", status: "completed", role: "user", content: [{ type: "input_text", text: "Persisted input before the Turn failed." }] },
    { id: "unassociated", turn_id: "turn_not_loaded", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "This Item is waiting for its Turn page." }] },
  ];
}

function savedAgent(id, name, model, updatedAt) {
  return {
    id,
    object: "agent",
    model,
    name,
    instructions: `Instructions for ${name}`,
    metadata: { team: "web", fixture: "safe" },
    multi_agent: { enabled: id === "agent_a", max_concurrent_subagents: id === "agent_a" ? 2 : null },
    reasoning: id === "agent_a" ? { effort: "high", summary: "concise" } : {},
    service_tier: id === "agent_a" ? "priority" : "auto",
    text: { format: { type: "text" }, verbosity: id === "agent_a" ? "high" : "medium" },
    tools: id === "agent_a" ? [{ type: "tool_search" }] : [],
    created_at: baseline - 600,
    updated_at: updatedAt,
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isEmptyObject(value) {
  return value == null || isRecord(value) && Object.keys(value).length === 0;
}

function isSafeMcpUrl(value) {
  if (
    typeof value !== "string"
    || /^\p{White_Space}|\p{White_Space}$/u.test(value)
    || /[\u0000-\u0020\u007f\\]/u.test(value)
    || value.includes("?")
    || value.includes("#")
    || /%(?![0-9A-Fa-f]{2})/u.test(value)
  ) return false;
  const schemeSeparator = value.indexOf("://");
  const authority = schemeSeparator >= 0 ? value.slice(schemeSeparator + 3).split("/", 1)[0] : "";
  if (!authority || authority.includes("@") || authority.includes("%") || /[{}\x60]/u.test(authority)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isCanonicalExecutionFunction(tool) {
  return hasOnlyKeys(tool, ["type", "name", "description", "parameters", "defer_loading"])
    && typeof tool.name === "string"
    && typeof tool.description === "string"
    && isRecord(tool.parameters)
    && (tool.defer_loading === undefined || typeof tool.defer_loading === "boolean");
}

function isCanonicalExecutionMcp(tool) {
  const transport = tool.transport;
  const allowedTools = tool.allowed_tools;
  return hasOnlyKeys(tool, [
    "type", "server_label", "transport", "allowed_tools", "connection_origin",
    "credential_id", "request_metadata", "required",
  ])
    && typeof tool.server_label === "string"
    && !/^\p{White_Space}*$/u.test(tool.server_label)
    && isRecord(transport)
    && hasOnlyKeys(transport, ["type", "server_url", "headers"])
    && transport.type === "http"
    && isSafeMcpUrl(transport.server_url)
    && isEmptyObject(transport.headers)
    && tool.connection_origin === "service"
    && (tool.credential_id == null || typeof tool.credential_id === "string")
    && isEmptyObject(tool.request_metadata)
    && (tool.required === undefined || typeof tool.required === "boolean")
    && (allowedTools == null || Array.isArray(allowedTools) && allowedTools.every((name) => typeof name === "string" && name.length > 0));
}

function sessionAdmissionError(agent) {
  if (/^\p{White_Space}*$/u.test(agent.model)) return "Execution currently requires a nonempty model.";
  if (agent.multi_agent.enabled || agent.multi_agent.max_concurrent_subagents !== null) return "Enabled multi_agent execution is not supported by this service yet.";
  if (agent.reasoning.effort != null || agent.reasoning.summary != null) return "Explicit reasoning execution options are not supported by this service yet.";
  if (agent.service_tier !== "auto") return "Execution currently supports service_tier=auto only.";
  if (agent.text.format.type !== "text") return "Execution currently supports text.format.type=text only.";

  const functionNames = new Set();
  const mcpLabels = new Set();
  let functionCount = 0;
  for (const tool of agent.tools) {
    if (tool.type === "function") {
      functionCount += 1;
      if (!isCanonicalExecutionFunction(tool) || /^\p{White_Space}*$/u.test(tool.name) || Buffer.byteLength(tool.name, "utf8") > 512 || functionNames.has(tool.name) || tool.defer_loading === true) {
        return "Invalid execution function fields.";
      }
      functionNames.add(tool.name);
    } else if (tool.type === "mcp") {
      if (!isCanonicalExecutionMcp(tool) || mcpLabels.has(tool.server_label) || tool.credential_id != null) {
        return "Invalid execution MCP fields.";
      }
      mcpLabels.add(tool.server_label);
    } else {
      return "Execution currently supports non-deferred functions and the service-origin HTTP MCP profile only.";
    }
  }
  if (functionCount > 64) return "This service supports at most 64 function tools.";
  return null;
}

function sessionSnapshot(agent) {
  const { object: _object, metadata: _metadata, created_at: _created, updated_at: _updated, ...snapshot } = agent;
  return snapshot;
}

function initialState() {
  const first = savedAgent("agent_a", "Lifecycle Agent", "fixture/model-a", baseline - 60);
  const second = savedAgent("agent_b", "Second Agent", "fixture/model-b", baseline - 30);
  const savedOnlyTool = savedAgent("agent_tool_only", "Saved-only Tool Agent", "fixture/model-tool", baseline - 20);
  savedOnlyTool.tools = [{ type: "tool_search" }];
  return {
    agents: [first, second, savedOnlyTool],
    sessions: [{
      id: "session_snapshot",
      object: "agent.session",
      agent: sessionSnapshot(first),
      environment: { type: "none" },
      status: "idle",
      error: null,
      metadata: { fixture: "durable-agent-snapshot" },
      required_actions: [],
      vault_ids: [],
      usage: null,
      created_at: baseline - 20,
      last_active_at: baseline - 10,
    }],
    turns: [],
    requests: [],
    controls: {
      createAgentResponseVariant: "valid",
      retrieveDelayMs: 0,
      retrieveStatus: 200,
      updateDelayMs: 0,
      updateStatus: 200,
      deleteDelayMs: 0,
      deleteStatus: 200,
      sendStatus: 204,
      sendResponseLoss: 0,
      itemsScenario: 0,
      turnsScenario: 0,
      turnsRetrieveDelayMs: 0,
      turnsRetrieveStatus: 200,
      turnsPageSize: 2,
      environmentScenario: 0,
      environmentRetrieveDelayMs: 0,
      environmentRetrieveStatus: 200,
      environmentResourceStatus: "pending",
      environmentResourceVariant: "valid",
      environmentEventStatus: 0,
      environmentEventCount: 0,
      streamStatus: 200,
      streamOpenDelayMs: 0,
      streamCloseCount: 0,
      streamCloseDelayMs: 30,
      sessionRetrieveDelayMs: 0,
      sessionRetrieveStatus: 200,
      sessionRetrieveVariant: "valid",
      sessionUpdateDelayMs: 0,
      sessionUpdateStatus: 200,
      sessionUpdateResponseLoss: 0,
      sessionDeleteDelayMs: 0,
      sessionDeleteStatus: 200,
      sessionDeleteResponseLoss: 0,
      sessionDeleteStreamCloseDelayMs: 0,
      itemsRetrieveDelayMs: 0,
      itemsRetrieveStatus: 200,
    },
    aborts: {
      sessionReads: 0,
      itemReads: 0,
      turnReads: 0,
      streams: 0,
    },
    sequence: 0,
  };
}

function applyTurnsScenario(value) {
  const session = state.sessions[0];
  if (!session) return;
  if (value === 1) {
    state.turns = observableTurns();
    session.usage = {
      input_tokens: 20,
      output_tokens: 6,
      total_tokens: 26,
      input_tokens_details: { cached_tokens: 8 },
      output_tokens_details: { reasoning_tokens: 4 },
    };
    return;
  }
  state.turns = [];
  session.usage = null;
}

function applyEnvironmentScenario(value) {
  const session = state.sessions[0];
  if (!session) return;
  const hostileRemote = "https://launcher:private@executor.example.test/connect?executor_token=secret#credential";
  if (value === 7) {
    session.environment = { type: "none" };
    session.status = "in_progress";
    session.required_actions = [];
    return;
  }
  if (value === 1 || value === 4 || value === 5 || value === 6) {
    session.environment = {
      type: "self_hosted",
      id: value === 5 ? canonicalEnvironmentUuid.toUpperCase() : "environment_fixture",
      remote_url: hostileRemote,
      workspace_directory: `/workspace/<script>safe</script>/${"long/".repeat(45)}project`,
      capability_directories: ["/capabilities/read-only", `/capabilities/${"wide/".repeat(55)}`],
    };
    session.status = value === 1 || value === 6 ? "requires_action" : "idle";
    session.required_actions = value === 1
      ? [
          { type: "environment_connection", environment_id: "environment_fixture" },
          { type: "function_call", call_id: "call_fixture", turn_id: "turn_fixture", name: "confirm", arguments: { safe: true } },
        ]
      : value === 6
        ? [{ type: "environment_connection", environment_id: "environment_fixture" }]
        : [];
    return;
  }
  if (value === 2) {
    session.environment = { type: "future_remote", remote_url: "javascript:alert(1)", workspace_directory: "/must-not-render" };
    session.status = "idle";
    session.required_actions = [];
    return;
  }
  if (value === 3) {
    session.environment = { type: "self_hosted" };
    session.status = "idle";
    session.required_actions = [];
  }
}

let state = initialState();
const streamResponses = new Map();

function emitTurnLifecycle(status) {
  const index = state.turns.findIndex((turn) => turn.id === "turn_terminal_refresh");
  const existing = state.turns[index];
  if (!existing || !["completed", "failed", "cancelled"].includes(status)) return false;
  const terminal = {
    ...existing,
    status,
    completed_at: baseline + 10,
    error: status === "failed" ? { code: "internal_error", message: "The execution could not complete." } : null,
    usage: status === "completed" ? { input_tokens: 5, output_tokens: 2, total_tokens: 7, input_tokens_details: { cached_tokens: 1 }, output_tokens_details: { reasoning_tokens: 1 } } : null,
  };
  state.turns[index] = terminal;
  state.sequence += 1;
  const event = `id: turn_${state.sequence}\ndata: ${JSON.stringify({
    type: `agent.session.turn.${status}`,
    event_id: `turn_${state.sequence}`,
    session_id: "session_snapshot",
    turn_id: terminal.id,
    turn: terminal,
  })}\n\n`;
  for (const stream of streamResponses.keys()) stream.write(event);
  return true;
}

function sendJson(response, value, status = 200) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendError(response, status, message) {
  sendJson(response, {
    error: {
      code: "fixture_failure",
      type: "fixture_error",
      message,
    },
  }, status);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function page(data) {
  return {
    object: "list",
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data.at(-1)?.id ?? null,
  };
}

function recordRequest(request, url, body) {
  state.requests.push({
    method: request.method,
    path: url.pathname,
    query: url.search,
    beta: request.headers["openai-beta"] ?? null,
    authorizationPresent: Boolean(request.headers.authorization),
    idempotencyKeyPresent: Boolean(request.headers["idempotency-key"]),
    idempotencyKey: request.headers["idempotency-key"] ?? null,
    body,
  });
}

function consumeControl(prefix) {
  const delayMs = state.controls[`${prefix}DelayMs`];
  const status = state.controls[`${prefix}Status`];
  state.controls[`${prefix}DelayMs`] = 0;
  state.controls[`${prefix}Status`] = 200;
  return { delayMs, status };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function trackAbort(response, key) {
  let finished = false;
  response.once("finish", () => {
    finished = true;
  });
  response.once("close", () => {
    if (!finished) state.aborts[key] += 1;
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (request.method === "GET" && url.pathname === "/__fixture/health") {
      return sendJson(response, { ready: true });
    }
    if (request.method === "POST" && url.pathname === "/__fixture/reset") {
      for (const stream of streamResponses.keys()) stream.end();
      streamResponses.clear();
      state = initialState();
      return sendJson(response, { reset: true });
    }
    if (request.method === "POST" && url.pathname === "/__fixture/control") {
      state.controls = { ...state.controls, ...await readJson(request) };
      applyEnvironmentScenario(state.controls.environmentScenario);
      applyTurnsScenario(state.controls.turnsScenario);
      return sendJson(response, state.controls);
    }
    if (request.method === "POST" && url.pathname === "/__fixture/emit-turn") {
      const input = await readJson(request);
      return emitTurnLifecycle(input.status)
        ? sendJson(response, { emitted: true })
        : sendError(response, 400, "Fixture terminal Turn is unavailable.");
    }
    if (request.method === "GET" && url.pathname === "/__fixture/requests") {
      return sendJson(response, state.requests);
    }
    if (request.method === "GET" && url.pathname === "/__fixture/state") {
      return sendJson(response, {
        sessions: state.sessions,
        aborts: state.aborts,
        openStreams: [...streamResponses.values()],
      });
    }
    if (request.method === "POST" && url.pathname === "/__fixture/session-metadata") {
      const input = await readJson(request);
      const target = state.sessions.find((session) => session.id === input.id);
      if (!target) return sendError(response, 404, "Fixture Session not found.");
      target.metadata = input.metadata;
      return sendJson(response, target);
    }
    if (request.method === "POST" && url.pathname === "/__fixture/remove-session") {
      const input = await readJson(request);
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((session) => session.id !== input.id);
      return sendJson(response, { removed: state.sessions.length !== before });
    }

    const body = request.method === "GET" || request.method === "DELETE" ? undefined : await readJson(request);
    recordRequest(request, url, body);

    if (request.method === "GET" && url.pathname === "/v1/agents") {
      const listed = state.agents.map((agent, index) => index === 0
        ? { ...agent, name: `${agent.name} · stale list`, updated_at: agent.updated_at - 10 }
        : agent);
      return sendJson(response, page(listed));
    }

    if (request.method === "POST" && url.pathname === "/v1/agents") {
      state.sequence += 1;
      const defaults = savedAgent(`agent_created_${state.sequence}`, body.name ?? null, body.model, baseline + state.sequence);
      const created = {
        ...defaults,
        instructions: body.instructions ?? null,
        metadata: body.metadata ?? {},
        multi_agent: body.multi_agent ?? { enabled: false, max_concurrent_subagents: null },
        reasoning: body.reasoning ?? {},
        service_tier: body.service_tier ?? "auto",
        text: {
          format: body.text?.format ?? { type: "text" },
          verbosity: body.text?.verbosity ?? "medium",
        },
        tools: body.tools ?? [],
      };
      if (state.controls.createAgentResponseVariant === "reasoning") {
        created.reasoning = { effort: "high" };
        state.controls.createAgentResponseVariant = "valid";
      }
      state.agents.unshift(created);
      return sendJson(response, created, 201);
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/sessions") {
      return sendJson(response, page(state.sessions));
    }

    if (request.method === "POST" && url.pathname === "/v1/agents/sessions") {
      const agent = state.agents.find((candidate) => candidate.id === body.agent_id);
      if (!agent) return sendError(response, 404, "Fixture Agent not found for Session.");
      const admissionError = sessionAdmissionError(agent);
      if (admissionError) return sendError(response, 400, admissionError);
      state.sequence += 1;
      const created = {
        id: `session_created_${state.sequence}`,
        object: "agent.session",
        agent: sessionSnapshot(agent),
        environment: body.environment,
        status: "idle",
        error: null,
        metadata: body.metadata ?? {},
        required_actions: [],
        vault_ids: body.vault_ids ?? [],
        usage: null,
        created_at: baseline + state.sequence,
        last_active_at: baseline + state.sequence,
      };
      state.sessions.unshift(created);
      return sendJson(response, created, 201);
    }

    const agentMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)$/);
    if (agentMatch) {
      const id = decodeURIComponent(agentMatch[1]);
      const agent = state.agents.find((candidate) => candidate.id === id);
      if (!agent) return sendError(response, 404, "Fixture Agent not found.");

      if (request.method === "GET") {
        const control = consumeControl("retrieve");
        if (control.delayMs) await wait(control.delayMs);
        if (control.status !== 200) return sendError(response, control.status, "Fixture retrieve failed.");
        return sendJson(response, agent);
      }

      if (request.method === "POST") {
        const control = consumeControl("update");
        if (control.delayMs) await wait(control.delayMs);
        if (control.status !== 200) return sendError(response, control.status, "Fixture update failed.");
        const updated = { ...agent, ...body, updated_at: agent.updated_at + 100 };
        state.agents = state.agents.map((candidate) => candidate.id === id ? updated : candidate);
        return sendJson(response, updated);
      }

      if (request.method === "DELETE") {
        const control = consumeControl("delete");
        if (control.delayMs) await wait(control.delayMs);
        if (control.status !== 200) return sendError(response, control.status, "Fixture delete failed.");
        state.agents = state.agents.filter((candidate) => candidate.id !== id);
        return sendJson(response, { id, object: "agent.deleted", deleted: true });
      }
    }

    const sessionMatch = url.pathname.match(/^\/v1\/agents\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      const session = state.sessions.find((candidate) => candidate.id === id);
      if (!session) return sendError(response, 404, "Fixture Session not found.");

      if (request.method === "GET") {
        trackAbort(response, "sessionReads");
        const delayMs = state.controls.sessionRetrieveDelayMs;
        const status = state.controls.sessionRetrieveStatus;
        const variant = state.controls.sessionRetrieveVariant;
        state.controls.sessionRetrieveDelayMs = 0;
        state.controls.sessionRetrieveStatus = 200;
        state.controls.sessionRetrieveVariant = "valid";
        const retrievedSession = variant === "wrong_id"
          ? { ...session, id: "another_session" }
          : variant === "malformed"
            ? { id, object: "agent.session", metadata: session.metadata }
            : variant === "deep_malformed"
              ? { ...session, agent: { model: session.agent.model } }
              : session;
        if (delayMs && status === 200) {
          const payload = JSON.stringify(retrievedSession);
          response.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "content-length": Buffer.byteLength(payload) + 1,
            "cache-control": "no-store",
          });
          response.write(" ");
          await wait(delayMs);
          if (response.destroyed) return;
          response.end(payload);
          return;
        }
        if (delayMs) await wait(delayMs);
        if (response.destroyed) return;
        if (status !== 200) return sendError(response, status, "Fixture Session retrieve failed.");
        return sendJson(response, retrievedSession);
      }

      if (request.method === "POST") {
        const delayMs = state.controls.sessionUpdateDelayMs;
        const status = state.controls.sessionUpdateStatus;
        const responseLoss = state.controls.sessionUpdateResponseLoss;
        state.controls.sessionUpdateDelayMs = 0;
        state.controls.sessionUpdateStatus = 200;
        state.controls.sessionUpdateResponseLoss = 0;
        if (delayMs) await wait(delayMs);
        if (status !== 200) return sendError(response, status, "Fixture Session update failed.");
        session.metadata = body.metadata ?? session.metadata;
        if (responseLoss) {
          response.destroy();
          return;
        }
        return sendJson(response, session);
      }

      if (request.method === "DELETE") {
        const delayMs = state.controls.sessionDeleteDelayMs;
        const status = state.controls.sessionDeleteStatus;
        const responseLoss = state.controls.sessionDeleteResponseLoss;
        state.controls.sessionDeleteDelayMs = 0;
        state.controls.sessionDeleteStatus = 200;
        state.controls.sessionDeleteResponseLoss = 0;
        if (delayMs) await wait(delayMs);
        if (status !== 200) return sendError(response, status, "Fixture Session delete failed.");
        if (responseLoss === 2) {
          response.destroy();
          return;
        }
        state.sessions = state.sessions.filter((candidate) => candidate.id !== id);
        state.turns = state.turns.filter((turn) => turn.session_id !== id);
        const targetStreams = [...streamResponses]
          .filter(([, streamSessionId]) => streamSessionId === id)
          .map(([stream]) => stream);
        const closeStreams = () => {
          for (const stream of targetStreams) {
            if (!stream.destroyed) stream.end();
          }
        };
        if (state.controls.sessionDeleteStreamCloseDelayMs) {
          setTimeout(closeStreams, state.controls.sessionDeleteStreamCloseDelayMs);
        } else {
          closeStreams();
        }
        if (responseLoss) {
          response.destroy();
          return;
        }
        return sendJson(response, { id, object: "agent.session.deleted", deleted: true });
      }
    }

    const environmentMatch = url.pathname.match(/^\/v1\/agents\/environments\/([^/]+)$/);
    if (request.method === "GET" && environmentMatch) {
      if (state.controls.environmentRetrieveDelayMs) await wait(state.controls.environmentRetrieveDelayMs);
      if (state.controls.environmentRetrieveStatus !== 200) {
        return sendError(response, state.controls.environmentRetrieveStatus, "Fixture Environment retrieve failed.");
      }
      const id = decodeURIComponent(environmentMatch[1]);
      const sessionEnvironment = state.sessions[0]?.environment;
      const expectedId = sessionEnvironment?.type === "self_hosted" ? sessionEnvironment.id : null;
      if (id !== expectedId) return sendError(response, 404, "Fixture Environment not found.");
      const canonicalId = id.toLowerCase();
      const resource = {
        id: canonicalUuidPattern.test(canonicalId) ? canonicalId : id,
        object: "agent.environment",
        type: "self_hosted",
        status: state.controls.environmentResourceStatus,
        files: [],
        plugins: [],
        skills: [],
      };
      if (state.controls.environmentResourceVariant === "missing_skills") delete resource.skills;
      if (state.controls.environmentResourceVariant === "wrong_id") resource.id = "another_environment";
      if (state.controls.environmentResourceVariant === "extra_field") resource.extra = true;
      return sendJson(response, resource);
    }

    const itemsMatch = url.pathname.match(/^\/v1\/agents\/sessions\/([^/]+)\/items$/);
    if (request.method === "GET" && itemsMatch) {
      trackAbort(response, "itemReads");
      if (state.controls.itemsRetrieveDelayMs) await wait(state.controls.itemsRetrieveDelayMs);
      if (response.destroyed) return;
      if (state.controls.itemsRetrieveStatus !== 200) {
        return sendError(response, state.controls.itemsRetrieveStatus, "Fixture Items retrieve failed.");
      }
      const sessionId = decodeURIComponent(itemsMatch[1]);
      if (!state.sessions.some((candidate) => candidate.id === sessionId)) {
        return sendError(response, 404, "Fixture Session not found for Items.");
      }
      const items = sessionId !== "session_snapshot"
        ? []
        : state.controls.itemsScenario
          ? patchItems()
          : state.controls.turnsScenario
            ? observableTurnItems()
            : [];
      return sendJson(response, page(items));
    }

    const turnsMatch = url.pathname.match(/^\/v1\/agents\/sessions\/([^/]+)\/turns$/);
    if (request.method === "GET" && turnsMatch) {
      trackAbort(response, "turnReads");
      if (state.controls.turnsRetrieveDelayMs) await wait(state.controls.turnsRetrieveDelayMs);
      if (response.destroyed) return;
      if (state.controls.turnsRetrieveStatus !== 200) {
        return sendError(response, state.controls.turnsRetrieveStatus, "Fixture Turns retrieve failed.");
      }
      const sessionId = decodeURIComponent(turnsMatch[1]);
      if (!state.sessions.some((candidate) => candidate.id === sessionId)) {
        return sendError(response, 404, "Fixture Session not found for Turns.");
      }
      const sessionTurns = state.turns.filter((turn) => turn.session_id === sessionId);
      const after = url.searchParams.get("after");
      const start = after ? sessionTurns.findIndex((turn) => turn.id === after) + 1 : 0;
      if (after && start === 0) return sendError(response, 400, "Fixture Turn cursor not found.");
      const requestedLimit = Number(url.searchParams.get("limit") ?? 20);
      const size = Math.max(1, Math.min(requestedLimit, state.controls.turnsPageSize));
      const data = sessionTurns.slice(start, start + size);
      return sendJson(response, {
        object: "list",
        data,
        has_more: start + data.length < sessionTurns.length,
      });
    }

    const eventsMatch = url.pathname.match(/^\/v1\/agents\/sessions\/([^/]+)\/events$/);
    if (request.method === "POST" && eventsMatch) {
      const status = state.controls.sendStatus;
      const responseLoss = state.controls.sendResponseLoss;
      state.controls.sendStatus = 204;
      state.controls.sendResponseLoss = 0;
      if (responseLoss) {
        response.destroy();
        return;
      }
      if (status !== 204) return sendError(response, status, "Fixture send failed.");
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && eventsMatch) {
      trackAbort(response, "streams");
      const sessionId = decodeURIComponent(eventsMatch[1]);
      if (state.controls.streamOpenDelayMs) await wait(state.controls.streamOpenDelayMs);
      if (response.destroyed) return;
      if (!state.sessions.some((candidate) => candidate.id === sessionId)) {
        return sendError(response, 404, "Fixture Session not found for stream.");
      }
      if (state.controls.streamStatus !== 200) {
        return sendError(response, state.controls.streamStatus, "Fixture stream rejected.");
      }
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      streamResponses.set(response, sessionId);
      response.write(": fixture stream open\n\n");
      const statuses = [null, "pending", "ready", "connected", "disconnected", "failed", "expired"];
      const environmentStatus = statuses[state.controls.environmentEventStatus] ?? null;
      if (environmentStatus && state.controls.environmentEventCount > 0) {
        state.controls.environmentEventCount -= 1;
        state.sequence += 1;
        const sessionEnvironment = state.sessions[0]?.environment;
        const rawEnvironmentId = sessionEnvironment?.type === "self_hosted"
          ? sessionEnvironment.id
          : "environment_fixture";
        const canonicalEnvironmentId = rawEnvironmentId.toLowerCase();
        const environment = {
          id: canonicalUuidPattern.test(canonicalEnvironmentId) ? canonicalEnvironmentId : rawEnvironmentId,
          type: "self_hosted",
          status: environmentStatus,
          error: environmentStatus === "failed" ? {
            code: "environment_failed",
            type: "environment_error",
            message: "Safe failure; Authorization: Bearer fixture-secret X-API-Key: fixture-key",
          } : null,
        };
        response.write(`id: environment_${state.sequence}\ndata: ${JSON.stringify({
          type: `agent.session.environment.${environmentStatus}`,
          event_id: `environment_${state.sequence}`,
          session_id: "session_snapshot",
          environment,
        })}\n\n`);
      }
      if (state.controls.streamCloseCount > 0) {
        state.controls.streamCloseCount -= 1;
        setTimeout(() => response.end(), state.controls.streamCloseDelayMs);
      }
      const heartbeat = setInterval(() => response.write(": fixture heartbeat\n\n"), 10_000);
      request.on("close", () => {
        clearInterval(heartbeat);
        streamResponses.delete(response);
      });
      return;
    }

    return sendError(response, 404, `No fixture route for ${request.method} ${url.pathname}`);
  } catch (error) {
    return sendError(response, 500, error instanceof Error ? error.message : "Unknown fixture failure.");
  }
});

server.listen(port, host, () => {
  process.stdout.write(`AGENT_FIXTURE_READY http://${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
