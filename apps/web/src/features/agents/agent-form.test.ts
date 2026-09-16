import { describe, expect, it } from "vitest";

import { createRequestGate, validateAgentForm, valuesFromAgent } from "./agent-form";

describe("Agent form contract", () => {
  it("uses the current Session-safe defaults and omits implicit reasoning", () => {
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
        service_tier: "auto",
        text: { format: { type: "text" }, verbosity: "medium" },
      },
    });
    expect(result.input).not.toHaveProperty("reasoning");
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

  it("matches Core's Unicode whitespace rule for required models", () => {
    expect(validateAgentForm({ ...valuesFromAgent(), model: "\u0085" })).toEqual({ modelError: "Enter a model ID." });
  });

  it("matches Core's Unicode name and metadata boundaries", () => {
    const base = { ...valuesFromAgent(), model: "model" };
    const sixteen = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`key-${index}`, "value"]));

    expect(validateAgentForm({ ...base, name: "😀".repeat(128), metadata: JSON.stringify(sixteen) }).input).toBeDefined();
    expect(validateAgentForm({ ...base, name: "😀".repeat(129) })).toEqual({
      nameError: "Name must be at most 128 characters.",
    });
    expect(validateAgentForm({
      ...base,
      metadata: JSON.stringify({ ...sixteen, extra: "value" }),
    })).toEqual({ metadataError: "Agent metadata supports at most 16 pairs." });
    expect(validateAgentForm({
      ...base,
      metadata: JSON.stringify({ ["😀".repeat(64)]: "😀".repeat(512) }),
    }).input).toBeDefined();
    expect(validateAgentForm({
      ...base,
      metadata: JSON.stringify({ ["😀".repeat(65)]: "value" }),
    })).toEqual({ metadataError: "Metadata keys must be at most 64 characters and values at most 512 characters." });
    expect(validateAgentForm({
      ...base,
      metadata: JSON.stringify({ key: "😀".repeat(513) }),
    })).toEqual({ metadataError: "Metadata keys must be at most 64 characters and values at most 512 characters." });
  });

  it.each([
    [{ reasoningEffort: "none" as const }, "Current Core Sessions require both reasoning fields to use Core default."],
    [{ reasoningSummary: "auto" as const }, "Current Core Sessions require both reasoning fields to use Core default."],
    [{ serviceTier: "priority" as const }, "Current Core Sessions support service tier auto only."],
    [{ textFormat: { type: "json_schema" as const, schema: {} } }, "Current Core Sessions support text format only."],
    [{ textVerbosity: "high" as const }, "Low and high verbosity require a discovered compatible Codex model; use medium for this Web flow."],
  ])("fails closed before creating a saved Agent that the Web cannot safely continue", (change, message) => {
    const result = validateAgentForm({ ...valuesFromAgent(), model: "model", ...change });
    expect(result).toEqual({ configurationError: message });
    expect(result.input).toBeUndefined();
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
