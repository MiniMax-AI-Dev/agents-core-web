import { beforeEach, describe, expect, it, vi } from "vitest";

import { isLocalProxyBaseUrl, loadConnection, saveConnection } from "./connection";

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

describe("Agent Core connection authentication", () => {
  it("recognizes only the same-origin /v1 proxy boundary", () => {
    expect(isLocalProxyBaseUrl("/v1")).toBe(true);
    expect(isLocalProxyBaseUrl(" /v1/ ")).toBe(true);
    expect(isLocalProxyBaseUrl("http://127.0.0.1:8091/v1")).toBe(false);
  });

  it("removes a stale browser token when the local proxy owns authentication", () => {
    sessionStorage.setItem("agents-core-web.core-token", "stale-browser-token");

    expect(loadConnection(true)).toEqual({ baseUrl: "/v1", token: "" });
    expect(sessionStorage.getItem("agents-core-web.core-token")).toBeNull();
  });

  it("keeps a manual token for a direct Core URL", () => {
    const connection = { baseUrl: "http://127.0.0.1:8091/v1", token: "manual-token" };
    saveConnection(connection, true);

    expect(loadConnection(true)).toEqual(connection);
    expect(sessionStorage.getItem("agents-core-web.core-token")).toBe("manual-token");
  });
});
