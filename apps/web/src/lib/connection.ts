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

function usesCurrentTabToken(baseUrl: string): boolean {
  return !isLocalProxyBaseUrl(baseUrl);
}

export function loadConnection(_proxyAuthEnabled = devProxyAuthEnabled): CoreConnection {
  const baseUrl = localStorage.getItem(BASE_URL_KEY) ?? "/v1";
  const currentTabToken = usesCurrentTabToken(baseUrl);
  if (!currentTabToken) sessionStorage.removeItem(TOKEN_KEY);
  return {
    baseUrl,
    token: currentTabToken ? sessionStorage.getItem(TOKEN_KEY) ?? "" : "",
  };
}

export function saveConnection(connection: CoreConnection, _proxyAuthEnabled = devProxyAuthEnabled): void {
  localStorage.setItem(BASE_URL_KEY, connection.baseUrl || "/v1");
  if (connection.token && usesCurrentTabToken(connection.baseUrl)) {
    sessionStorage.setItem(TOKEN_KEY, connection.token);
  } else sessionStorage.removeItem(TOKEN_KEY);
}

export function createCore(connection: CoreConnection, _proxyAuthEnabled = devProxyAuthEnabled): AgentCore {
  const baseUrl = connection.baseUrl || "/v1";
  const currentTabToken = usesCurrentTabToken(baseUrl);
  if (!currentTabToken) sessionStorage.removeItem(TOKEN_KEY);
  return new OpenAIAgentsClient({
    baseUrl,
    token: currentTabToken ? () => sessionStorage.getItem(TOKEN_KEY) ?? connection.token : undefined,
  });
}
