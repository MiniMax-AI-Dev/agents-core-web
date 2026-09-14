import { OpenAIAgentsClient, type AgentCore } from "@agents-core-web/agents-client";

export interface CoreConnection {
  baseUrl: string;
  token: string;
}

export type CoreConnectionState = "connecting" | "ready" | "failed";

const BASE_URL_KEY = "agents-core-web.core-base-url";
const TOKEN_KEY = "agents-core-web.core-token";
const devProxyAuthEnabled = import.meta.env.DEV && __AGENTS_CORE_WEB_DEV_PROXY_AUTH__;

export function isLocalProxyBaseUrl(baseUrl: string): boolean {
  return (baseUrl.trim() || "/v1").replace(/\/+$/, "") === "/v1";
}

function usesServerManagedAuth(baseUrl: string, proxyAuthEnabled: boolean): boolean {
  return proxyAuthEnabled && isLocalProxyBaseUrl(baseUrl);
}

export function loadConnection(proxyAuthEnabled = devProxyAuthEnabled): CoreConnection {
  const baseUrl = localStorage.getItem(BASE_URL_KEY) ?? "/v1";
  const serverManaged = usesServerManagedAuth(baseUrl, proxyAuthEnabled);
  if (serverManaged) sessionStorage.removeItem(TOKEN_KEY);
  return {
    baseUrl,
    token: serverManaged ? "" : sessionStorage.getItem(TOKEN_KEY) ?? "",
  };
}

export function saveConnection(connection: CoreConnection, proxyAuthEnabled = devProxyAuthEnabled): void {
  localStorage.setItem(BASE_URL_KEY, connection.baseUrl || "/v1");
  if (connection.token && !usesServerManagedAuth(connection.baseUrl, proxyAuthEnabled)) {
    sessionStorage.setItem(TOKEN_KEY, connection.token);
  } else sessionStorage.removeItem(TOKEN_KEY);
}

export function createCore(connection: CoreConnection, proxyAuthEnabled = devProxyAuthEnabled): AgentCore {
  return new OpenAIAgentsClient({
    baseUrl: connection.baseUrl || "/v1",
    token: usesServerManagedAuth(connection.baseUrl, proxyAuthEnabled)
      ? undefined
      : () => sessionStorage.getItem(TOKEN_KEY) ?? connection.token,
  });
}
