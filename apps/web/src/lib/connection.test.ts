import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCore, isLocalProxyBaseUrl, loadConnection, saveConnection } from "./connection";

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
