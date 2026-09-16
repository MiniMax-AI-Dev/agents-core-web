import { describe, expect, it } from "vitest";

import { createRequestGate, validateAgentForm, valuesFromAgent } from "./agent-form";

describe("Agent form contract", () => {
  it("uses explicit nulls for blank nullable fields and preserves string metadata", () => {
    const result = validateAgentForm({
      ...valuesFromAgent(),
      model: "  provider/model  ",
      name: "   ",
      instructions: "",
      metadata: '{"team":"web","owner":"sam"}',
    });

    expect(result).toEqual({
      input: {
        model: "provider/model",
        name: null,
        instructions: null,
        metadata: { team: "web", owner: "sam" },
        reasoning: { effort: "medium", summary: "auto" },
        service_tier: "auto",
        text: { format: { type: "text" }, verbosity: "medium" },
      },
    });
  });

  it.each([
    ["not json", "Metadata must be valid JSON."],
    ["[]", "Metadata must be a JSON object."],
    ['{"retries":3}', "Every metadata value must be a string."],
    ['{"enabled":true}', "Every metadata value must be a string."],
  ])("rejects unsafe or unsupported metadata %s", (metadata, message) => {
    expect(validateAgentForm({ ...valuesFromAgent(), model: "model", name: "", instructions: "", metadata })).toEqual({
      metadataError: message,
    });
  });

  it("round-trips existing nullable values into editable fields without inventing data", () => {
    expect(valuesFromAgent({
      id: "agent_1",
      object: "agent",
      model: "model",
      name: null,
      instructions: null,
      metadata: { scope: "test" },
      multi_agent: { enabled: false, max_concurrent_subagents: null },
      reasoning: {},
      service_tier: "auto",
      text: { format: { type: "text" }, verbosity: "medium" },
      tools: [],
      created_at: 1,
      updated_at: 2,
    })).toEqual({
      name: "",
      model: "model",
      instructions: "",
      metadata: '{\n  "scope": "test"\n}',
      reasoningEffort: "",
      reasoningSummary: "",
      serviceTier: "auto",
      textFormat: { type: "text" },
      textVerbosity: "medium",
    });
  });

  it("explicitly clears reasoning defaults during an update instead of preserving stale values", () => {
    const result = validateAgentForm({
      ...valuesFromAgent(),
      model: "provider/model",
      reasoningEffort: "",
      reasoningSummary: "",
    }, "update");

    expect(result.input?.reasoning).toEqual({ effort: null, summary: null });
  });

  it("rejects an older detail response after a newer request or dialog close", () => {
    const gate = createRequestGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);

    gate.invalidate();
    expect(gate.isCurrent(second)).toBe(false);
  });
});
