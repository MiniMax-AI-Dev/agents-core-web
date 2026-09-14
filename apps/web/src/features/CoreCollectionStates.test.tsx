import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentSession, SavedAgent, SessionItem } from "@agents-core-web/agents-client";

import { AgentsView } from "./agents/AgentsView";
import { restoreDraftAfterFailedSend, SessionsView } from "./sessions/SessionsView";

const agentsCallbacks = {
  onCreate: async () => undefined,
  onRefresh: () => undefined,
  onStartSession: async () => undefined,
};

const sessionsCallbacks = {
  onCancel: async () => undefined,
  onCreateSession: async () => undefined,
  onFunctionResult: async () => undefined,
  onRefresh: () => undefined,
  onRetrySession: () => undefined,
  onRetryStream: () => undefined,
  onSelect: () => undefined,
  onSend: async () => undefined,
};

const selectedSession: AgentSession = {
  id: "session_1",
  object: "agent.session",
  agent: {
    id: "agent_1",
    model: "gpt-5",
    name: "Researcher",
    instructions: null,
    multi_agent: { enabled: false, max_concurrent_subagents: null },
    reasoning: {},
    service_tier: "auto",
    text: { format: { type: "text" }, verbosity: "medium" },
    tools: [],
  },
  environment: { type: "none" },
  status: "idle",
  error: null,
  metadata: {},
  required_actions: [],
  vault_ids: [],
  usage: null,
  created_at: 1,
  last_active_at: 1,
};

const durableItems: SessionItem[] = [{
  id: "item_1",
  turn_id: "turn_1",
  type: "message",
  status: "completed",
  role: "user",
  content: [{ type: "input_text", text: "Existing durable item" }],
}];

const savedAgent: SavedAgent = {
  ...selectedSession.agent,
  object: "agent",
  metadata: {},
  created_at: 1,
  updated_at: 1,
};

