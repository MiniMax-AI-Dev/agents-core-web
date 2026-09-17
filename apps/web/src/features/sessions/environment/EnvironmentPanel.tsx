import { ExternalLink, Folder, HardDrive, TerminalSquare } from "lucide-react";

import type {
  AgentEnvironment,
  EnvironmentConnectionAction,
  EnvironmentResourceStatus,
  SessionEnvironmentStatus,
} from "@agents-core-web/agents-client";

import { StatusIcon, type StatusKind } from "../../../components/StatusIcon";
import { environmentIdsMatch, type EnvironmentObservation } from "./environment-state";

const parsarBaseline = "d91ba48ac6c49cfdf6f08d7687b9be76ba6d53ee";
const coreSetupUrl = `https://github.com/MiniMax-AI-Dev/parsar/blob/${parsarBaseline}/services/agents-api/README.md#native-executor-transport-prerequisite`;
const launcherSetupUrl = `https://github.com/MiniMax-AI-Dev/parsar/blob/${parsarBaseline}/packages/codex-executor/README.md#connect-an-executor`;

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

type EnvironmentDisplayStatus = SessionEnvironmentStatus | EnvironmentResourceStatus | "required" | "unknown" | "unavailable";

function statusKind(status: EnvironmentDisplayStatus): StatusKind {
  if (status === "connected" || status === "ready") return "completed";
  if (status === "failed") return "failed";
  if (status === "pending" || status === "required") return "running";
  return "interrupted";
}

function statusLabel(status: EnvironmentDisplayStatus): string {
  if (status === "required") return "Connection required";
  if (status === "unknown") return "Unknown";
  if (status === "unavailable") return "Unavailable";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function matchingObservation(
  observation: EnvironmentObservation | null,
  environmentId: string | null,
): EnvironmentObservation | null {
  return observation?.environmentType === "self_hosted" && environmentIdsMatch(observation.environmentId, environmentId)
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
    return null;
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
  const requiresConnection = Boolean(environmentId && connectionActions.some(
    (action) => environmentIdsMatch(action.environment_id, environmentId),
  ));
  const status: EnvironmentDisplayStatus = live?.source === "unavailable"
    ? "unavailable"
    : live?.status ?? (requiresConnection ? "required" : "unknown");

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
        {live?.source === "live"
          ? "Connection is the last supported live event observed after the durable Environment snapshot. It does not prove executor, runtime, model, or provider readiness."
          : live?.source === "durable"
            ? live.resource.files.length === 0 && live.resource.plugins.length === 0 && live.resource.skills.length === 0
              ? "Status comes from the durable Environment resource. Core reports no API-managed files, plugins, or skills; this is not host or Workspace inventory and does not prove executor, runtime, model, or provider readiness."
              : "Status comes from the durable Environment resource. API-managed installation metadata is present but is not rendered as host or Workspace inventory and does not prove executor, runtime, model, or provider readiness."
            : live?.source === "unavailable"
              ? "Durable Environment status is unavailable. The conversation remains usable, and no previous live readiness claim is retained."
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

      {status === "expired" ? (
        <div className="environment-panel-error environment-panel-expired" role="status">
          <strong>Environment expired</strong>
          <p>The durable Environment resource expired. Reconnect or provision it through the Core operator; this Web does not retry or recreate it.</p>
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
