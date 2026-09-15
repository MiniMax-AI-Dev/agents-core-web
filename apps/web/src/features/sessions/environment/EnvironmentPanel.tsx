import { ExternalLink, Folder, HardDrive, Server, TerminalSquare } from "lucide-react";

import type {
  AgentEnvironment,
  EnvironmentConnectionAction,
  EnvironmentStatus,
} from "@agents-core-web/agents-client";

import { StatusIcon, type StatusKind } from "../../../components/StatusIcon";
import type { EnvironmentObservation } from "./environment-state";

const coreSetupUrl = "https://github.com/MiniMax-AI-Dev/parsar/blob/8cc2898ca42b272cb3771234ee6a0ad0d2e932ba/services/agents-api/README.md#native-executor-transport-prerequisite";
const launcherSetupUrl = "https://github.com/MiniMax-AI-Dev/parsar/blob/8cc2898ca42b272cb3771234ee6a0ad0d2e932ba/packages/codex-executor/README.md#connect-an-executor";

export interface SafeRemoteUrl {
  href: string;
  label: string;
}

export function sanitizeRemoteUrl(value: unknown): SafeRemoteUrl | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const sanitized = url.toString();
    return { href: sanitized, label: sanitized };
  } catch {
    return null;
  }
}

function field(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function directories(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : null;
}

function statusKind(status: EnvironmentStatus | "required" | "unknown"): StatusKind {
  if (status === "connected" || status === "ready") return "completed";
  if (status === "failed") return "failed";
  if (status === "pending" || status === "required") return "running";
  return "interrupted";
}

function statusLabel(status: EnvironmentStatus | "required" | "unknown"): string {
  if (status === "required") return "Connection required";
  if (status === "unknown") return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function matchingObservation(
  observation: EnvironmentObservation | null,
  environmentId: string | null,
): EnvironmentObservation | null {
  return observation?.environmentType === "self_hosted" && observation.environmentId === environmentId
    ? observation
    : null;
}

export function EnvironmentConnectionNotice({ action }: { action: EnvironmentConnectionAction }) {
  return (
    <section className="environment-connection-notice" aria-label="Environment connection required">
      <div className="environment-connection-notice-heading">
        <TerminalSquare size={14} strokeWidth={1.5} aria-hidden="true" />
        <strong>Environment connection required</strong>
      </div>
      <p>
        Environment <code>{action.environment_id}</code> must be connected by the Core operator.
        This Web cannot connect, complete, or approve it.
      </p>
    </section>
  );
}

export function EnvironmentPanel({
  environment,
  observation,
  connectionActions,
}: {
  environment: AgentEnvironment;
  observation: EnvironmentObservation | null;
  connectionActions: EnvironmentConnectionAction[];
}) {
  const raw = environment !== null && typeof environment === "object" && !Array.isArray(environment)
    ? environment as unknown as Record<string, unknown>
    : {};
  const type = typeof raw.type === "string" ? raw.type : null;

  if (type === "none") {
    return (
      <section className="environment-panel environment-panel-none" aria-label="Environment and Workspace status">
        <div className="environment-panel-heading">
          <Server size={15} strokeWidth={1.5} aria-hidden="true" />
          <div><strong>Core-owned</strong><span>No Workspace</span></div>
        </div>
        <p>Core owns runtime placement. This Session has no Environment execution directory.</p>
      </section>
    );
  }

  if (type !== "self_hosted") {
    return (
      <section className="environment-panel environment-panel-unavailable" aria-label="Environment and Workspace status">
        <div className="environment-panel-heading">
          <StatusIcon status="interrupted" />
          <div><strong>Environment unavailable</strong><span>Unknown type</span></div>
        </div>
        <p>Core returned an unsupported Environment type. Workspace details and actions are unavailable.</p>
      </section>
    );
  }

  const environmentId = field(raw.id);
  const workspaceDirectory = field(raw.workspace_directory);
  const capabilityDirectories = directories(raw.capability_directories);
  const remoteUrl = sanitizeRemoteUrl(raw.remote_url);
  const live = matchingObservation(observation, environmentId);
  const requiresConnection = Boolean(environmentId && connectionActions.some((action) => action.environment_id === environmentId));
  const status: EnvironmentStatus | "required" | "unknown" = live?.status ?? (requiresConnection ? "required" : "unknown");

  return (
    <section className="environment-panel" aria-label="Environment and Workspace status">
      <div className="environment-panel-heading">
        <HardDrive size={15} strokeWidth={1.5} aria-hidden="true" />
        <div>
          <strong>Self-hosted Environment</strong>
          <span>{environmentId ?? "ID unavailable"}</span>
        </div>
        <div className={`environment-panel-status environment-panel-status-${status}`} role="status" aria-live="polite">
          <StatusIcon status={statusKind(status)} />
          <span>{statusLabel(status)}</span>
        </div>
      </div>

      <div className="environment-panel-grid">
        <div className="environment-panel-field">
          <span>Environment ID</span>
          <code>{environmentId ?? "Unavailable"}</code>
        </div>
        <div className="environment-panel-field">
          <span>Remote URL</span>
          {remoteUrl ? <code>{remoteUrl.label}</code> : <strong>Unavailable — unsafe or malformed URL</strong>}
        </div>
        <div className="environment-panel-field environment-panel-field-wide">
          <span>Workspace directory</span>
          <code><Folder size={12} strokeWidth={1.5} aria-hidden="true" />{workspaceDirectory ?? "Unavailable"}</code>
        </div>
        <div className="environment-panel-field environment-panel-field-wide">
          <span>Capability directories</span>
          {capabilityDirectories === null ? <strong>Unavailable</strong> : capabilityDirectories.length ? (
            <ul>{capabilityDirectories.map((directory, index) => <li key={`${index}:${directory}`}><code>{directory}</code></li>)}</ul>
          ) : <strong>None exposed</strong>}
        </div>
      </div>

      <p className="environment-panel-provenance">
        {live
          ? "Connection is the last supported live event observed; durable Session reads confirm identity and Workspace details but do not expose connection status."
          : requiresConnection
            ? "Core durably requires an operator connection. No executor availability is inferred."
            : "Connection status is unknown because the durable Session projection does not expose it."}
      </p>

      {status === "failed" ? (
        <div className="environment-panel-error" role="alert">
          <strong>Environment failed</strong>
          <p>Core reported an Environment failure. Raw error fields are hidden because they may contain credentials, Vault IDs, paths, or private URLs.</p>
        </div>
      ) : null}

      <footer className="environment-panel-footer">
        <p>Workspace is this Environment’s execution directory, not a top-level workspaces API. Paths and the executor URL are shown as text only.</p>
        <nav aria-label="Self-hosted Environment setup documentation">
          <a href={coreSetupUrl} target="_blank" rel="noreferrer">Core setup<ExternalLink size={11} aria-hidden="true" /></a>
          <a href={launcherSetupUrl} target="_blank" rel="noreferrer">Launcher setup<ExternalLink size={11} aria-hidden="true" /></a>
        </nav>
      </footer>
    </section>
  );
}
