import { describe, expect, it } from "vitest";

import {
  buildModelOptionGroups,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_PRESETS,
  modelIdFromOption,
  modelOptionValue,
} from "./model-options";

describe("Agent model suggestions", () => {
  it("provides a useful Parsar Codex starter catalog", () => {
    expect(buildModelOptionGroups([])).toEqual({
      defaultModel: DEFAULT_MODEL_ID,
      configured: [...DEFAULT_MODEL_PRESETS],
      previouslyUsed: [],
    });
  });

  it("normalizes configured presets and keeps a configured default selectable", () => {
    expect(buildModelOptionGroups([], " claude-sonnet-4-5, custom/model,claude-sonnet-4-5 ", "custom/default"))
      .toEqual({
        defaultModel: "custom/default",
        configured: ["custom/default", "claude-sonnet-4-5", "custom/model"],
        previouslyUsed: [],
      });
  });

  it("uses the first configured preset when an operator replaces the list without a default", () => {
    expect(buildModelOptionGroups([], "claude-sonnet-4-5,custom/model")).toEqual({
      defaultModel: "claude-sonnet-4-5",
      configured: ["claude-sonnet-4-5", "custom/model"],
      previouslyUsed: [],
    });
  });

  it("offers models from saved Agents without presenting duplicates as discovered availability", () => {
    expect(buildModelOptionGroups(["gpt-5.6-sol", " tenant/model ", "tenant/model", ""])).toEqual({
      defaultModel: DEFAULT_MODEL_ID,
      configured: [...DEFAULT_MODEL_PRESETS],
      previouslyUsed: ["tenant/model"],
    });
  });

  it("keeps protocol model IDs separate from the custom picker sentinel", () => {
    expect(modelIdFromOption(modelOptionValue("custom"))).toBe("custom");
    expect(modelIdFromOption(modelOptionValue("provider/model name"))).toBe("provider/model name");
    expect(modelIdFromOption("custom")).toBeNull();
  });
});
