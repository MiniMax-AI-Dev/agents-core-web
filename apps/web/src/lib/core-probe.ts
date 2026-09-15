export type CoreProbeKind =
  | "authenticated"
  | "unauthorized"
  | "protocol_mismatch"
  | "http_error"
  | "unreachable";

export interface CoreProbeResult {
  kind: CoreProbeKind;
  executionReadiness: "unknown";
  httpStatus?: number;
}

export interface CoreProbeOptions {
  baseUrl: string;
  token?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

interface APIErrorEnvelope {
  error?: {
    code?: unknown;
  };
}

function trimTrailingSlash(value: string): string {
  return (value.trim() || "/v1").replace(/\/+$/, "");
}

export function isValidDirectCoreBaseUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function coreProbeUrl(baseUrl: string): string {
  return `${trimTrailingSlash(baseUrl)}/agents?limit=1`;
}

function isAgentListPage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const page = value as { data?: unknown; has_more?: unknown };
  return Array.isArray(page.data) && typeof page.has_more === "boolean";
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const envelope = (await response.json()) as APIErrorEnvelope;
    return typeof envelope.error?.code === "string" ? envelope.error.code : undefined;
  } catch {
    return undefined;
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

export async function probeCore(options: CoreProbeOptions): Promise<CoreProbeResult> {
  const headers = new Headers({
    Accept: "application/json",
    "OpenAI-Beta": "agents=v1",
  });
  const token = options.token?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  try {
    const response = await (options.fetch ?? globalThis.fetch.bind(globalThis))(coreProbeUrl(options.baseUrl), {
      method: "GET",
      headers,
      signal: options.signal,
      cache: "no-store",
    });

    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return {
          kind: "protocol_mismatch",
          executionReadiness: "unknown",
          httpStatus: response.status,
        };
      }

      return {
        kind: isAgentListPage(payload) ? "authenticated" : "protocol_mismatch",
        executionReadiness: "unknown",
        httpStatus: response.status,
      };
    }

    const errorCode = await readErrorCode(response);
    if (response.status === 401) {
      return { kind: "unauthorized", executionReadiness: "unknown", httpStatus: response.status };
    }
    if (errorCode === "invalid_beta_header" || response.status === 404 || response.status === 405) {
      return { kind: "protocol_mismatch", executionReadiness: "unknown", httpStatus: response.status };
    }
    return { kind: "http_error", executionReadiness: "unknown", httpStatus: response.status };
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error;
    return { kind: "unreachable", executionReadiness: "unknown" };
  }
}
