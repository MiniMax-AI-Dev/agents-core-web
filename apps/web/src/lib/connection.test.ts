import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCore,
  InvalidCoreConnectionError,
  isLocalProxyBaseUrl,
  isValidDirectCoreBaseUrl,
  loadConnection,
  saveConnection,
} from "./connection";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
});

afterEach(() => vi.unstubAllGlobals());

describe("Agent Core connection authentication", () => {
  it("recognizes only the same-origin /v1 proxy boundary", () => {
    expect(isLocalProxyBaseUrl("/v1")).toBe(true);
    expect(isLocalProxyBaseUrl(" /v1/ ")).toBe(true);
    expect(isLocalProxyBaseUrl("http://127.0.0.1:8091/v1")).toBe(false);
  });

  it.each([
    "https://core.example/v1",
    "http://localhost:8091/v1",
    "http://worker.localhost:8091/v1",
    "http://127.0.0.42:8091/v1",
    "http://2130706433:8091/v1",
    "http://[::1]:8091/v1",
    "http://[0:0:0:0:0:0:0:1]:8091/v1",
    "https://core.example/v1%3Ftenant%3Dsafe",
    "https://core.example/v1%23section",
    "https://core.example/v1/@scope",
  ])("allows HTTPS or an explicit HTTP loopback direct Core: %s", (baseUrl) => {
    expect(isValidDirectCoreBaseUrl(baseUrl)).toBe(true);
  });

  it.each([
    "http://core.example/v1",
    "http://192.168.1.20:8091/v1",
    "http://localhost.example/v1",
    "http://127.0.0.1.example/v1",
    "http://127.0.0.1%2eexample/v1",
    "http://[::2]:8091/v1",
    "ftp://core.example/v1",
    "https://user:secret@core.example/v1",
    "https://@core.example/v1",
    "https://:@core.example/v1",
    "https:@core.example/v1",
    "https://core.example/v1?",
    "https://core.example/v1#",
    "https://core.example/v1?#",
    "https://core.example/v1?token=secret",
    "https://core.example/v1#secret",
  ])("rejects an unsafe direct Core URL: %s", (baseUrl) => {
    expect(isValidDirectCoreBaseUrl(baseUrl)).toBe(false);
  });

  it.each([true, false])("removes a stale local token with proxy auth enabled=%s", (proxyAuthEnabled) => {
    sessionStorage.setItem("agents-core-web.core-token", "stale-browser-token");

    expect(loadConnection(proxyAuthEnabled)).toEqual({ baseUrl: "/v1", token: "" });
    expect(sessionStorage.getItem("agents-core-web.core-token")).toBeNull();
  });

  it("does not save a browser token for the local proxy when proxy auth is disabled", () => {
    sessionStorage.setItem("agents-core-web.core-token", "historical-browser-token");

    saveConnection({ baseUrl: "/v1", token: "new-browser-token" }, false);

    expect(localStorage.getItem("agents-core-web.core-base-url")).toBe("/v1");
    expect(sessionStorage.getItem("agents-core-web.core-token")).toBeNull();
  });

  it("scrubs a legacy remote HTTP URL and current-tab token", () => {
    localStorage.setItem("agents-core-web.core-base-url", "http://core.example/v1");
    sessionStorage.setItem("agents-core-web.core-token", "legacy-remote-token");

    expect(loadConnection(false)).toEqual({ baseUrl: "/v1", token: "" });
    expect(localStorage.getItem("agents-core-web.core-base-url")).toBe("/v1");
    expect(sessionStorage.getItem("agents-core-web.core-token")).toBeNull();
  });

  it("scrubs an unsafe direct connection instead of persisting its URL or token", () => {
    const unsafe = { baseUrl: "http://core.example/v1", token: "must-not-leave-browser" };

    saveConnection(unsafe, false);

    expect(localStorage.getItem("agents-core-web.core-base-url")).toBe("/v1");
    expect(sessionStorage.getItem("agents-core-web.core-token")).toBeNull();
  });

  it.each([
    "http://core.example/v1",
    "https://core.example/v1?",
    "https://core.example/v1#",
  ])("fails closed before creating a client for an unsafe runtime target: %s", (baseUrl) => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ data: [], has_more: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch);
    const token = "must-not-leave-browser";
    let error: unknown;

    try {
      createCore({ baseUrl, token }, false);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidCoreConnectionError);
    expect(error).toMatchObject({ code: "invalid_core_base_url" });
    expect(String(error)).not.toContain(baseUrl);
    expect(String(error)).not.toContain(token);
    expect(calls).toHaveLength(0);
  });

  it("creates a token-free local client and clears historical storage when proxy auth is disabled", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ data: [], has_more: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch);
    sessionStorage.setItem("agents-core-web.core-token", "historical-browser-token");

    const core = createCore({ baseUrl: "/v1", token: "connection-browser-token" }, false);
    await core.listAgents();

    expect(sessionStorage.getItem("agents-core-web.core-token")).toBeNull();
    expect(String(calls[0]?.input)).toBe("/v1/agents");
    expect(new Headers(calls[0]?.init?.headers).has("Authorization")).toBe(false);
  });

  it("keeps a manual token for a direct Core URL", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ data: [], has_more: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch);
    const connection = { baseUrl: "http://127.0.0.1:8091/v1", token: "manual-token" };
    saveConnection(connection, false);

    expect(loadConnection(false)).toEqual(connection);
    expect(sessionStorage.getItem("agents-core-web.core-token")).toBe("manual-token");
    await createCore(connection, false).listAgents();
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer manual-token");
  });
});
