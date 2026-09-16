import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentSetupView } from "./AgentSetupView";

describe("Agent setup page", () => {
  it("renders a dedicated setup workflow and credential-safe request preview", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        actionError={null}
        baseUrl="/v1"
        busy={false}
        knownModels={["provider/model"]}
        onBack={() => undefined}
        onCreate={async () => undefined}
        onStartSession={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain("New Agent");
    expect(html).toContain("Request preview");
    expect(html).toContain("${AGENTS_CORE_API_KEY}");
    expect(html).toContain("Get started creating an Agent");
    expect(html).toContain("Text format");
    expect(html).toContain("Existing JSON schemas are preserved read-only and block Session start");
    expect(html).toContain("Reasoning effort");
    expect(html).toContain("Text verbosity");
    expect(html).toContain("current cross-engine Session profile");
    expect(html).not.toContain("&quot;reasoning&quot;");
    expect(html.indexOf(">Name<")).toBeLessThan(html.indexOf(">Instructions<"));
    expect(html.indexOf(">Instructions<")).toBeLessThan(html.indexOf(">Model<"));
    expect(html).not.toContain("manual-token");
  });

  it("locks the submitted draft while Core creation is in flight", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        actionError={null}
        baseUrl="/v1"
        busy
        knownModels={["provider/model"]}
        onBack={() => undefined}
        onCreate={async () => undefined}
        onStartSession={() => undefined}
      />,
    );

    expect(html).toContain('<fieldset class="agent-form-fields" disabled=""');
    expect(html).toContain("Saving…");
  });
});
