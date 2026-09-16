import type { SavedAgent } from "@agents-core-web/agents-client";

// Go strings.TrimSpace uses unicode.IsSpace, whose White_Space set includes U+0085.
export function isCoreWhitespaceOnly(value: string): boolean {
  return /^\p{White_Space}*$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isEmptyObject(value: unknown): boolean {
  return value == null || isRecord(value) && Object.keys(value).length === 0;
}

function isSafeMcpUrl(value: unknown): boolean {
  if (
    typeof value !== "string"
    || /^\p{White_Space}|\p{White_Space}$/u.test(value)
    || /[\u0000-\u0020\u007f\\]/u.test(value)
    || value.includes("?")
    || value.includes("#")
    || /%(?![0-9A-Fa-f]{2})/u.test(value)
  ) return false;
  const schemeSeparator = value.indexOf("://");
  const authority = schemeSeparator >= 0 ? value.slice(schemeSeparator + 3).split("/", 1)[0] : "";
  // Go's net/url rejects escaped ASCII and raw braces/backticks in a host,
  // while WHATWG URL may decode or preserve them and silently accept it.
  if (!authority || authority.includes("@") || authority.includes("%") || /[{}\x60]/u.test(authority)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isCanonicalExecutionFunction(tool: Record<string, unknown>): boolean {
  return hasOnlyKeys(tool, ["type", "name", "description", "parameters", "defer_loading"])
    && typeof tool.name === "string"
    && typeof tool.description === "string"
    && isRecord(tool.parameters)
    && (tool.defer_loading === undefined || typeof tool.defer_loading === "boolean");
}

function isCanonicalExecutionMcp(tool: Record<string, unknown>): boolean {
  const transport = tool.transport;
  const allowedTools = tool.allowed_tools;
  return hasOnlyKeys(tool, [
    "type", "server_label", "transport", "allowed_tools", "connection_origin",
    "credential_id", "request_metadata", "required",
  ])
    && typeof tool.server_label === "string"
    && !isCoreWhitespaceOnly(tool.server_label)
    && isRecord(transport)
    && hasOnlyKeys(transport, ["type", "server_url", "headers"])
    && transport.type === "http"
    && isSafeMcpUrl(transport.server_url)
    && isEmptyObject(transport.headers)
    && tool.connection_origin === "service"
    && (tool.credential_id == null || typeof tool.credential_id === "string")
    && isEmptyObject(tool.request_metadata)
    && (tool.required === undefined || typeof tool.required === "boolean")
    && (allowedTools == null || Array.isArray(allowedTools) && allowedTools.every((name) => typeof name === "string" && name.length > 0));
}

/**
 * Deterministic Saved Agent blockers enforced by Parsar before Session persistence.
 * A null result is not execution-readiness proof: model, provider, host, tools, and
 * non-default verbosity can still require runtime validation.
 */
export function knownSessionAdmissionBlockers(agent: SavedAgent): string[] {
  const blockers: string[] = [];
  if (isCoreWhitespaceOnly(agent.model)) blockers.push("a non-empty model is required");
  if (agent.multi_agent.enabled || agent.multi_agent.max_concurrent_subagents !== null) {
    blockers.push("multi-agent execution is not supported");
  }
  if (agent.reasoning.effort != null || agent.reasoning.summary != null) {
    blockers.push("explicit reasoning options are saved-only");
  }
  if (agent.service_tier !== "auto") blockers.push("service tier must be auto");
  if (agent.text.format.type !== "text") blockers.push("text format must be text");

  const functionNames = new Set<string>();
  const mcpLabels = new Set<string>();
  let functionCount = 0;
  for (const rawTool of agent.tools) {
    if (!rawTool || typeof rawTool !== "object" || Array.isArray(rawTool)) {
      blockers.push("the saved tool configuration is not executable");
      continue;
    }
    const tool = rawTool as Record<string, unknown>;
    switch (tool.type) {
      case "function": {
        functionCount += 1;
        if (!isCanonicalExecutionFunction(tool)) blockers.push("the saved function tool is incomplete or malformed");
        if (tool.defer_loading === true) blockers.push("deferred functions are saved-only");
        if (typeof tool.name === "string") {
          if (isCoreWhitespaceOnly(tool.name) || new TextEncoder().encode(tool.name).length > 512) {
            blockers.push("function names must be non-empty and at most 512 bytes");
          }
          if (functionNames.has(tool.name)) blockers.push("function names must be unique");
          functionNames.add(tool.name);
        }
        break;
      }
      case "mcp":
        if (!isCanonicalExecutionMcp(tool)) blockers.push("the saved MCP tool is incomplete or malformed");
        if (tool.credential_id != null) blockers.push("attached MCP credentials are unavailable in this Web Session flow");
        if (typeof tool.server_label === "string") {
          if (mcpLabels.has(tool.server_label)) blockers.push("MCP server labels must be unique");
          mcpLabels.add(tool.server_label);
        }
        break;
      case "tool_search":
      case "programmatic_tool_calling":
        blockers.push(`${String(tool.type)} is saved-only`);
        break;
      default:
        blockers.push("the saved tool type is not executable");
    }
  }
  if (functionCount > 64) blockers.push("at most 64 function tools can execute");
  return [...new Set(blockers)];
}

export function knownSessionAdmissionBlocker(agent: SavedAgent): string | null {
  const blockers = knownSessionAdmissionBlockers(agent);
  return blockers.length ? `Current Core Session admission requires ${blockers.join(", ")}.` : null;
}
