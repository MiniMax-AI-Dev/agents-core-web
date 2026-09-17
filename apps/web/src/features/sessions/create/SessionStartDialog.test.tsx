import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentCoreError, type SavedAgent } from "@agents-core-web/agents-client";

import {
  genericSessionStartError,
  safeSessionStartError,
  SessionStartDialog,
} from "./SessionStartDialog";

function agent(id: string, name: string, overrides: Partial<SavedAgent> = {}): SavedAgent {
  return {
    id,
    object: "agent",
    model: "provider/model",
    name,
    instructions: null,
    metadata: {},
    multi_agent: { enabled: false, max_concurrent_subagents: null },
    reasoning: {},
    service_tier: "auto",
    text: { format: { type: "text" }, verbosity: "medium" },
    tools: [],
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

const compatible = agent("agent_compatible", "Compatible Agent");
const blocked = agent("agent_blocked", "Blocked Agent", {
  reasoning: { effort: "high" },
});

function render(selfHostedEnabled: boolean, preselectedAgentId?: string) {
  return renderToStaticMarkup(
    <SessionStartDialog
      agents={[compatible, blocked]}
      open
      preselectedAgentId={preselectedAgentId}
      selfHostedEnabled={selfHostedEnabled}
      onClose={() => undefined}
      onSubmit={async () => undefined}
    />,
  );
}

describe("SessionStartDialog", () => {
  it("does not mount dialog content while closed", () => {
    const html = renderToStaticMarkup(
      <SessionStartDialog
        agents={[compatible]}
        open={false}
        selfHostedEnabled
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />,
    );
    expect(html).toBe("");
  });

  it("keeps self-hosted creation hidden by default and selects environment:none", () => {
    const html = render(false);
    expect(html).toContain("Start an idle Session");
    expect(html).toContain("Execution environment");
    expect(html).toContain("No environment");
    expect(html).toMatch(/<input[^>]+checked=""[^>]+value="none"/);
    expect(html).not.toContain("Self-hosted");
    expect(html).not.toContain("Workspace directory");
    expect(html).not.toContain("Environment key</");
  });

  it("offers the operator-gated self-hosted choice without collecting a key", () => {
    const html = render(true);
    expect(html).toContain('value="self_hosted"');
    expect(html).toContain("operator-managed Linux executor");
    expect(html).not.toContain('name="environment_key"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("executor_token");
  });

  it("honors a compatible preselected Agent and disables blocked options", () => {
    const html = render(true, compatible.id);
    expect(html).toContain('<option value="agent_compatible" selected="">Compatible Agent');
    expect(html).toContain('<option value="agent_blocked" disabled="">Blocked Agent');
    expect(html).toContain("Create Session");
  });

  it("falls back from a blocked preselection to the first compatible Agent", () => {
    const html = render(true, blocked.id);
    expect(html).toContain('<option value="agent_compatible" selected="">Compatible Agent');
    expect(html).not.toContain('<option value="agent_blocked" disabled="" selected="">');
  });

  it("shows only Core request errors and hides arbitrary exception content", () => {
    expect(safeSessionStartError(new AgentCoreError("Workspace admission is unavailable.", 503)))
      .toBe("Workspace admission is unavailable.");
    expect(safeSessionStartError(new Error("Authorization: Bearer private-value")))
      .toBe(genericSessionStartError);
    expect(safeSessionStartError({ message: "private-value" })).toBe(genericSessionStartError);
  });
});
