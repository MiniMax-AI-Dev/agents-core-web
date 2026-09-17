import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SavedAgent } from "@agents-core-web/agents-client";

import { AgentForm } from "./AgentForm";
import { AgentDeleteConfirmation, AgentDetails, AgentsView } from "./AgentsView";

const agent: SavedAgent = {
  id: "agent_1",
  object: "agent",
  model: "provider/model",
  name: null,
  instructions: null,
  metadata: { team: "web" },
  multi_agent: { enabled: true, max_concurrent_subagents: 2 },
  reasoning: { effort: "high", summary: "concise" },
  service_tier: "priority",
  text: { format: { type: "json_schema", schema: { type: "object" } }, verbosity: "high" },
  tools: [{ type: "tool_search" }],
  created_at: 1_700_000_000,
  updated_at: 1_700_000_100,
};

describe("Agents view", () => {
  it("renders complete saved details and advanced fields as read-only capability information", () => {
    const html = renderToStaticMarkup(<AgentDetails agent={agent} />);

    expect(html).toContain("agent_1");
    expect(html).toContain("Created");
    expect(html).toContain("Updated");
    expect(html).toContain("Metadata");
    expect(html).toContain("Tools");
    expect(html).toContain("Reasoning");
    expect(html).toContain("Text");
    expect(html).toContain("Service tier");
    expect(html).toContain("Multi-agent");
    expect(html).toContain("known Core Session profile cannot start it");
    expect(html).not.toMatch(/<(input|textarea|select)/);
  });

  it("uses the same keyboard-submittable, focus-ready form for existing Agent values", () => {
    const html = renderToStaticMarkup(
      <AgentForm agent={agent} formId="edit-agent" knownModels={[agent.model]} onSubmit={async () => undefined} />,
    );

    expect(html).toContain('<form id="edit-agent"');
    expect(html).toContain('data-agent-initial-focus="true"');
    expect(html).toContain("Web-side suggestions, not a discovered Core catalog");
    expect(html).toContain("Never store secrets in Agent metadata");
    expect(html).toContain("provider/model");
  });

  it("fails closed for a saved-only Agent configuration", () => {
    const html = renderToStaticMarkup(
      <AgentsView
        agents={[agent]}
        busy={false}
        coreError={null}
        coreState="ready"
        onCreate={async () => undefined}
        onRefresh={() => undefined}
        onStartSession={async () => undefined}
      />,
    );

    expect(html).toContain('type="button" aria-label="Open details for this Agent"');
    expect(html).toContain('aria-disabled="true" aria-label="Start a Session with this Agent"');
    expect(html).toContain('<span class="ledger-session-header" role="columnheader">Session</span>');
    expect(html).toContain('<span>Unavailable</span>');
    expect(html).toContain("Session unavailable: Current Core Session admission requires");
  });

  it("keeps Session start available for the known admission profile", () => {
    const compatible = {
      ...agent,
      multi_agent: { enabled: false, max_concurrent_subagents: null },
      reasoning: {},
      service_tier: "auto" as const,
      text: { format: { type: "text" as const }, verbosity: "medium" as const },
      tools: [],
    };
    const html = renderToStaticMarkup(
      <AgentsView
        agents={[compatible]}
        busy={false}
        coreError={null}
        coreState="ready"
        onCreate={async () => undefined}
        onRefresh={() => undefined}
        onStartSession={async () => undefined}
      />,
    );

    expect(html).toContain('type="button" aria-label="Start a Session with this Agent"');
    expect(html).toContain('<span>Start Session</span>');
    expect(html).not.toContain("Session unavailable:");
  });

  it("states the durable delete boundary before confirmation", () => {
    const html = renderToStaticMarkup(<AgentDeleteConfirmation agent={agent} />);

    expect(html).toContain("Delete <strong>Untitled Agent</strong> from Agent Core?");
    expect(html).toContain("only after Core confirms success");
    expect(html).toContain("Existing Sessions keep their durable Agent snapshots");
  });
});
