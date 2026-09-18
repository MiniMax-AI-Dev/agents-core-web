import { Check, Copy, ExternalLink, Folder, HardDrive, TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  AgentCore,
  AgentEnvironment,
  EnvironmentConnectionAction,
  EnvironmentResourceStatus,
  SessionEnvironmentStatus,
} from "@agents-core-web/agents-client";

import { StatusIcon, type StatusKind } from "../../../components/StatusIcon";
import type { LocalDockerGuideProfile } from "../../../lib/docker-guide-config";
import {
  buildLauncherCommand,
  buildLocalDockerCommand,
  isSupportedSelfHostedEnvironmentProjection,
} from "./environment-launcher";
import { EnvironmentFilesPanel, type ListEnvironmentFiles } from "./EnvironmentFilesPanel";
import { EnvironmentFileCreatePanel } from "./EnvironmentFileCreatePanel";
import {
  environmentIdsMatch,
  isSupportedOpenAIHostedEnvironmentProjection,
  isWritableBasicHostedEnvironmentResource,
  type EnvironmentObservation,
} from "./environment-state";

const parsarBaseline = "dadf64a76bde58255281f3b6c3e939f8b556be09";
const coreSetupUrl = `https://github.com/MiniMax-AI-Dev/parsar/blob/${parsarBaseline}/services/agents-api/README.md#native-executor-transport-prerequisite`;
const launcherSetupUrl = `https://github.com/MiniMax-AI-Dev/parsar/blob/${parsarBaseline}/packages/codex-executor/README.md#connect-an-executor`;
const hostedSetupUrl = `https://github.com/MiniMax-AI-Dev/parsar/blob/${parsarBaseline}/services/agents-api/HOSTED-RELEASE.md`;

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
  environmentType: "self_hosted" | "openai_hosted",
): EnvironmentObservation | null {
  return observation?.environmentType === environmentType && environmentIdsMatch(observation.environmentId, environmentId)
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
  const supportedType = type === "self_hosted" || type === "openai_hosted" ? type : null;
  const live = supportedType ? matchingObservation(observation, environmentId, supportedType) : null;
  const requiresConnection = type === "self_hosted" && Boolean(environmentId && connectionActions.some(
    (action) => environmentIdsMatch(action.environment_id, environmentId),
  ));
  const status: EnvironmentDisplayStatus = !supportedType
    ? "unavailable"
    : live?.source === "unavailable"
      ? "unavailable"
      : live?.status ?? (requiresConnection ? "required" : "unknown");
  const prefix = type === "openai_hosted" ? "Managed Environment" : "Environment";
  const triggerLabel = status === "connected"
    ? `${prefix} connected`
    : status === "ready"
      ? `${prefix} ready`
      : status === "required" || status === "disconnected"
        ? type === "openai_hosted" ? `${prefix} disconnected` : "Connect environment"
        : status === "pending"
          ? `${prefix} pending`
          : status === "failed"
            ? `${prefix} failed`
            : status === "expired"
              ? `${prefix} expired`
              : status === "unknown"
                ? `${prefix} status unknown`
                : `${prefix} unavailable`;

  return {
    visible: true,
    status,
    statusKind: statusKind(status),
    statusLabel: statusLabel(status),
    triggerLabel,
    defaultLauncherGuideOpen: type === "self_hosted" && (status === "required" || status === "pending" || status === "disconnected" || status === "failed" || status === "expired"),
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
  environmentFilesEnabled = __AGENTS_CORE_WEB_ENVIRONMENT_FILES__,
  onListFiles,
  onCreateFile,
}: {
  environment: AgentEnvironment;
  observation: EnvironmentObservation | null;
  connectionActions: EnvironmentConnectionAction[];
  dockerGuideProfile?: LocalDockerGuideProfile | null;
  defaultLauncherGuideOpen?: boolean;
  environmentFilesEnabled?: boolean;
  onListFiles?: ListEnvironmentFiles;
  onCreateFile?: AgentCore["createEnvironmentFile"];
}) {
  const raw = environment !== null && typeof environment === "object" && !Array.isArray(environment)
    ? environment as unknown as Record<string, unknown>
    : {};
  const type = typeof raw.type === "string" ? raw.type : null;
  const presentation = resolveEnvironmentPresentation(environment, observation, connectionActions);

  if (type === "none") {
    return null;
  }

  if (type === "openai_hosted") {
    const supportedHostedProjection = isSupportedOpenAIHostedEnvironmentProjection(environment);
    const environmentId = field(raw.id);
    const network = raw.network !== null && typeof raw.network === "object" && !Array.isArray(raw.network)
      ? raw.network as Record<string, unknown>
      : null;
    const packages = raw.packages !== null && typeof raw.packages === "object" && !Array.isArray(raw.packages)
      ? raw.packages as Record<string, unknown>
      : null;
    const capabilityDirectories = directories(raw.capability_directories);
    const npmPackages = directories(packages?.npm);
    const pythonPackages = directories(packages?.python);
    const systemPackages = directories(packages?.system);
    const installedFiles = Array.isArray(raw.files) ? raw.files : null;
    const installedPlugins = Array.isArray(raw.plugins) ? raw.plugins : null;
    const installedSkills = Array.isArray(raw.skills) ? raw.skills : null;
    const live = matchingObservation(observation, environmentId, "openai_hosted");
    const durableResource = live?.source === "durable"
      ? live.resource
      : live?.source === "live"
        ? live.durableResource
        : undefined;
    const status = presentation.status;
    const exactDurableHosted = status !== "failed" && status !== "expired" &&
      isWritableBasicHostedEnvironmentResource(durableResource, environmentId);
    const networkAccess = network?.access === "enabled"
      ? "Enabled"
      : network?.access === "disabled"
        ? "Disabled"
        : "Unavailable";

    return (
      <section className="environment-panel environment-panel-managed" aria-label="Environment and Workspace status">
        <div className="environment-panel-heading">
          <HardDrive size={15} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <strong>Managed hosted Environment</strong>
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
            <span>Network access</span>
            <strong>{networkAccess}</strong>
          </div>
          <div className="environment-panel-field environment-panel-field-wide">
            <span>Workspace directory</span>
            <code><Folder size={12} strokeWidth={1.5} aria-hidden="true" />/workspace</code>
          </div>
          <div className="environment-panel-field environment-panel-field-wide">
            <span>Allowed network domains</span>
            <strong>{Array.isArray(network?.allowed_domains) && network.allowed_domains.length === 0 ? "None configured by the basic profile" : "Unavailable"}</strong>
          </div>
          <div className="environment-panel-field environment-panel-field-wide">
            <span>Startup packages</span>
            {npmPackages && pythonPackages && systemPackages ? (
              <strong>{npmPackages.length + pythonPackages.length + systemPackages.length === 0
                ? "None installed by the basic profile"
                : `${npmPackages.length} npm · ${pythonPackages.length} Python · ${systemPackages.length} system`}</strong>
            ) : <strong>Unavailable</strong>}
          </div>
          <div className="environment-panel-field environment-panel-field-wide">
            <span>Installed metadata</span>
            {capabilityDirectories && installedFiles && installedPlugins && installedSkills ? (
              <strong>{capabilityDirectories.length} capability directories · {installedFiles.length} files · {installedPlugins.length} plugins · {installedSkills.length} skills</strong>
            ) : <strong>Unavailable</strong>}
          </div>
        </div>

        <p className="environment-panel-provenance">
          {live?.source === "live"
            ? "Status is the last supported managed Environment event. Connected transport does not prove native Runtime, model, provider, Function, or tool readiness."
            : live?.source === "durable"
              ? "Status comes from the exact durable managed Environment resource. It describes connection lifecycle, not native execution readiness."
              : live?.source === "unavailable"
                ? "Durable managed Environment status is unavailable. No previous readiness claim is retained."
                : "Managed provisioning is owned by Core. Status is unknown until the durable Environment resource or a supported event is read."}
        </p>

        {environmentFilesEnabled && supportedHostedProjection && environmentId && onListFiles ? (
          <EnvironmentFilesPanel
            key={`${environmentId}:/workspace`}
            environmentId={environmentId}
            workspaceDirectory="/workspace"
            onListFiles={onListFiles}
          />
        ) : null}

        {environmentFilesEnabled && supportedHostedProjection && exactDurableHosted && environmentId && onCreateFile ? (
          <EnvironmentFileCreatePanel
            key={`create:${environmentId}`}
            environmentId={environmentId}
            workspaceDirectory="/workspace"
            onCreateFile={onCreateFile}
          />
        ) : null}

        {status === "failed" || status === "expired" ? (
          <div className="environment-panel-error" role="alert">
            <strong>Managed Environment {status}</strong>
            <p>Core reported a terminal managed Environment state. Web does not recreate, retry, or substitute a Runtime.</p>
          </div>
        ) : null}

        <footer className="environment-panel-footer">
          <p>Core provisions this basic managed Runtime automatically. There is no executor launcher or caller connection action.</p>
          <nav aria-label="Managed Environment setup documentation">
            <a href={hostedSetupUrl} target="_blank" rel="noreferrer">Operator setup<ExternalLink size={11} aria-hidden="true" /></a>
          </nav>
        </footer>
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
  const live = matchingObservation(observation, environmentId, "self_hosted");
  const requiresConnection = Boolean(environmentId && connectionActions.some(
    (action) => environmentIdsMatch(action.environment_id, environmentId),
  ));
  const supportedProjection = isSupportedSelfHostedEnvironmentProjection(
    raw.id,
    raw.remote_url,
    raw.workspace_directory,
    raw.capability_directories,
  );
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

      {environmentFilesEnabled && supportedProjection && environmentId && workspaceDirectory && onListFiles ? (
        <EnvironmentFilesPanel
          key={`${environmentId}:${workspaceDirectory}`}
          environmentId={environmentId}
          workspaceDirectory={workspaceDirectory}
          onListFiles={onListFiles}
        />
      ) : null}

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
