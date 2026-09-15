import { describe, expect, it } from "vitest";

import { coreProbeUrl, isValidDirectCoreBaseUrl, probeCore } from "./core-probe";

interface FetchCall {
  input: RequestInfo | URL;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recordingFetch(response: Response, calls: FetchCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return response;
  }) as typeof fetch;
}

describe("Core connection probe", () => {
  it("uses one read-only Agents API request with the required beta header", async () => {
    const calls: FetchCall[] = [];

    const result = await probeCore({
      baseUrl: "/v1/",
      fetch: recordingFetch(jsonResponse({ data: [], has_more: false }), calls),
    });

    expect(result).toEqual({ kind: "authenticated", executionReadiness: "unknown", httpStatus: 200 });
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe("/v1/agents?limit=1");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(calls[0]?.init?.cache).toBe("no-store");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("OpenAI-Beta")).toBe("agents=v1");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("uses a direct-mode bearer only in the authorization header", async () => {
    const calls: FetchCall[] = [];
    const token = "current-tab-secret";

    const result = await probeCore({
      baseUrl: "https://core.example/v1/",
      token,
      fetch: recordingFetch(jsonResponse({ data: [], has_more: false }), calls),
    });

    expect(result.kind).toBe("authenticated");
    expect(String(calls[0]?.input)).toBe("https://core.example/v1/agents?limit=1");
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("classifies 401 without reflecting an upstream secret-bearing message", async () => {
    const token = "do-not-reflect";
    const result = await probeCore({
      baseUrl: "/v1",
      token,
      fetch: recordingFetch(
        jsonResponse({ error: { code: "invalid_api_key", message: `bad ${token}` } }, 401),
        [],
      ),
    });

    expect(result).toEqual({ kind: "unauthorized", executionReadiness: "unknown", httpStatus: 401 });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it.each([
    [jsonResponse({ error: { code: "invalid_beta_header" } }, 400), 400],
    [jsonResponse({ error: { code: "not_found" } }, 404), 404],
    [jsonResponse({ error: { code: "method_not_allowed" } }, 405), 405],
    [jsonResponse({ ok: true }), 200],
    [new Response("not json", { status: 200 }), 200],
  ])("classifies beta, route, and response-shape mismatches", async (response, status) => {
    const result = await probeCore({ baseUrl: "/v1", fetch: recordingFetch(response, []) });

    expect(result).toEqual({ kind: "protocol_mismatch", executionReadiness: "unknown", httpStatus: status });
  });

  it("separates other HTTP failures from authentication and protocol failures", async () => {
    const result = await probeCore({
      baseUrl: "/v1",
      fetch: recordingFetch(jsonResponse({ error: { code: "unavailable" } }, 503), []),
    });

    expect(result).toEqual({ kind: "http_error", executionReadiness: "unknown", httpStatus: 503 });
  });

  it("classifies a network or CORS rejection without retrying", async () => {
    let calls = 0;
    const result = await probeCore({
      baseUrl: "https://core.example/v1",
      fetch: (async () => {
        calls += 1;
        throw new TypeError("Failed to fetch a private URL");
      }) as typeof fetch,
    });

    expect(result).toEqual({ kind: "unreachable", executionReadiness: "unknown" });
    expect(calls).toBe(1);
  });

  it("passes through aborts so stale probes can be fenced", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      probeCore({
        baseUrl: "/v1",
        signal: controller.signal,
        fetch: (async (_input, init) => {
          expect(init?.signal).toBe(controller.signal);
          throw new DOMException("Aborted", "AbortError");
        }) as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("Core probe URL validation", () => {
  it("normalizes the probe path without putting credentials in the URL", () => {
    expect(coreProbeUrl("https://core.example/v1///")).toBe("https://core.example/v1/agents?limit=1");
  });

  it.each([
    "https://core.example/v1",
    "http://127.0.0.1:8091/v1/",
  ])("accepts an explicit HTTP(S) direct Core URL", (value) => {
    expect(isValidDirectCoreBaseUrl(value)).toBe(true);
  });

  it.each([
    "",
    "/v1",
    "ftp://core.example/v1",
    "https://user:secret@core.example/v1",
    "https://core.example/v1?token=secret",
    "https://core.example/v1#secret",
  ])("rejects an unsafe or non-direct Core URL", (value) => {
    expect(isValidDirectCoreBaseUrl(value)).toBe(false);
  });
});
