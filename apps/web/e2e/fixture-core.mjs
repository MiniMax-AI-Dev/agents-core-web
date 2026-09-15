import http from "node:http";

const host = "127.0.0.1";
const port = 18092;
const baseline = 1_789_438_800;

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
    },
    sequence: 0,
  };
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
    if (request.method === "GET" && itemsMatch) return sendJson(response, page([]));

    const eventsMatch = url.pathname.match(/^\/v1\/agents\/sessions\/([^/]+)\/events$/);
    if (request.method === "GET" && eventsMatch) {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      response.write(": fixture stream open\n\n");
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
