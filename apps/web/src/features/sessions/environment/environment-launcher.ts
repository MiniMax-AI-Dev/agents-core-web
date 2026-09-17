import type { LocalDockerGuideProfile } from "../../../lib/docker-guide-config";
import { validateWorkspaceDirectory } from "../create/session-environment";

const canonicalEnvironmentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const dockerImagePattern = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/;
const dockerContainerPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const dockerUserPattern = /^[1-9][0-9]*:[1-9][0-9]*$/;
const homePathSegmentPattern = /^[A-Za-z0-9._-]+$/;

interface ConnectionProjection {
  environmentId: string;
  remoteUrl: string;
  remote: URL;
  workspaceDirectory: string;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "[::1]" || normalized === "::1") return true;
  const match = normalized.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return Boolean(match && match.slice(1).every((part) => Number(part) <= 255));
}

function connectionProjection(
  environmentId: unknown,
  remoteValue: unknown,
  workspaceDirectory: unknown,
  capabilityDirectories: unknown,
): ConnectionProjection | null {
  if (
    typeof environmentId !== "string" ||
    !canonicalEnvironmentIdPattern.test(environmentId) ||
    environmentId === "00000000-0000-0000-0000-000000000000" ||
    typeof remoteValue !== "string" ||
    !remoteValue ||
    remoteValue.trim() !== remoteValue ||
    typeof workspaceDirectory !== "string" ||
    validateWorkspaceDirectory(workspaceDirectory) !== null ||
    !Array.isArray(capabilityDirectories) ||
    capabilityDirectories.length !== 0
  ) return null;

  try {
    const remote = new URL(remoteValue);
    const pathnameIsOrigin = remote.pathname === "" || remote.pathname === "/";
    const supportedProtocol = remote.protocol === "https:" || remote.protocol === "http:" && isLoopbackHostname(remote.hostname);
    if (
      !supportedProtocol ||
      !remote.hostname ||
      remote.username ||
      remote.password ||
      remote.search ||
      remote.hash ||
      !pathnameIsOrigin ||
      (remoteValue !== remote.origin && remoteValue !== `${remote.origin}/`)
    ) return null;
    return { environmentId, remoteUrl: remoteValue, remote, workspaceDirectory };
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function validHomeRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.endsWith("/") || value.includes("//")) return false;
  return value.split("/").every((segment) => (
    segment !== "." && segment !== ".." && homePathSegmentPattern.test(segment)
  ));
}

function validDockerProfile(profile: LocalDockerGuideProfile): boolean {
  return dockerImagePattern.test(profile.image) &&
    dockerContainerPattern.test(profile.apiContainer) &&
    dockerUserPattern.test(profile.user) &&
    validHomeRelativePath(profile.credentialsHomePath) &&
    validHomeRelativePath(profile.runtimeHomePath);
}

export function buildLauncherCommand(
  environmentId: unknown,
  remoteValue: unknown,
  workspaceDirectory: unknown,
  capabilityDirectories: unknown,
): string | null {
  const projection = connectionProjection(
    environmentId,
    remoteValue,
    workspaceDirectory,
    capabilityDirectories,
  );
  if (!projection) return null;

  return [
    `REMOTE_URL=${shellQuote(projection.remoteUrl)}`,
    `ENVIRONMENT_ID=${shellQuote(projection.environmentId)}`,
    "agents-api-codex-executor \\",
    "  --remote \"$REMOTE_URL\" \\",
    "  --environment-id \"$ENVIRONMENT_ID\" \\",
    "  --credentials \"$HOME/.parsar/executor-key.json\" \\",
    "  --codex-bin /opt/codex/bin/codex",
  ].join("\n");
}

export function buildLocalDockerCommand(
  environmentId: unknown,
  remoteValue: unknown,
  workspaceDirectory: unknown,
  capabilityDirectories: unknown,
  profile: LocalDockerGuideProfile | null,
): string | null {
  const projection = connectionProjection(
    environmentId,
    remoteValue,
    workspaceDirectory,
    capabilityDirectories,
  );
  if (
    !profile ||
    !projection ||
    !validDockerProfile(profile) ||
    projection.remote.protocol !== "http:" ||
    !isLoopbackHostname(projection.remote.hostname) ||
    projection.workspaceDirectory.includes(":") ||
    projection.workspaceDirectory.includes(",")
  ) return null;

  return [
    `REMOTE_URL=${shellQuote(projection.remoteUrl)}`,
    `ENVIRONMENT_ID=${shellQuote(projection.environmentId)}`,
    `WORKSPACE_DIRECTORY=${shellQuote(projection.workspaceDirectory)}`,
    `EXECUTOR_IMAGE=${shellQuote(profile.image)}`,
    `API_CONTAINER=${shellQuote(profile.apiContainer)}`,
    `EXECUTOR_USER=${shellQuote(profile.user)}`,
    `EXECUTOR_KEY_FILE=\"$HOME/${profile.credentialsHomePath}\"`,
    `EXECUTOR_ROOT=\"$HOME/${profile.runtimeHomePath}/$ENVIRONMENT_ID\"`,
    "STATE_DIRECTORY=\"$EXECUTOR_ROOT/state\"",
    "HOST_WORKSPACE_DIRECTORY=\"${HOST_WORKSPACE_DIRECTORY:-$PWD}\"",
    "test -f \"$EXECUTOR_KEY_FILE\" || { echo \"Executor credential file not found: $EXECUTOR_KEY_FILE\" >&2; exit 1; }",
    "test -d \"$HOST_WORKSPACE_DIRECTORY\" || { echo \"Host Workspace directory not found: $HOST_WORKSPACE_DIRECTORY\" >&2; exit 1; }",
    "mkdir -p \"$STATE_DIRECTORY\"",
    "chmod 700 \"$STATE_DIRECTORY\"",
    "docker run --detach \\",
    "  --name \"agents-core-web-executor-$ENVIRONMENT_ID\" \\",
    "  --platform linux/amd64 \\",
    "  --network \"container:$API_CONTAINER\" \\",
    "  --user \"$EXECUTOR_USER\" \\",
    "  --workdir \"$WORKSPACE_DIRECTORY\" \\",
    "  --cap-drop ALL \\",
    "  --security-opt no-new-privileges \\",
    "  --restart no \\",
    "  --mount \"type=bind,src=$EXECUTOR_KEY_FILE,dst=/run/executor-key.json,readonly\" \\",
    "  --mount \"type=bind,src=$STATE_DIRECTORY,dst=/executor/.parsar\" \\",
    "  --mount \"type=bind,src=$HOST_WORKSPACE_DIRECTORY,dst=$WORKSPACE_DIRECTORY\" \\",
    "  \"$EXECUTOR_IMAGE\" \\",
    "  --remote \"$REMOTE_URL\" \\",
    "  --environment-id \"$ENVIRONMENT_ID\" \\",
    "  --credentials /run/executor-key.json \\",
    "  --codex-bin /opt/codex/bin/codex",
  ].join("\n");
}
