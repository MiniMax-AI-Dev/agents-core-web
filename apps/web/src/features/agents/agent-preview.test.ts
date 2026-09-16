import { describe, expect, it } from "vitest";

import { buildAgentRequestPreview, previewTokenPlaceholder } from "./agent-preview";
import { valuesFromAgent } from "./agent-form";

describe("Agent request preview", () => {
  it("uses only a documented placeholder and a separate JSON body", () => {
    const preview = buildAgentRequestPreview({
      ...valuesFromAgent(),
      model: "provider/model",
      name: "Builder",
    }, "https://core.example/v1");

    expect(preview.curl).toContain("https://core.example/v1/agents");
    expect(preview.curl).toContain(previewTokenPlaceholder);
    expect(preview.curl).toContain("@agent.json");
    expect(preview.curl).not.toContain("live-caller-secret");
    const body = JSON.parse(preview.json);
    expect(body).toMatchObject({
      model: "provider/model",
      service_tier: "auto",
      text: { format: { type: "text" }, verbosity: "medium" },
    });
    expect(body).not.toHaveProperty("reasoning");
  });

  it("shows an explicitly saved-only value instead of silently deleting it", () => {
    const preview = buildAgentRequestPreview({
      ...valuesFromAgent(),
      model: "provider/model",
      reasoningEffort: "high",
    }, "/v1");

    expect(JSON.parse(preview.json)).toMatchObject({ reasoning: { effort: "high" } });
  });

  it("does not echo unsafe URL credentials or query values", () => {
    const preview = buildAgentRequestPreview(
      valuesFromAgent(),
      "https://user:live-caller-secret@core.example/v1?token=live-caller-secret",
    );

    expect(preview.curl).toContain("${AGENTS_CORE_BASE_URL}/agents");
    expect(preview.curl).not.toContain("live-caller-secret");
    expect(preview.curl).not.toContain("user:");
  });

  it("single-quotes a direct Core URL so copied shell commands cannot expand its path", () => {
    const preview = buildAgentRequestPreview(
      valuesFromAgent(),
      "https://core.example/$(id)/a'b",
    );

    expect(preview.curl.split("\n")[0]).toBe(
      `curl --request POST 'https://core.example/$(id)/a'"'"'b/agents' \\`,
    );
  });
});
