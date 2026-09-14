import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConnectionModal } from "./ConnectionModal";

const callbacks = {
  onClose: () => undefined,
  onSave: () => undefined,
};

describe("Agent Core connection guidance", () => {
  it("explains key generation and the server-side file path contract", () => {
    const markup = renderToStaticMarkup(
      <ConnectionModal
        connection={{ baseUrl: "/v1", token: "" }}
        open
        proxyAuthEnabled={false}
        {...callbacks}
      />,
    );

    expect(markup).toContain("Connect the local proxy key");
    expect(markup).toContain("openssl rand -hex 32");
    expect(markup).toContain("Core does not issue it automatically");
    expect(markup).toContain("tenant, organization, project, and subject");
    expect(markup).toContain("AGENTS_API_KEYS_FILE");
    expect(markup).toContain("AGENTS_API_PROXY_TOKEN_FILE");
    expect(markup).toContain("Agent Core setup");
    expect(markup).toContain("AGENTS_API_DAEMON_WS_URL");
    expect(markup).toContain("same-tenant");
    expect(markup).toContain("Executor setup");
  });

  it("shows when the local proxy already owns the bearer credential", () => {
    const markup = renderToStaticMarkup(
      <ConnectionModal
        connection={{ baseUrl: "/v1", token: "" }}
        open
        proxyAuthEnabled
        {...callbacks}
      />,
    );

    expect(markup).toContain("Server-managed Core key active");
    expect(markup).toContain("Server key active");
    expect(markup).toContain("Using the server-managed Core key");
  });

  it("keeps direct connections separate from the local proxy key file", () => {
    const markup = renderToStaticMarkup(
      <ConnectionModal
        connection={{ baseUrl: "http://127.0.0.1:8091/v1", token: "" }}
        open
        proxyAuthEnabled
        {...callbacks}
      />,
    );

    expect(markup).toContain("Use a current-tab token");
    expect(markup).toContain("CORS-enabled compatible Core");
    expect(markup).toContain("sessionStorage, never localStorage");
    expect(markup).toContain("The proxy token file does not apply to direct URLs");
    expect(markup).not.toContain("AGENTS_API_PROXY_TOKEN_FILE");
  });
});
