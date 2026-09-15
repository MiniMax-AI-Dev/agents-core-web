import http from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.AGENTS_FIXTURE_PORT ?? 18092);
const baseline = 1_789_438_800;

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

function sessionSnapshot(agent) {
  const { object: _object, metadata: _metadata, created_at: _created, updated_at: _updated, ...snapshot } = agent;
  return snapshot;
}

function initialState() {
  const first = savedAgent("agent_a", "Lifecycle Agent", "fixture/model-a", baseline - 60);
  const second = savedAgent("agent_b", "Second Agent", "fixture/model-b", baseline - 30);
  return {
    agents: [first, second],
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
    requests: [],
    controls: {
      retrieveDelayMs: 0,
      retrieveStatus: 200,
      updateDelayMs: 0,
      updateStatus: 200,
      deleteDelayMs: 0,
      deleteStatus: 200,
      sendStatus: 204,
      sendResponseLoss: 0,
      itemsScenario: 0,
      environmentScenario: 0,
      environmentEventStatus: 0,
      environmentEventCount: 0,
      streamCloseCount: 0,
      streamCloseDelayMs: 30,
    },
    sequence: 0,
  };
}

function applyEnvironmentScenario(value) {
  const session = state.sessions[0];
  if (!session) return;
  const hostileRemote = "https://launcher:private@executor.example.test/connect?executor_token=secret#credential";
  if (value === 1 || value === 4) {
    session.environment = {
      type: "self_hosted",
      id: "environment_fixture",
      remote_url: hostileRemote,
      workspace_directory: `/workspace/<script>safe</script>/${"long/".repeat(45)}project`,
      capability_directories: ["/capabilities/read-only", `/capabilities/${"wide/".repeat(55)}`],
    };
    session.status = value === 1 ? "requires_action" : "idle";
    session.required_actions = value === 1 ? [
      { type: "environment_connection", environment_id: "environment_fixture" },
      { type: "function_call", call_id: "call_fixture", turn_id: "turn_fixture", name: "confirm", arguments: { safe: true } },
    ] : [];
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

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (request.method === "GET" && url.pathname === "/__fixture/health") {
      return sendJson(response, { ready: true });
    }
    if (request.method === "POST" && url.pathname === "/__fixture/reset") {
      state = initialState();
      return sendJson(response, { reset: true });
    }
    if (request.method === "POST" && url.pathname === "/__fixture/control") {
      state.controls = { ...state.controls, ...await readJson(request) };
      applyEnvironmentScenario(state.controls.environmentScenario);
      return sendJson(response, state.controls);
    }
    if (request.method === "GET" && url.pathname === "/__fixture/requests") {
      return sendJson(response, state.requests);
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
      const created = {
        ...savedAgent(`agent_created_${state.sequence}`, body.name, body.model, baseline + state.sequence),
        instructions: body.instructions,
        metadata: body.metadata,
      };
      state.agents.unshift(created);
      return sendJson(response, created, 201);
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/sessions") {
      return sendJson(response, page(state.sessions));
    }

    if (request.method === "POST" && url.pathname === "/v1/agents/sessions") {
      const agent = state.agents.find((candidate) => candidate.id === body.agent_id);
      if (!agent) return sendError(response, 404, "Fixture Agent not found for Session.");
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
    if (request.method === "GET" && sessionMatch) {
      const session = state.sessions.find((candidate) => candidate.id === decodeURIComponent(sessionMatch[1]));
      return session ? sendJson(response, session) : sendError(response, 404, "Fixture Session not found.");
    }

    const itemsMatch = url.pathname.match(/^\/v1\/agents\/sessions\/([^/]+)\/items$/);
    if (request.method === "GET" && itemsMatch) return sendJson(response, page(state.controls.itemsScenario ? patchItems() : []));

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
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      response.write(": fixture stream open\n\n");
      const statuses = [null, "pending", "ready", "connected", "disconnected", "failed", "expired"];
      const environmentStatus = statuses[state.controls.environmentEventStatus] ?? null;
      if (environmentStatus && state.controls.environmentEventCount > 0) {
        state.controls.environmentEventCount -= 1;
        state.sequence += 1;
        const environment = {
          id: "environment_fixture",
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
      request.on("close", () => clearInterval(heartbeat));
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
