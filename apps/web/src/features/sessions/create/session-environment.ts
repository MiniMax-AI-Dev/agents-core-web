import type { AgentEnvironmentInput } from "@agents-core-web/agents-client";

export type SessionEnvironmentType = AgentEnvironmentInput["type"];

export type SessionEnvironmentValidation =
  | { input: AgentEnvironmentInput; error: null }
  | { input: null; error: string };

const absoluteWorkspaceError = "Workspace directory must be an absolute POSIX path, for example /workspace.";
const safeWorkspaceError = "Workspace directory cannot contain NUL, carriage return, line feed, or backslash characters.";

export function validateWorkspaceDirectory(value: string): string | null {
  if (!value || value.startsWith("~") || !value.startsWith("/")) return absoluteWorkspaceError;
  if (/[\0\r\n\\]/u.test(value)) return safeWorkspaceError;
  return null;
}

export function sessionEnvironmentInput(
  type: unknown,
  workspaceDirectory: string,
): SessionEnvironmentValidation {
  if (type === "none") {
    return { input: { type: "none" }, error: null };
  }

  if (type !== "self_hosted") {
    return { input: null, error: "The selected Environment type is unsupported." };
  }

  const error = validateWorkspaceDirectory(workspaceDirectory);
  if (error) return { input: null, error };

  return {
    input: {
      type: "self_hosted",
      workspace_directory: workspaceDirectory,
      capability_directories: [],
    },
    error: null,
  };
}
