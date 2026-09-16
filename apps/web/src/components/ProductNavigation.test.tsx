import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductNavigation } from "./ProductNavigation";

describe("Product navigation", () => {
  it("exposes only the Core-backed product destinations and current page", () => {
    const html = renderToStaticMarkup(
      <ProductNavigation active="sessions" onSelect={() => undefined} />,
    );

    expect(html).toContain('aria-label="Agents product"');
    expect(html).toContain('class="main-nav product-navigation"');
    expect(html).toContain("Workspace");
    expect(html).toContain("Agents");
    expect(html).toContain("Sessions");
    expect(html).not.toContain("Environments");
    expect(html).toContain('aria-current="page"');
  });
});
