import { Check, Copy, ExternalLink, Folder, HardDrive, TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  AgentEnvironment,
  EnvironmentConnectionAction,
  EnvironmentResourceStatus,
  SessionEnvironmentStatus,
} from "@agents-core-web/agents-client";

import { StatusIcon, type StatusKind } from "../../../components/StatusIcon";
import type { LocalDockerGuideProfile } from "../../../lib/docker-guide-config";
import { buildLauncherCommand, buildLocalDockerCommand } from "./environment-launcher";
import { environmentIdsMatch, type EnvironmentObservation } from "./environment-state";

const parsarBaseline = "2b34ea4630a5a0daf90e745fe1af3edcfa4f0e9e";
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

export type EnvironmentDisplayStatus = SessionEnvironmentStatus | EnvironmentResourceStatus | "required" | "unknown" | "unavailable";

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

export interface EnvironmentPresentation {
  visible: boolean;
  status: EnvironmentDisplayStatus;
  statusKind: StatusKind;
  statusLabel: string;
  triggerLabel: string;
  defaultLauncherGuideOpen: boolean;
}

export function resolveEnvironmentPresentation(
  environment: AgentEnvironment,
  observation: EnvironmentObservation | null,
  connectionActions: EnvironmentConnectionAction[],
): EnvironmentPresentation {
  const raw = environment !== null && typeof environment === "object" && !Array.isArray(environment)
    ? environment as unknown as Record<string, unknown>
    : {};
  const type = typeof raw.type === "string" ? raw.type : null;

  if (type === "none") {
    return {
      visible: false,
      status: "unavailable",
      statusKind: "interrupted",
      statusLabel: "Unavailable",
      triggerLabel: "Environment unavailable",
      defaultLauncherGuideOpen: false,
    };
  }

  const environmentId = field(raw.id);
  const live = type === "self_hosted" ? matchingObservation(observation, environmentId) : null;
  const requiresConnection = type === "self_hosted" && Boolean(environmentId && connectionActions.some(
    (action) => environmentIdsMatch(action.environment_id, environmentId),
  ));
  const status: EnvironmentDisplayStatus = type !== "self_hosted"
    ? "unavailable"
    : live?.source === "unavailable"
      ? "unavailable"
      : live?.status ?? (requiresConnection ? "required" : "unknown");
  const triggerLabel = status === "connected"
    ? "Environment connected"
    : status === "ready"
      ? "Environment ready"
      : status === "required" || status === "disconnected"
        ? "Connect environment"
        : status === "pending"
          ? "Environment pending"
          : status === "failed"
            ? "Environment failed"
            : status === "expired"
              ? "Environment expired"
              : status === "unknown"
                ? "Environment status unknown"
                : "Environment unavailable";

  return {
    visible: true,
    status,
    statusKind: statusKind(status),
    statusLabel: statusLabel(status),
    triggerLabel,
    defaultLauncherGuideOpen: status === "required" || status === "pending" || status === "disconnected" || status === "failed" || status === "expired",
  };
}

