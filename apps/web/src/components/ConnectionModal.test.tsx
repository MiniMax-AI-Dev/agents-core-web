import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConnectionModal } from "./ConnectionModal";

const callbacks = {
  onClose: () => undefined,
  onSave: () => undefined,
};

describe("Agent Core connection guidance", () => {
  it("links setup guidance to the immutable Parsar compatibility baseline", () => {
    const markup = renderToStaticMarkup(
      <ConnectionModal
        connection={{ baseUrl: "/v1", token: "" }}
        open
        proxyAuthEnabled={false}
        {...callbacks}
      />,
    );
    const baseline = "0438880ab21aa16d05cb91a4c7f91cc0abc12358";

    expect(markup).toContain(
      `href="https://github.com/MiniMax-AI-Dev/parsar/blob/${baseline}/services/agents-api/README.md#standalone-http-service"`,
    );
    expect(markup).toContain(
      `href="https://github.com/MiniMax-AI-Dev/parsar/blob/${baseline}/services/agents-api/README.md#internal-execution-device-connection"`,
    );
    expect(markup).not.toContain("8cc2898ca42b272cb3771234ee6a0ad0d2e932ba");
  });

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
