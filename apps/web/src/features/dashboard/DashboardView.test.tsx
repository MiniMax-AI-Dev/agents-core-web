import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentSession, SavedAgent } from "@agents-core-web/agents-client";

import { DashboardView, type DashboardViewProps } from "./DashboardView";

function agent(overrides: Partial<SavedAgent> = {}): SavedAgent {
  return {
    id: "agent-1",
    object: "agent",
    model: "fixture/model",
    name: "Research Agent",
    instructions: null,
    metadata: {},
    multi_agent: { enabled: false, max_concurrent_subagents: null },
    reasoning: {},
    service_tier: "auto",
    text: { format: { type: "text" }, verbosity: "medium" },
    tools: [],
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    ...overrides,
  };
}

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  const saved = agent();
  return {
    id,
    object: "agent.session",
    agent: {
      id: saved.id,
      model: saved.model,
      name: saved.name,
      instructions: saved.instructions,
      multi_agent: saved.multi_agent,
      reasoning: saved.reasoning,
      service_tier: saved.service_tier,
      text: saved.text,
      tools: saved.tools,
    },
    environment: { type: "none" },
    status: "idle",
    error: null,
    metadata: {},
    required_actions: [],
    vault_ids: [],
    usage: null,
    created_at: 1_700_000_000,
    last_active_at: 1_700_000_000,
    ...overrides,
  };
}

const callbacks = {
  onRefresh: () => undefined,
  onOpenSession: () => undefined,
};

function render(overrides: Partial<DashboardViewProps> = {}): string {
  return renderToStaticMarkup(
    <DashboardView
      agents={[]}
      sessions={[]}
      agentCollectionState="ready"
      agentCollectionError={null}
      agentCollectionHasSnapshot
      sessionCollectionState="ready"
      sessionCollectionError={null}
      sessionCollectionHasSnapshot
      {...callbacks}
      {...overrides}
    />,
  );
}

describe("Dashboard loaded-result presentation", () => {
  it("distinguishes a previously loaded empty result from an unavailable collection", () => {
    const staleEmpty = render({
      agentCollectionState: "failed",
      agentCollectionError: "refresh failed",
      agentCollectionHasSnapshot: true,
    });
    const unavailable = render({
      agentCollectionState: "failed",
      agentCollectionError: "initial load failed",
      agentCollectionHasSnapshot: false,
    });

    expect(staleEmpty).toContain("Refresh failed · last loaded result remains visible");
    expect(staleEmpty).toContain("Loaded Agents");
    expect(staleEmpty).toContain(">0<");
    expect(unavailable).toContain("Unavailable");
    expect(unavailable).not.toContain("Refresh failed · last loaded result remains visible");
  });

  it("renders qualified resource, status, Usage, and Environment facts", () => {
    const selfHosted: AgentSession["environment"] = {
      type: "self_hosted",
      id: "0f745b0d-b545-49cd-8d7e-4c31c80dc564",
      remote_url: "https://executor.example.test",
      workspace_directory: "/workspace",
      capability_directories: [],
    };
    const html = render({
      agents: [agent()],
      sessions: [
        session("action-session", {
          metadata: { title: "Needs a result" },
          status: "requires_action",
          environment: selfHosted,
          usage: {
            input_tokens: 30,
            output_tokens: 12,
            total_tokens: 42,
            input_tokens_details: { cached_tokens: 7 },
            output_tokens_details: { reasoning_tokens: 3 },
          },
          last_active_at: 1_700_000_200,
        }),
        session("idle-session", { metadata: { title: "Waiting" }, last_active_at: 1_700_000_100 }),
      ],
    });

    expect(html).toContain("Dashboard");
    expect(html).toContain("Loaded Core results");
    expect(html).toContain("last successfully traversed Agent and Session page-chain results");
    expect(html).toContain("reached Core&#x27;s end marker within the 100-page safety limit");
    expect(html).toContain("not an atomic snapshot or a current Core total");
    expect(html).toContain("rejected instead of publishing its partial result");
    expect(html).toContain("Loaded Agents");
    expect(html).not.toContain("Session-admissible Agents");
    expect(html).toContain("Count applies only to the last loaded page-chain result, not a current Core total");
    expect(html).toContain("failed or incomplete refreshes keep the previous result");
    expect(html).toContain("Loaded 1 record · reached Core end marker");
    expect(html).toContain("Loaded 2 records · reached Core end marker");
    expect(html).toContain("1 of 2 loaded Sessions report aggregate Usage.");
    expect(html).toContain("42");
    expect(html).toContain("Requires action");
    expect(html).toContain("Self-hosted profile");
    expect(html).toContain("not proof that an executor is connected");
    expect(html).toContain('aria-label="Sessions needing attention"');
    expect(html).toContain('aria-label="Recent Sessions"');
    expect(html).toContain('<button type="button">Needs a result</button>');
    expect(html).toContain("2023-11-14 22:16:40 UTC");
    expect(html).not.toContain("Connected Environment");
    expect(html).not.toContain("Execution ready");
  });

  it("keeps absent Usage unknown instead of presenting a zero", () => {
    const html = render({ sessions: [session("usage-unknown")] });

    expect(html).toContain("Reported aggregate tokens");
    expect(html).toContain("Unknown");
    expect(html).toContain("No loaded Session reports aggregate Usage.");
    expect(html).not.toContain("0 of 1 loaded Sessions report aggregate Usage.");
  });

  it("does not turn a failed empty collection into a zero-sized healthy snapshot", () => {
    const html = render({
      agentCollectionState: "failed",
      agentCollectionError: "agents unavailable",
      agentCollectionHasSnapshot: false,
      sessionCollectionState: "failed",
      sessionCollectionError: "sessions unavailable",
      sessionCollectionHasSnapshot: false,
    });

    expect(html).toContain("agents unavailable");
    expect(html).toContain("sessions unavailable");
    expect(html).toContain("Unavailable");
    expect(html).toContain("Session status is unavailable.");
    expect(html).toContain("Recent Sessions are unavailable.");
    expect(html).not.toContain("Loaded 0 records");
    expect(html).not.toContain('aria-label="Loaded Session status counts"');
  });

  it("retains stale loaded facts while making refresh failures explicit", () => {
    const html = render({
      agents: [agent()],
      sessions: [session("stale-session", { metadata: { title: "Last loaded" } })],
      agentCollectionState: "failed",
      agentCollectionError: "Agent refresh failed",
      sessionCollectionState: "failed",
      sessionCollectionError: "Session refresh failed",
    });

    expect(html.match(/Refresh failed · last loaded result remains visible/g)).toHaveLength(2);
    expect(html).toContain("Agent refresh failed");
    expect(html).toContain("Session refresh failed");
    expect(html).toContain("Last loaded");
    expect(html).toContain("Loaded Agents");
    expect(html).toContain("Loaded Sessions");
  });

  it("keeps an existing snapshot visible during a refresh and disables duplicate refresh", () => {
    const html = render({
      agents: [agent()],
      sessions: [session("refreshing")],
      agentCollectionState: "connecting",
      sessionCollectionState: "connecting",
    });

    expect(html.match(/Refreshing · last loaded result remains visible/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Refresh Dashboard snapshot"');
    expect(html).toContain('type="button" disabled=""');
    expect(html).toContain("Last active");
  });

  it("renders unknown Session and Environment values as unavailable", () => {
    const future = session("future", {
      status: "future" as AgentSession["status"],
      environment: { type: "future_environment" } as AgentSession["environment"],
    });
    const html = render({ sessions: [future] });

    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Future environment");
  });
});
