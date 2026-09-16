import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreateMenuContent } from "./CreateMenu";

describe("Create menu", () => {
  it("keeps supported actions separate from explicit Core-unavailable resources", () => {
    const html = renderToStaticMarkup(
      <CreateMenuContent
        canCreateAgent
        canStartSession
        onCreateAgent={() => undefined}
        onStartSession={() => undefined}
      />,
    );

    expect(html).toContain('role="menu"');
    expect(html).toContain("Environment template");
    expect(html).toContain("Core exposes no template API");
    expect(html).toContain("operator-owned, never browser-managed");
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(html).not.toContain("executor_token");
  });
});
