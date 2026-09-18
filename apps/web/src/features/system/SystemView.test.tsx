import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { safeCoreBaseUrlLabel, SystemView } from "./SystemView";

describe("SystemView", () => {
  it("shows only the four operator-facing status cards", () => {
    const html = renderToStaticMarkup(
      <SystemView
        coreState="ready"
        coreBaseUrl="https://user:pass@core.example/v1?token=secret#fragment"
        selfHostedEnabled
        vaultCollectionState="ready"
        vaultSupported
        refreshing={false}
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain("Connection status");
    expect(html.match(/role="listitem"/g)).toHaveLength(4);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain("Core API");
    expect(html).toContain("https://core.example/v1");
    expect(html).toContain("confirmed by an Agent or Session API request");
    expect(html).toContain("Vaults");
    expect(html).toContain("Vault catalog loaded");
    expect(html).toContain("Self-hosted");
    expect(html).toContain("Enabled");
    expect(html).toContain("Runtime status");
    expect(html).toContain("Cannot be pre-checked");
    expect(html).toContain("Runtime availability is verified when a Session executes");
    expect(html).toContain("Refresh System status");
    expect(html).not.toContain("Source Files");
    expect(html).not.toContain("Public capability surface");
    expect(html).not.toContain("Ownership layers");
    expect(html).not.toContain("Environment profiles");
    expect(html).not.toContain("Core contract");
    expect(html).not.toContain("What this page proves");
    expect(html).not.toContain("user:pass");
    expect(html).not.toContain("token=secret");
    expect(html).not.toContain("fragment");
    expect(html).not.toContain('role="img"');
  });

  it("keeps unsupported and disabled states explicit", () => {
    const html = renderToStaticMarkup(
      <SystemView
        coreState="connecting"
        coreBaseUrl="/v1"
        selfHostedEnabled={false}
        vaultCollectionState="failed"
        vaultSupported={false}
        refreshing
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain("Checking…");
    expect(html).toContain("This Core does not expose the Vaults API");
    expect(html).toContain("Disabled");
    expect(html).toContain("Self-hosted Session creation is disabled in this Web build");
    expect(html).toContain("Refreshing…");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
    expect(html).toContain("/v1");
  });

  it("shows a failed Vault capability check instead of a permanent pending state", () => {
    const html = renderToStaticMarkup(
      <SystemView
        coreState="ready"
        coreBaseUrl="/v1"
        selfHostedEnabled
        vaultCollectionState="failed"
        vaultSupported={null}
        refreshing={false}
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain("Check failed");
    expect(html).toContain("The Vaults API check failed");
    expect(html).not.toContain("Checking…");
  });

  it("distinguishes a failed Vault refresh from an unsupported Core", () => {
    const html = renderToStaticMarkup(
      <SystemView
        coreState="ready"
        coreBaseUrl="/v1"
        selfHostedEnabled
        vaultCollectionState="failed"
        vaultSupported
        refreshing={false}
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain("Refresh failed");
    expect(html).toContain("The latest Vault catalog request failed");
    expect(html).not.toContain("This Core does not expose the Vaults API");
  });

  it("sanitizes Core labels independently from connection storage", () => {
    expect(safeCoreBaseUrlLabel("/v1")).toBe("/v1");
    expect(safeCoreBaseUrlLabel("https://user:pass@core.example/v1?secret=1#token")).toBe("https://core.example/v1");
    expect(safeCoreBaseUrlLabel("not a URL")).toBe("Configured Core");
  });
});
