import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ConnectionModal,
  ConnectionProbeStatus,
  type ConnectionProbeState,
} from "./ConnectionModal";

const callbacks = {
  onClose: () => undefined,
  onSave: () => undefined,
};

function renderModal(baseUrl: string, proxyAuthEnabled: boolean, token = "") {
  return renderToStaticMarkup(
    <ConnectionModal
      connection={{ baseUrl, token }}
      open
      proxyAuthEnabled={proxyAuthEnabled}
      {...callbacks}
    />,
  );
}

describe("Agent Core connection modes", () => {
  it("makes the fixed local Parsar path a zero-input default", () => {
    const markup = renderModal("/v1", true);

    expect(markup).toContain("Local Parsar Core");
    expect(markup).toContain("Default · zero input");
    expect(markup).toMatch(/type="radio"[^>]*checked[^>]*value="local"/);
    expect(markup).toContain("Local `/v1` proxy");
    expect(markup).toContain("No URL is required");
    expect(markup).not.toContain("Compatible Core base URL");
    expect(markup).not.toContain('type="password"');
  });

  it("does not request or expose a browser bearer when proxy auth is active", () => {
    const markup = renderModal("/v1", true, "stale-browser-token");

    expect(markup).toContain("Server-managed key detected");
    expect(markup).toContain("No bearer credential is exposed to browser JavaScript");
    expect(markup).not.toContain("stale-browser-token");
    expect(markup).not.toContain("Bearer token");
    expect(markup).not.toContain("sessionStorage");
  });

  it("keeps local mode token-free when server-managed auth is not detected", () => {
    const markup = renderModal("/v1", false, "stale-browser-token");

    expect(markup).toContain("Server-managed key not detected");
    expect(markup).toContain("Configure the local proxy token file and restart Web");
    expect(markup).toContain("Local mode will not request a browser token");
    expect(markup).not.toContain("stale-browser-token");
    expect(markup).not.toContain('type="password"');
  });

  it("puts direct URLs, CORS guidance, and current-tab tokens behind Advanced", () => {
    const markup = renderModal("http://127.0.0.1:8091/v1", true);

    expect(markup).toMatch(/type="radio"[^>]*checked[^>]*value="advanced"/);
    expect(markup).toContain("Compatible Core base URL");
    expect(markup).toContain("through CORS");
    expect(markup).toContain('type="password"');
    expect(markup).toContain("Current tab only");
    expect(markup).toContain("sessionStorage, never localStorage");
    expect(markup).not.toContain("Server-managed key detected");
  });

  it("rejects credentials and query data embedded in an Advanced URL", () => {
    const markup = renderModal("https://core.example/v1?token=unsafe", true);

    expect(markup).toContain("an HTTP loopback URL, without credentials, query parameters, or fragments");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("rejects remote HTTP while explaining the HTTPS and loopback boundary", () => {
    const markup = renderModal("http://core.example/v1", true, "must-not-leave-browser");

    expect(markup).toContain("Remote Core access requires HTTPS");
    expect(markup).toContain("Plain HTTP is allowed only for an explicit loopback host");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("replaces inline credential tutorials with concise operator links", () => {
    const markup = renderModal("/v1", true);

    expect(markup).toContain("Operator-owned setup");
    expect(markup).toContain("Connection guide");
    expect(markup).toContain("Troubleshooting");
    expect(markup).toContain("Parsar Core setup");
    expect(markup).toContain("98c5b3312ad33e1fae8b94283a011eb3e5f4ee2c");
    expect(markup).toContain("0438880ab21aa16d05cb91a4c7f91cc0abc12358");
    expect(markup).not.toContain("f7cdf591396529880d80f8211fc7a0f4768fdf46");
    expect(markup).not.toContain("8cc2898ca42b272cb3771234ee6a0ad0d2e932ba");
    expect(markup).not.toContain("7409e00ca25311805a9f8f0d03614f820e407642");
    expect(markup).not.toContain("6345391");
    expect(markup).not.toContain("bac551c");
    expect(markup).not.toContain("openssl rand");
    expect(markup).not.toContain("AGENTS_API_KEYS_FILE");
    expect(markup).not.toContain("AGENTS_API_DAEMON_WS_URL");
  });

  it("states the GET-only probe boundary and unknown execution readiness", () => {
    const markup = renderModal("/v1", true);

    expect(markup).toContain("Test connection");
    expect(markup).toContain("with one GET");
    expect(markup).toContain("never creates an Agent, Session, Turn, or Item");
    expect(markup).toContain("Execution compatibility remains Unknown / not publicly proven");
    expect(markup).toContain("Turn-driving writes stay disabled");
    expect(markup).toContain("does not prove a daemon, model, or provider is ready");
  });
});

describe("Connection probe status", () => {
  it("announces the loading state", () => {
    const markup = renderToStaticMarkup(<ConnectionProbeStatus state={{ status: "loading" }} />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Testing Core connection…");
    expect(markup).toContain("one read-only Agents API GET request");
  });

  it.each<[ConnectionProbeState, string]>([
    [
      {
        status: "complete",
        result: { kind: "authenticated", executionReadiness: "unknown", httpStatus: 200 },
      },
      "Core API authenticated",
    ],
    [
      {
        status: "complete",
        result: { kind: "invalid_configuration", executionReadiness: "unknown" },
      },
      "Core URL blocked",
    ],
    [
      {
        status: "complete",
        result: { kind: "unauthorized", executionReadiness: "unknown", httpStatus: 401 },
      },
      "401 invalid_api_key",
    ],
    [
      {
        status: "complete",
        result: { kind: "protocol_mismatch", executionReadiness: "unknown", httpStatus: 400 },
      },
      "Agents API protocol mismatch",
    ],
    [
      {
        status: "complete",
        result: { kind: "unreachable", executionReadiness: "unknown" },
      },
      "Core unreachable",
    ],
    [
      {
        status: "complete",
        result: { kind: "http_error", executionReadiness: "unknown", httpStatus: 503 },
      },
      "Core returned HTTP 503",
    ],
  ])("renders a safe, distinct terminal result", (state, expected) => {
    const markup = renderToStaticMarkup(<ConnectionProbeStatus state={state} />);

    expect(markup).toContain(expected);
    expect(markup).toContain("Execution compatibility: Unknown / not publicly proven");
    expect(markup).toContain("Turn-driving writes remain disabled");
    expect(markup).not.toContain("Execution compatibility: Ready");
  });

  it("uses an alert for failures and a polite status for authenticated access", () => {
    const failed = renderToStaticMarkup(
      <ConnectionProbeStatus
        state={{
          status: "complete",
          result: { kind: "unreachable", executionReadiness: "unknown" },
        }}
      />,
    );
    const succeeded = renderToStaticMarkup(
      <ConnectionProbeStatus
        state={{
          status: "complete",
          result: { kind: "authenticated", executionReadiness: "unknown", httpStatus: 200 },
        }}
      />,
    );

    expect(failed).toContain('role="alert"');
    expect(succeeded).toContain('role="status"');
  });
});
