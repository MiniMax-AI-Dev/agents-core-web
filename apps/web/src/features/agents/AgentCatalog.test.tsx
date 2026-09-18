import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SavedAgent } from "@agents-core-web/agents-client";

import { AgentCatalog, twoRowSavedAgentCapacity } from "./AgentCatalog";

function savedAgent(index: number): SavedAgent {
  return {
    id: `agent_${index}`,
    object: "agent",
    model: "provider/model",
    name: `Agent ${index}`,
    instructions: `Instructions ${index}`,
    metadata: {},
    multi_agent: { enabled: false, max_concurrent_subagents: null },
    reasoning: {},
    service_tier: "auto",
    text: { format: { type: "text" }, verbosity: "medium" },
    tools: [],
    created_at: 1_700_000_000 + index,
    updated_at: 1_700_000_100 + index,
  };
}

function renderCatalog(expanded = false, isFiltering = false): string {
  return renderToStaticMarkup(
    <AgentCatalog
      agents={Array.from({ length: 4 }, (_, index) => savedAgent(index))}
      busy={false}
      coreReady
      expanded={expanded}
      hasSavedAgents
      isFiltering={isFiltering}
      openingAgentId={null}
      vaultCatalog={null}
      onClearSearch={() => undefined}
      onCreate={() => undefined}
      onEdit={() => undefined}
      onExpandedChange={() => undefined}
      onStartSession={() => undefined}
      onUseTemplate={() => undefined}
    />,
  );
}

describe("Agent catalog", () => {
  it("reserves the first card for Create and bounds saved Agents to two responsive rows", () => {
    expect(twoRowSavedAgentCapacity(1)).toBe(1);
    expect(twoRowSavedAgentCapacity(2)).toBe(3);
    expect(twoRowSavedAgentCapacity(3)).toBe(5);
    expect(twoRowSavedAgentCapacity(4)).toBe(7);

    const html = renderCatalog();
    expect(html.indexOf("Create agent")).toBeLessThan(html.indexOf("Edit Agent 0"));
    expect(html).toContain("Edit Agent 0 (agent_0)");
    expect(html).not.toContain("Edit Agent 1 (agent_1)");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Show 3 more");
  });

  it("shows every saved Agent after expansion or while filtering", () => {
    const expanded = renderCatalog(true);
    expect(expanded).toContain("Edit Agent 3 (agent_3)");
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain("Show less");

    const filtered = renderCatalog(false, true);
    expect(filtered).toContain("Edit Agent 3 (agent_3)");
    expect(filtered).not.toContain("Show 3 more");
  });
});
