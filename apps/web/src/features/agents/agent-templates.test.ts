import { describe, expect, it } from "vitest";

import { validateAgentForm } from "./agent-form";
import { AGENT_TEMPLATES, valuesFromAgentTemplate } from "./agent-templates";

describe("Agent starter templates", () => {
  it("uses unique bounded identifiers and names", () => {
    expect(new Set(AGENT_TEMPLATES.map((template) => template.id)).size).toBe(AGENT_TEMPLATES.length);
    for (const template of AGENT_TEMPLATES) {
      expect(template.id).toMatch(/^[a-z0-9-]+$/);
      expect([...template.name]).toHaveLength(template.name.length);
      expect([...template.name].length).toBeLessThanOrEqual(128);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.instructions.length).toBeGreaterThan(0);
    }
  });

  it("produces only the current Session-safe create profile", () => {
    for (const template of AGENT_TEMPLATES) {
      const values = { ...valuesFromAgentTemplate(template), model: "configured/default-model" };
      const result = validateAgentForm(values, "create");

      expect(result.input).toMatchObject({
        name: template.name,
        instructions: template.instructions,
        metadata: {},
        model: "configured/default-model",
        service_tier: "auto",
        text: { format: { type: "text" }, verbosity: "medium" },
      });
      expect(result.input).not.toHaveProperty("reasoning");
      expect(result.input).not.toHaveProperty("tools");
      expect(result.input).not.toHaveProperty("multi_agent");
    }
  });

  it("does not claim that external integrations are already connected", () => {
    const copy = AGENT_TEMPLATES.map((template) => `${template.description}\n${template.instructions}`).join("\n");
    expect(copy).not.toMatch(/already connected|has access to|connected to Slack|connected to GitHub/i);
  });
});