function EnvironmentLauncherGuide({
  environmentId,
  remoteUrl,
  workspaceDirectory,
  capabilityDirectories,
  dockerGuideProfile,
  defaultOpen,
}: {
  environmentId: unknown;
  remoteUrl: unknown;
  workspaceDirectory: unknown;
  capabilityDirectories: unknown;
  dockerGuideProfile: LocalDockerGuideProfile | null;
  defaultOpen: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const launcherCommand = buildLauncherCommand(
    environmentId,
    remoteUrl,
    workspaceDirectory,
    capabilityDirectories,
  );
  const dockerCommand = buildLocalDockerCommand(
    environmentId,
    remoteUrl,
    workspaceDirectory,
    capabilityDirectories,
    dockerGuideProfile,
  );
  const [commandType, setCommandType] = useState<"docker" | "native">(
    dockerCommand ? "docker" : "native",
  );
  const [guideOpen, setGuideOpen] = useState(defaultOpen);
  const command = commandType === "docker" && dockerCommand ? dockerCommand : launcherCommand;

  useEffect(() => {
    setCommandType(dockerCommand ? "docker" : "native");
    setCopied(false);
    setGuideOpen(defaultOpen);
  }, [defaultOpen, dockerCommand, launcherCommand]);

  if (!command) {
    return (
      <div className="environment-launcher-unavailable" role="note">
        <strong>Connect Environment unavailable</strong>
        <p>Core did not return the complete supported projection: a canonical Environment ID, safe executor origin, absolute Workspace, and empty capability directories. This Web will not construct a launcher command.</p>
      </div>
    );
  }

  const copyCommand = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details
      className="environment-launcher-guide"
      open={guideOpen}
      onToggle={(event) => setGuideOpen(event.currentTarget.open)}
    >
      <summary>
        <TerminalSquare size={14} strokeWidth={1.5} aria-hidden="true" />
        <span><strong>Connect Environment</strong><small>Copy a command for the executor compute</small></span>
      </summary>
      <div className="environment-launcher-body">
        {dockerCommand ? (
          <div className="environment-launcher-modes" role="group" aria-label="Connection command type">
            <button
              type="button"
              aria-pressed={commandType === "docker"}
              onClick={() => { setCommandType("docker"); setCopied(false); }}
            >Docker</button>
            <button
              type="button"
              aria-pressed={commandType === "native"}
              onClick={() => { setCommandType("native"); setCopied(false); }}
            >Linux / VM</button>
          </div>
        ) : null}
        {commandType === "docker" && dockerCommand ? (
          <p>
            Run this block on the configured local Docker host. It bind-mounts the terminal&apos;s current directory as <code>{String(workspaceDirectory)}</code>; set <code>HOST_WORKSPACE_DIRECTORY</code> first to use another existing host directory.
          </p>
        ) : (
          <p>
            Run this on the Linux machine, Docker container, or VM that owns the Workspace above—not in the browser or the Agent Core daemon container.
          </p>
        )}
        <pre><code>{command}</code></pre>
        <button className="button outline" type="button" onClick={() => void copyCommand()}>
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied ? "Copied" : commandType === "docker" && dockerCommand ? "Copy Docker command" : "Copy native command"}
        </button>
        <p className="environment-launcher-security">
          The operator must provide the mode-0600 credential file at the configured path. Web copies its path but never creates, reads, stores, or transmits the key. Running a command can release already queued input; connected status is transport evidence only, not model or runtime readiness.
        </p>
      </div>
    </details>
  );
}

export function EnvironmentConnectionNotice({
  action,
  onOpenSetup,
}: {
  action: EnvironmentConnectionAction;
  onOpenSetup?: () => void;
}) {
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
      {onOpenSetup ? (
        <button className="button outline environment-connection-notice-action" type="button" onClick={onOpenSetup}>
          Open setup
        </button>
      ) : null}
    </section>
  );
}

export function EnvironmentPanel({
  environment,
  observation,
  connectionActions,
  dockerGuideProfile = __AGENTS_CORE_WEB_DOCKER_GUIDE__,
  defaultLauncherGuideOpen = false,
}: {
  environment: AgentEnvironment;
  observation: EnvironmentObservation | null;
  connectionActions: EnvironmentConnectionAction[];
  dockerGuideProfile?: LocalDockerGuideProfile | null;
  defaultLauncherGuideOpen?: boolean;
}) {
  const raw = environment !== null && typeof environment === "object" && !Array.isArray(environment)
    ? environment as unknown as Record<string, unknown>
    : {};
  const type = typeof raw.type === "string" ? raw.type : null;
  const presentation = resolveEnvironmentPresentation(environment, observation, connectionActions);

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
  const status = presentation.status;

  return (
    <section className="environment-panel" aria-label="Environment and Workspace status">
      <div className="environment-panel-heading">
        <HardDrive size={15} strokeWidth={1.5} aria-hidden="true" />
        <div>
          <strong>Self-hosted Environment</strong>
          <span>{environmentId ?? "ID unavailable"}</span>
        </div>
        <div className={`environment-panel-status environment-panel-status-${status}`} role="status" aria-live="polite">
          <StatusIcon status={presentation.statusKind} />
          <span>{presentation.statusLabel}</span>
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

      {status !== "connected" && status !== "ready" ? (
        <EnvironmentLauncherGuide
          environmentId={environmentId}
          remoteUrl={raw.remote_url}
          workspaceDirectory={raw.workspace_directory}
          capabilityDirectories={raw.capability_directories}
          dockerGuideProfile={dockerGuideProfile}
          defaultOpen={defaultLauncherGuideOpen}
        />
      ) : null}

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
