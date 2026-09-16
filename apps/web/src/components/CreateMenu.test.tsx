import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreateMenuContent } from "./CreateMenu";

describe("Create menu", () => {
  it("shows only actions supported by the current Core contract", () => {
    const html = renderToStaticMarkup(
      <CreateMenuContent
        canCreateAgent
        canStartSession
        onCreateAgent={() => undefined}
        onStartSession={() => undefined}
      />,
    );

    expect(html).toContain('role="menu"');
    expect(html).toContain("Agent");
    expect(html).toContain("Start Session");
    expect(html).not.toContain("Environment template");
    expect(html).not.toContain("Environment key");
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).not.toContain("executor_token");
  });
});
