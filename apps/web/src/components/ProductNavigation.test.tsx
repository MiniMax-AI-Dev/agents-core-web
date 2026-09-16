import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductNavigation } from "./ProductNavigation";

describe("Product navigation", () => {
  it("exposes the three product destinations and current page", () => {
    const html = renderToStaticMarkup(
      <ProductNavigation active="environments" onSelect={() => undefined} />,
    );

    expect(html).toContain('aria-label="Agents product"');
    expect(html).toContain("Agents");
    expect(html).toContain("Environments");
    expect(html).toContain("Sessions");
    expect(html).toContain('aria-current="page"');
  });
});