describe("Agent Core collection states", () => {
  it("restores a failed message only when it cannot overwrite a newer draft", () => {
    expect(restoreDraftAfterFailedSend("", "failed message")).toBe("failed message");
    expect(restoreDraftAfterFailedSend("new draft", "failed message")).toBe("new draft");
  });

  it("keeps an Agents load failure distinct from a ready empty collection", () => {
    const failed = renderToStaticMarkup(
      <AgentsView
        agents={[]}
        busy={false}
        coreError="connection refused"
        coreState="failed"
        {...agentsCallbacks}
      />,
    );
    const empty = renderToStaticMarkup(
      <AgentsView
        agents={[]}
        busy={false}
        coreError={null}
        coreState="ready"
        {...agentsCallbacks}
      />,
    );

    expect(failed).toContain("Couldn’t load Agents");
    expect(failed).toContain("connection refused");
    expect(failed).not.toContain("No saved Agents");
    expect(empty).toContain("No saved Agents");
  });

  it("keeps a stale Agent ledger visible when its collection refresh fails", () => {
    const failed = renderToStaticMarkup(
      <AgentsView
        agents={[savedAgent]}
        busy={false}
        coreError="agents refresh failed"
        coreState="failed"
        {...agentsCallbacks}
      />,
    );

    expect(failed).toContain("Couldn’t refresh Agents");
    expect(failed).toContain("agents refresh failed");
    expect(failed).toContain('aria-label="Agents"');
    expect(failed).toContain("Researcher");
  });

  it("keeps Sessions loading and failure distinct from ready empty copy", () => {
    const common = {
      agents: [],
      sessions: [],
      selected: null,
      items: [],
      busy: false,
      detailError: null,
      detailState: "idle" as const,
      streamError: null,
      streamState: "idle" as const,
      ...sessionsCallbacks,
    };
    const loading = renderToStaticMarkup(
      <SessionsView {...common} coreError={null} coreState="connecting" />,
    );
    const failed = renderToStaticMarkup(
      <SessionsView {...common} coreError="connection refused" coreState="failed" />,
    );
    const empty = renderToStaticMarkup(
      <SessionsView {...common} coreError={null} coreState="ready" />,
    );

    expect(loading).toContain("Loading Sessions");
    expect(loading).not.toContain("No Sessions yet");
    expect(failed).toContain("Couldn’t load Sessions");
    expect(failed).not.toContain("Select or create a Session");
    expect(empty).toContain("No Sessions yet");
    expect(empty).toContain("Select or create a Session");
  });

  it("keeps stale Sessions and a healthy selected workspace usable after collection refresh fails", () => {
    const failed = renderToStaticMarkup(
      <SessionsView
        agents={[]}
        sessions={[selectedSession]}
        selected={selectedSession}
        items={durableItems}
        busy={false}
        coreError="sessions refresh failed"
        coreState="failed"
        detailError={null}
        detailState="ready"
        streamError={null}
        streamState="listening"
        {...sessionsCallbacks}
      />,
    );
    const composer = failed.match(/<textarea[^>]*aria-label="Message the Agent"[^>]*>/)?.[0] ?? "";

    expect(failed).toContain("Couldn’t refresh Sessions");
    expect(failed).toContain("sessions refresh failed");
    expect(failed).toContain("Existing durable item");
    expect(failed).toContain("listening");
    expect(composer).not.toContain("disabled");
  });

  it("does not claim an empty timeline before the selected Session load succeeds", () => {
    const common = {
      agents: [],
      sessions: [selectedSession],
      selected: selectedSession,
      items: [],
      busy: false,
      coreError: null,
      coreState: "ready" as const,
      streamError: null,
      streamState: "connecting" as const,
      ...sessionsCallbacks,
    };
    const loading = renderToStaticMarkup(
      <SessionsView {...common} detailError={null} detailState="loading" />,
    );
    const failed = renderToStaticMarkup(
      <SessionsView {...common} detailError="items request failed" detailState="failed" />,
    );
    const ready = renderToStaticMarkup(
      <SessionsView {...common} detailError={null} detailState="ready" streamState="listening" />,
    );

    expect(loading).toContain("Loading Session timeline");
    expect(loading).not.toContain("Session is ready");
    expect(failed).toContain("Couldn’t load this Session");
    expect(failed).toContain("items request failed");
    expect(failed).toContain("Retry");
    expect(failed).not.toContain("Session is ready");
    expect(ready).toContain("Session is ready");
    expect(ready).toContain("Message execution also requires a Core worker and executor.");
  });

  it("keeps durable Items visible beside refresh and terminal Session failures", () => {
    const refreshFailed = renderToStaticMarkup(
      <SessionsView
        agents={[]}
        sessions={[selectedSession]}
        selected={selectedSession}
        items={durableItems}
        busy={false}
        coreError={null}
        coreState="ready"
        detailError="refresh failed"
        detailState="failed"
        streamError={null}
        streamState="failed"
        {...sessionsCallbacks}
      />,
    );
    const sessionFailed = renderToStaticMarkup(
      <SessionsView
        agents={[]}
        sessions={[]}
        selected={{ ...selectedSession, status: "failed", error: "model execution failed" }}
        items={[]}
        busy={false}
        coreError={null}
        coreState="ready"
        detailError={null}
        detailState="ready"
        streamError={null}
        streamState="failed"
        {...sessionsCallbacks}
      />,
    );

    expect(refreshFailed).toContain("Existing durable item");
    expect(refreshFailed).toContain("refresh failed");
    expect(refreshFailed).toContain("last loaded Items remain visible");
    expect(sessionFailed).toContain("Session failed");
    expect(sessionFailed).toContain("model execution failed");
    expect(sessionFailed).not.toContain("Session is ready");
  });

  it.each([
    ["401", "A valid key is required."],
    ["404", "The Session event stream was not found."],
  ])("keeps an events %s rejection visible with an explicit stream retry", (_status, streamError) => {
    const failed = renderToStaticMarkup(
      <SessionsView
        agents={[]}
        sessions={[selectedSession]}
        selected={selectedSession}
        items={[]}
        busy={false}
        coreError={null}
        coreState="ready"
        detailError={null}
        detailState="ready"
        streamError={streamError}
        streamState="failed"
        {...sessionsCallbacks}
      />,
    );

    expect(failed).toContain("Couldn’t open live events");
    expect(failed).toContain(streamError);
    expect(failed).toContain("Retry");
    expect(failed).not.toContain("Session is ready");
    expect(failed).not.toContain("Opening the event stream");
  });

  it("keeps execution-unavailable message failures visible without claiming a retry", () => {
    const failed = renderToStaticMarkup(
      <SessionsView
        agents={[]}
        sessions={[selectedSession]}
        selected={selectedSession}
        items={[]}
        busy={false}
        coreError={null}
        coreState="ready"
        detailError={null}
        detailState="ready"
        sendError={{
          code: "execution_unavailable",
          message: "Execution is not enabled on this service.",
          draft: "hello again",
        }}
        streamError={null}
        streamState="listening"
        {...sessionsCallbacks}
      />,
    );

    expect(failed).toContain("Execution daemon is unavailable");
    expect(failed).toContain("Execution is not enabled on this service.");
    expect(failed).toContain("Your draft was restored and was not retried.");
    expect(failed).toContain("AGENTS_API_DAEMON_WS_URL");
    expect(failed).toContain("Executor setup");
  });
});
