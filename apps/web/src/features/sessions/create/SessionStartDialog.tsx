import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import {
  AgentCoreError,
  type AgentEnvironmentInput,
  type SavedAgent,
} from "@agents-core-web/agents-client";

import { Modal } from "../../../components/Modal";
import { knownSessionAdmissionBlocker } from "../../agents/session-admission";
import {
  beginSessionCreateAttempt,
  type SessionCreateAttempt,
} from "./session-create-attempt";
import {
  sessionEnvironmentInput,
  type SessionEnvironmentType,
} from "./session-environment";

export interface SessionStartInput {
  agentId: string;
  environment: AgentEnvironmentInput;
  idempotencyKey: string;
}

export interface SessionStartDialogProps {
  agents: SavedAgent[];
  disabled?: boolean;
  open: boolean;
  preselectedAgentId?: string | null;
  selfHostedEnabled: boolean;
  onClose: () => void;
  onSubmit: (input: SessionStartInput) => Promise<void>;
}

export const genericSessionStartError = "Agent Core could not create the Session. Review the Core connection and try again.";

export function safeSessionStartError(error: unknown): string {
  return error instanceof AgentCoreError && error.message.trim()
    ? error.message
    : genericSessionStartError;
}

function firstStartableAgentId(agents: SavedAgent[], preferred?: string | null): string {
  const preferredAgent = preferred ? agents.find((agent) => agent.id === preferred) : undefined;
  if (preferredAgent && !knownSessionAdmissionBlocker(preferredAgent)) return preferredAgent.id;
  return agents.find((agent) => !knownSessionAdmissionBlocker(agent))?.id ?? "";
}

export function SessionStartDialog({
  agents,
  disabled = false,
  open,
  preselectedAgentId,
  selfHostedEnabled,
  onClose,
  onSubmit,
}: SessionStartDialogProps) {
  const formId = useId();
  const environmentName = useId();
  const [agentId, setAgentId] = useState(() => firstStartableAgentId(agents, preselectedAgentId));
  const [environmentType, setEnvironmentType] = useState<SessionEnvironmentType>("none");
  const [workspaceDirectory, setWorkspaceDirectory] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const attemptRef = useRef<SessionCreateAttempt | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setAgentId(firstStartableAgentId(agents, preselectedAgentId));
      setEnvironmentType("none");
      setWorkspaceDirectory("");
      setRequestError(null);
      attemptRef.current = null;
    }
    wasOpenRef.current = open;
  }, [agents, open, preselectedAgentId]);

  useEffect(() => {
    if (!selfHostedEnabled && environmentType === "self_hosted") {
      setEnvironmentType("none");
    }
  }, [environmentType, selfHostedEnabled]);

  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const admissionBlocker = selectedAgent
    ? knownSessionAdmissionBlocker(selectedAgent)
    : "Select a compatible saved Agent.";
  const environment = sessionEnvironmentInput(environmentType, workspaceDirectory);
  const workspaceError = environmentType === "self_hosted" ? environment.error : null;
  const formDisabled = disabled || submitting;
  const canSubmit = open && !formDisabled && Boolean(agentId) && !admissionBlocker && Boolean(environment.input);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || !canSubmit || !environment.input) return;

    submittingRef.current = true;
    setSubmitting(true);
    setRequestError(null);
    const draft = { agentId, environment: environment.input };
    const attempt = beginSessionCreateAttempt(draft, attemptRef.current);
    attemptRef.current = attempt;
    try {
      await onSubmit({ ...draft, idempotencyKey: attempt.idempotencyKey });
      onClose();
    } catch (error) {
      setRequestError(safeSessionStartError(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start an idle Session"
      footer={
        <>
          <button className="button outline" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" type="submit" form={formId} disabled={!canSubmit}>
            {submitting ? "Creating…" : "Create Session"}
          </button>
        </>
      }
    >
      <form id={formId} className="form-stack session-start-form" onSubmit={(event) => void submit(event)} noValidate>
        {requestError ? (
          <div className="session-action-error" role="alert">
            <strong>Session wasn’t created</strong>
            <span>{requestError}</span>
            <small>Retrying this unchanged form reuses the original idempotency key.</small>
          </div>
        ) : null}

        <label className="field">
          <span>Saved Agent</span>
          <select
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            disabled={formDisabled}
            required
          >
            {!agents.some((agent) => !knownSessionAdmissionBlocker(agent)) ? (
              <option value="">No Session-compatible saved Agent</option>
            ) : null}
            {agents.map((agent) => {
              const blocker = knownSessionAdmissionBlocker(agent);
              return (
                <option value={agent.id} key={agent.id} disabled={Boolean(blocker)}>
                  {agent.name || agent.id} · {agent.model}{blocker ? " · Session unavailable" : ""}
                </option>
              );
            })}
          </select>
          <small>Only saved Agents accepted by the known Core Session profile can start here.</small>
        </label>

        {admissionBlocker ? (
          <div className="notice warning" role="note">
            {selectedAgent ? admissionBlocker : "Create or load a compatible saved Agent before starting a Session."}
          </div>
        ) : null}

        <fieldset className="session-environment-options" disabled={formDisabled}>
          <legend>Execution environment</legend>
          <label className="session-environment-option">
            <input
              type="radio"
              name={environmentName}
              value="none"
              checked={environmentType === "none"}
              onChange={() => setEnvironmentType("none")}
            />
            <span><strong>No environment</strong><small>Start a normal idle chat Session without a Workspace executor.</small></span>
          </label>
          {selfHostedEnabled ? (
            <label className="session-environment-option">
              <input
                type="radio"
                name={environmentName}
                value="self_hosted"
                checked={environmentType === "self_hosted"}
                onChange={() => setEnvironmentType("self_hosted")}
              />
              <span><strong>Self-hosted</strong><small>Connect an operator-managed Linux executor and its existing Workspace.</small></span>
            </label>
          ) : null}
        </fieldset>

        {selfHostedEnabled && environmentType === "self_hosted" ? (
          <label className="field">
            <span>Workspace directory</span>
            <input
              value={workspaceDirectory}
              onChange={(event) => setWorkspaceDirectory(event.target.value)}
              placeholder="/workspace"
              aria-describedby={`${formId}-workspace-help${workspaceError ? ` ${formId}-workspace-error` : ""}`}
              aria-invalid={Boolean(workspaceError)}
              disabled={formDisabled}
              required
            />
            <small id={`${formId}-workspace-help`}>Absolute path inside the executor host or container. This Web never receives its Environment key.</small>
            {workspaceError ? (
              <small className="field-error" id={`${formId}-workspace-error`} role="alert">{workspaceError}</small>
            ) : null}
          </label>
        ) : null}

        <div className="notice success" role="note">
          The Session starts idle. Creating it does not send a message, start a Turn, connect an executor, or verify runtime readiness.
        </div>
      </form>
    </Modal>
  );
}
