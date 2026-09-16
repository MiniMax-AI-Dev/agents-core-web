import {
  ArrowDown,
  ArrowUp,
  Bot,
  Clock3,
  Code2,
  Ellipsis,
  ExternalLink,
  MessageSquare,
  Plus,
  RefreshCw,
  Square,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type {
  AgentSession,
  AgentTurn,
  EnvironmentConnectionAction,
  FunctionCallAction,
  FunctionResultInput,
  SavedAgent,
  SessionItem,
} from "@agents-core-web/agents-client";

import type { FailedPendingSend } from "../../lib/pending-send";

import { ErrorState } from "../../components/ErrorState";
import { Modal } from "../../components/Modal";
import { Skeleton } from "../../components/Skeleton";
import { StatusIcon, type StatusKind } from "../../components/StatusIcon";
import type { CoreConnectionState } from "../../lib/connection";
import {
  executionWriteBlocker,
  type ExecutionCompatibility,
} from "../../lib/execution-compatibility";
import { useThreadScroll } from "../../lib/use-thread-scroll";
import { knownSessionAdmissionBlocker } from "../agents/session-admission";
import {
  EnvironmentConnectionNotice,
  EnvironmentPanel,
} from "./environment/EnvironmentPanel";
import type { EnvironmentObservation } from "./environment/environment-state";
import { ThreadItems } from "./items/ItemRenderers";
import { TurnTimeline, type TurnTimelineLoadState } from "./turns/TurnTimeline";
import { SessionActionsDialog } from "./actions/SessionActionsDialog";

export type StreamState = "idle" | "connecting" | "listening" | "recovering" | "failed";
export type SessionDetailState = "idle" | "loading" | "ready" | "failed";

interface SessionsViewProps {
  agents: SavedAgent[];
  sessions: AgentSession[];
  selected: AgentSession | null;
  items: SessionItem[];
  turns?: AgentTurn[];
  busy: boolean;
  coreError: string | null;
  coreState: CoreConnectionState;
  createRequest?: number;
  onCreateRequestConsumed?: (request: number) => void;
  detailError: string | null;
  detailState: SessionDetailState;
  executionCompatibility: ExecutionCompatibility;
  executionConnectionGeneration: number;
  turnError?: string | null;
  turnState?: TurnTimelineLoadState;
  environmentObservation?: EnvironmentObservation | null;
  sendError?: FailedPendingSend | null;
  streamError: string | null;
  streamState: StreamState;
  onCancel: () => Promise<void>;
  onCreateSession: (agentId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<boolean>;
  onFunctionResult: (input: FunctionResultInput) => Promise<void>;
  onRefresh: () => void;
  onRetrySession: () => void;
  onRetryStream: () => void;
  onRetrieveSession: (sessionId: string) => Promise<AgentSession | undefined>;
  onSelect: (sessionId: string) => void;
  onSend: (text: string) => Promise<void>;
  onUpdateSession: (
    sessionId: string,
    baselineMetadata: Record<string, string>,
    draftMetadata: Record<string, string>,
  ) => Promise<AgentSession | undefined>;
}

const executorSetupUrl = "https://github.com/MiniMax-AI-Dev/parsar/blob/main/services/agents-api/README.md#internal-execution-device-connection";

function SessionsListSkeleton() {
  return (
    <div className="sessions-list-loading" aria-busy="true" aria-label="Loading Sessions">
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="session-loading-row" key={index}>
          <Skeleton className="skeleton-status" />
          <div className="session-loading-copy">
            <Skeleton />
            <Skeleton />
          </div>
          <Skeleton className="skeleton-session-age" />
        </div>
      ))}
    </div>
  );
}

function SessionWorkspaceSkeleton() {
  return (
    <div className="session-workspace-loading" aria-busy="true" aria-label="Loading Session workspace">
      <div className="session-workspace-loading-header">
        <Skeleton />
        <Skeleton />
      </div>
      <div className="session-workspace-loading-body">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}

function SessionTimelineSkeleton() {
  return (
    <div className="session-timeline-loading" aria-busy="true" aria-label="Loading Session timeline">
      <Skeleton className="session-timeline-user" />
      <Skeleton className="session-timeline-agent" />
      <Skeleton className="session-timeline-user session-timeline-user-short" />
    </div>
  );
}

function sessionTitle(session: AgentSession): string {
  return session.metadata.title || session.agent.name || "Untitled Session";
}

function relativeTime(seconds: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (delta < 60) return "now";
  if (delta < 3_600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86_400) return `${Math.floor(delta / 3_600)}h`;
  return `${Math.floor(delta / 86_400)}d`;
}

export function restoreDraftAfterFailedSend(currentDraft: string, failedDraft: string): string {
  return currentDraft || failedDraft;
}

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sessionStatusKind(status: AgentSession["status"]): StatusKind {
  if (status === "in_progress" || status === "requires_action") return "running";
  if (status === "failed") return "failed";
  return "completed";
}

function streamStatusKind(state: StreamState): StatusKind {
  if (state === "connecting" || state === "recovering") return "running";
  if (state === "listening") return "completed";
  if (state === "failed") return "failed";
  return "queued";
}

function isEnvironmentConnectionAction(value: unknown): value is EnvironmentConnectionAction {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  return action.type === "environment_connection" && typeof action.environment_id === "string" && Boolean(action.environment_id);
}

function isFunctionCallAction(value: unknown): value is FunctionCallAction {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  return action.type === "function_call" &&
    typeof action.call_id === "string" && Boolean(action.call_id) &&
    typeof action.turn_id === "string" && Boolean(action.turn_id) &&
    typeof action.name === "string" && Boolean(action.name) &&
    Object.hasOwn(action, "arguments");
}

function UnsupportedActionNotice() {
  return (
    <section className="environment-connection-notice" aria-label="Unsupported required action">
      <div className="environment-connection-notice-heading">
        <StatusIcon status="interrupted" />
        <strong>Required action unavailable</strong>
      </div>
      <p>Core returned an unknown or incomplete required action. This Web will not infer a form or continue the Session.</p>
    </section>
  );
}

function ExecutionCompatibilityNotice({ id, blocker }: { id: string; blocker: string }) {
  return (
    <section
      className="environment-connection-notice execution-compatibility-notice"
      id={id}
      role="note"
      aria-label="Execution writes unavailable"
    >
      <div className="environment-connection-notice-heading">
        <StatusIcon status="interrupted" />
        <strong>Session is read-only</strong>
      </div>
      <p>{blocker}</p>
    </section>
  );
}

function CancelActiveTurnButton({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return (
    <button
      className="composer-action"
      type="button"
      onClick={onCancel}
      disabled={busy}
      aria-label="Cancel active Turn"
      title="Cancel active Turn"
    >
      <Square size={13} fill="currentColor" strokeWidth={1.5} />
    </button>
  );
}

function CancelOnlyBar({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return (
    <section className="active-turn-cancel-bar" aria-label="Active Turn controls">
      <p>Turn continuation is unavailable, but cancellation remains available.</p>
      <CancelActiveTurnButton busy={busy} onCancel={onCancel} />
    </section>
  );
}

function FunctionActionBar({
  actions,
  agentName,
  autoFocus,
  busy,
  executionBlocker,
  executionDescriptionId,
  onCancel,
  onSubmit,
}: {
  actions: FunctionCallAction[];
  agentName: string;
  autoFocus: boolean;
  busy: boolean;
  executionBlocker: string | null;
  executionDescriptionId?: string;
  onCancel: () => void;
  onSubmit: (input: FunctionResultInput) => Promise<void>;
}) {
  const current = actions[0];
  const [result, setResult] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setResult("");
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus, current?.call_id]);

  if (!current) return null;

  const submit = (success: boolean) => {
    const input: FunctionResultInput = success
      ? { callId: current.call_id, turnId: current.turn_id, success: true, output: result }
      : { callId: current.call_id, turnId: current.turn_id, success: false, error: result || "Function rejected by the operator." };
    void onSubmit(input).catch(() => undefined);
  };

  return (
    <section className="approval-bar" aria-label="Function result required">
      <div className="approval-heading">
        <Code2 size={14} strokeWidth={1.5} aria-hidden="true" />
        <span title={current.name}>{current.name}</span>
        {actions.length > 1 ? <span className="approval-count">1 / {actions.length}</span> : null}
      </div>
      <p>{agentName || "Agent"} is waiting for this function result.</p>
      <pre className="approval-arguments">{pretty(current.arguments)}</pre>
      <textarea
        ref={inputRef}
        className="approval-input"
        value={result}
        onChange={(event) => setResult(event.target.value)}
        placeholder="Return a result or describe the error…"
        aria-label="Function result or error"
        aria-describedby={executionDescriptionId}
        rows={3}
        disabled={busy || Boolean(executionBlocker)}
      />
      <div className="approval-actions">
        <button
          className="button outline"
          type="button"
          disabled={busy || Boolean(executionBlocker)}
          aria-describedby={executionDescriptionId}
          onClick={() => submit(false)}
        >
          Return error
        </button>
        <button
          className="button primary"
          type="button"
          disabled={busy || Boolean(executionBlocker) || !result.trim()}
          aria-describedby={executionDescriptionId}
          onClick={() => submit(true)}
        >
          Submit result
        </button>
        <CancelActiveTurnButton busy={busy} onCancel={onCancel} />
      </div>
    </section>
  );
}

export function SessionsView({
  agents,
  sessions,
  selected,
  items,
  turns = [],
  busy,
  coreError,
  coreState,
  createRequest = 0,
  onCreateRequestConsumed,
  detailError,
  detailState,
  executionCompatibility,
  executionConnectionGeneration,
  turnError = null,
  turnState = "idle",
  environmentObservation = null,
  sendError = null,
  streamError,
  streamState,
  onCancel,
  onCreateSession,
  onDeleteSession,
  onFunctionResult,
  onRefresh,
  onRetrySession,
  onRetryStream,
  onRetrieveSession,
  onSelect,
  onSend,
  onUpdateSession,
}: SessionsViewProps) {
  const firstStartableAgent = agents.find((agent) => !knownSessionAdmissionBlocker(agent));
  const newSessionUnavailableReason = coreState === "ready" && !firstStartableAgent
    ? agents.length
      ? "No loaded Agent matches the known Core Session-admission profile."
      : "Create or load a saved Agent before starting a Session."
    : null;
  const [message, setMessage] = useState("");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [agentId, setAgentId] = useState(firstStartableAgent?.id ?? "");
  const [actionSession, setActionSession] = useState<AgentSession | null>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [threadContent, setThreadContent] = useState<HTMLDivElement | null>(null);
  const executionNoticeId = useId();
  const sendingRef = useRef(false);
  const pageRef = useRef<HTMLElement>(null);
  const newSessionActionRef = useRef<HTMLButtonElement>(null);
  const lastCreateRequestRef = useRef(0);
  const conversationActionRef = useRef<HTMLButtonElement>(null);
  const restoreFocusAfterDeleteRef = useRef(false);
  const draftsBySessionRef = useRef(new Map<string, string>());
  const selectedIdRef = useRef(selected?.id ?? null);
  selectedIdRef.current = selected?.id ?? null;
  const { scrollToLatest, showScrollToLatest } = useThreadScroll(
    selected?.id ?? "",
    viewport,
    threadContent,
  );

  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const selectedAgentBlocker = selectedAgent ? knownSessionAdmissionBlocker(selectedAgent) : null;
  const executionBlocker = executionWriteBlocker(executionCompatibility, {
    connectionGeneration: executionConnectionGeneration,
    sessionId: selected?.id ?? "",
  });

  useEffect(() => {
    if (selectedAgent && !selectedAgentBlocker) return;
    const next = agents.find((agent) => !knownSessionAdmissionBlocker(agent));
    if ((next?.id ?? "") !== agentId) setAgentId(next?.id ?? "");
  }, [agentId, agents, selectedAgent, selectedAgentBlocker]);

  useEffect(() => {
    if (!createRequest || createRequest === lastCreateRequestRef.current) return;
    lastCreateRequestRef.current = createRequest;
    setNewSessionOpen(true);
    onCreateRequestConsumed?.(createRequest);
  }, [createRequest, onCreateRequestConsumed]);

  useEffect(() => {
    if (actionSession && !sessions.some((session) => session.id === actionSession.id)) {
      setActionSession(null);
    }
  }, [actionSession, sessions]);

  useEffect(() => {
    if (actionSession || !restoreFocusAfterDeleteRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const newSessionAction = newSessionActionRef.current?.disabled ? null : newSessionActionRef.current;
      (conversationActionRef.current ?? newSessionAction ?? pageRef.current)?.focus();
      restoreFocusAfterDeleteRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actionSession, selected?.id, sessions]);

  useEffect(() => {
    const sessionId = selected?.id;
    setMessage(sessionId ? draftsBySessionRef.current.get(sessionId) ?? "" : "");
  }, [selected?.id]);

  useEffect(() => {
    const sessionId = selected?.id;
    if (!sessionId || !sendError?.payload) return;
    const restored = restoreDraftAfterFailedSend(
      draftsBySessionRef.current.get(sessionId) ?? "",
      sendError.payload,
    );
    draftsBySessionRef.current.set(sessionId, restored);
    setMessage((current) => restoreDraftAfterFailedSend(current, sendError.payload));
  }, [selected?.id, sendError]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = message.trim();
    if (sendingRef.current || busy || !value || !selected || detailState !== "ready" || streamState !== "listening") return;
    const sessionId = selected.id;
    sendingRef.current = true;
    draftsBySessionRef.current.set(sessionId, "");
    setMessage("");
    try {
      await onSend(value);
      if (selectedIdRef.current === sessionId) scrollToLatest();
    } catch {
      const restored = restoreDraftAfterFailedSend(
        draftsBySessionRef.current.get(sessionId) ?? "",
        value,
      );
      draftsBySessionRef.current.set(sessionId, restored);
      if (selectedIdRef.current === sessionId) {
        setMessage((current) => {
          const next = restoreDraftAfterFailedSend(current, value);
          draftsBySessionRef.current.set(sessionId, next);
          return next;
        });
      }
    } finally {
      sendingRef.current = false;
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const createSession = async () => {
    if (coreState !== "ready" || !agentId || selectedAgentBlocker) return;
    try {
      await onCreateSession(agentId);
    } catch {
      return;
    }
    setNewSessionOpen(false);
  };

  const cancel = () => {
    void onCancel().catch(() => undefined);
  };

  const requiredActionsValue: unknown = selected?.required_actions;
  const requiredActionsAreValid = Array.isArray(requiredActionsValue);
  const requiredActions: unknown[] = requiredActionsAreValid ? requiredActionsValue : [];
  const environmentConnections = requiredActions.filter(isEnvironmentConnectionAction);
  const functionActions = requiredActions.filter(isFunctionCallAction);
  const unsupportedActionCount = requiredActions.length - environmentConnections.length - functionActions.length + (
    !requiredActionsAreValid || selected?.status === "requires_action" && !requiredActions.length ? 1 : 0
  );
  const showCancelOnly = Boolean(
    (selected?.status === "in_progress" || selected?.status === "requires_action") &&
    (unsupportedActionCount > 0 || environmentConnections.length > 0 && functionActions.length === 0),
  );

  return (
    <section ref={pageRef} className="page-section session-page" tabIndex={-1}>
      <aside className="session-browser">
        <header className="session-browser-header">
          <h1>Sessions <span>Conversations</span></h1>
          <div className="session-browser-actions">
            <button className="icon-button ghost" type="button" onClick={onRefresh} disabled={coreState === "connecting"} aria-label="Recover durable state">
              <RefreshCw className={coreState === "connecting" ? "refresh-spinning" : undefined} size={14} strokeWidth={1.5} />
            </button>
            <span className="action-tooltip">
              <button
                ref={newSessionActionRef}
                className="icon-button primary session-create-trigger"
                type="button"
                onClick={() => {
                  if (!newSessionUnavailableReason) setNewSessionOpen(true);
                }}
                disabled={coreState !== "ready"}
                aria-disabled={newSessionUnavailableReason ? true : undefined}
                aria-describedby={newSessionUnavailableReason ? "new-session-unavailable-reason" : undefined}
                aria-label="New Session"
              >
                <Plus size={14} strokeWidth={1.5} />
              </button>
              {newSessionUnavailableReason ? (
                <span className="action-tooltip-content" role="tooltip" id="new-session-unavailable-reason">
                  {newSessionUnavailableReason}
                </span>
              ) : null}
            </span>
          </div>
        </header>

        <div className="session-list-heading">
          <span>Recent</span>
          <span>{coreState === "ready" || sessions.length ? sessions.length : "—"}</span>
        </div>
        <div className="session-list">
          {coreState === "connecting" && !sessions.length ? <SessionsListSkeleton /> : null}
          {coreState === "failed" && sessions.length ? (
            <ErrorState
              className="session-collection-error"
              title="Couldn’t refresh Sessions"
              description="The last loaded Sessions remain available."
              detail={coreError ?? undefined}
              hint="Check the Agent Core connection, then retry."
              onRetry={onRefresh}
            />
          ) : null}
          {coreState === "ready" || sessions.length ? sessions.map((session) => (
            <div
              className={`session-row ${selected?.id === session.id ? "active" : ""}`}
              key={session.id}
            >
              <button
                type="button"
                className="session-row-select"
                aria-label={`${session.status.replaceAll("_", " ")} ${session.agent.name || session.agent.model} · ${sessionTitle(session)}`}
                onClick={() => onSelect(session.id)}
              >
                <StatusIcon status={sessionStatusKind(session.status)} title={session.status.replaceAll("_", " ")} />
                <span className="session-row-copy">
                  <strong>{sessionTitle(session)}</strong>
                  <small>{session.agent.name || session.agent.model}</small>
                </span>
                <span className="session-age">{relativeTime(session.last_active_at)}</span>
              </button>
              <button
                className="session-row-action icon-button ghost"
                type="button"
                aria-label={`Manage ${sessionTitle(session)}`}
                title="Session details and actions"
                disabled={busy}
                onClick={() => setActionSession(session)}
              >
                <Ellipsis size={14} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
          )) : null}
          {coreState === "ready" && !sessions.length ? (
            <div className="session-list-empty">
              <MessageSquare size={20} strokeWidth={1.5} />
              <span>No Sessions yet</span>
            </div>
          ) : null}
        </div>
      </aside>

      {coreState === "connecting" && !selected ? (
        <SessionWorkspaceSkeleton />
      ) : coreState === "failed" && !selected ? (
        <div className="workspace-error">
          <ErrorState
            title="Couldn’t load Sessions"
            description="The Web could not read Sessions from the connected Agent Core."
            detail={coreError ?? undefined}
            hint="Check the Agent Core connection in the sidebar, then retry."
            onRetry={onRefresh}
          />
        </div>
      ) : selected ? (
        <div className="conversation-panel">
          <header className="conversation-header">
            <div className="conversation-heading-copy">
              <div className="conversation-title-row">
                <h2>{sessionTitle(selected)}</h2>
                <StatusIcon status={sessionStatusKind(selected.status)} />
                <span className="status-label">{selected.status.replaceAll("_", " ")}</span>
              </div>
              <p>{selected.agent.name || "Untitled Agent"} <span>·</span> <code>{selected.agent.model}</code></p>
            </div>
            <div className={`stream-indicator ${streamState}`} title="Live stream state">
              <StatusIcon status={streamStatusKind(streamState)} />
              {streamState}
            </div>
            <button
              ref={conversationActionRef}
              className="icon-button ghost conversation-session-action"
              type="button"
              aria-label={`Manage ${sessionTitle(selected)}`}
              title="Session details and actions"
              disabled={busy}
              onClick={() => setActionSession(selected)}
            >
              <Ellipsis size={14} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </header>

          <div className="conversation-thread-frame">
            <div ref={setViewport} className="conversation-scroll">
              <div ref={setThreadContent} className="thread-content">
                <div className="session-origin">
                  <Clock3 size={13} strokeWidth={1.5} />
                  <span>Session</span>
                  <code>{selected.id}</code>
                </div>

                <EnvironmentPanel
                  environment={selected.environment}
                  observation={environmentObservation}
                  connectionActions={environmentConnections}
                />

                <TurnTimeline
                  turns={turns}
                  items={items}
                  sessionUsage={selected.usage}
                  loadState={turnState}
                  error={turnError}
                />

                <div className="message-stack">
                  <ThreadItems items={items} agentName={selected.agent.name || "Agent"} />
                </div>

                {detailState === "loading" && !items.length ? <SessionTimelineSkeleton /> : null}

                {detailState === "failed" ? (
                  <ErrorState
                    className="session-detail-error"
                    title="Couldn’t load this Session"
                    description="The Web could not read this Session and its durable Items from the connected Agent Core."
                    detail={detailError ?? undefined}
                    hint={items.length ? "The last loaded Items remain visible. Retry to recover the latest durable state." : "Check the Agent Core connection, then retry."}
                    onRetry={onRetrySession}
                  />
                ) : null}

                {streamState === "failed" && streamError ? (
                  <ErrorState
                    className="session-stream-error"
                    title="Couldn’t open live events"
                    description="The Agent Core rejected this Session’s read-only event stream."
                    detail={streamError}
                    hint="Check the Agent Core URL and token, then retry the live stream."
                    onRetry={onRetryStream}
                  />
                ) : null}

                {sendError ? (
                  <ErrorState
                    className="session-send-error"
                    title={sendError.code === "execution_unavailable" ? "Execution daemon is unavailable" : "Message wasn’t sent"}
                    description={sendError.code === "execution_unavailable"
                      ? "Agent Core is online, but this service does not currently have an execution worker. Your draft was restored and was not retried."
                      : sendError.uncertain
                        ? "Core may have accepted this message before the response was lost. Your draft was restored and was not retried."
                        : "Agent Core rejected the message. Your draft was restored and was not retried."}
                    detail={sendError.message}
                    hint={sendError.code === "execution_unavailable"
                      ? "Start Core with AGENTS_API_DAEMON_WS_URL, connect a same-tenant parsar-daemon, then explicitly send the unchanged draft again."
                      : sendError.uncertain
                        ? "Review durable state first. Explicitly send the unchanged draft to reuse its key; editing it creates a new operation."
                        : "Review the error, then send the restored draft as a new operation when the Core is ready."}
                    action={sendError.code === "execution_unavailable" ? (
                      <a className="button outline" href={executorSetupUrl} target="_blank" rel="noreferrer">
                        Executor setup
                        <ExternalLink size={13} strokeWidth={1.5} aria-hidden="true" />
                      </a>
                    ) : undefined}
                  />
                ) : null}

                {selected.status === "failed" ? (
                  <ErrorState
                    className="session-runtime-error"
                    title="Session failed"
                    description="The Agent Core reported a terminal failure for this Session."
                    detail={selected.error ?? undefined}
                  />
                ) : null}

                {detailState === "ready" && streamState !== "failed" && selected.status !== "failed" && !items.length ? (
                  <div className="conversation-empty">
                    <Bot size={24} strokeWidth={1.5} />
                    <h3>{executionBlocker ? "Session is read-only" : "Session is ready"}</h3>
                    <p>
                      {executionBlocker
                        ? "You can inspect durable state and live events, but this Web will not submit execution writes."
                        : streamState === "listening"
                        ? "Live events are connected. Message execution also requires a Core worker and executor."
                        : "Opening the event stream before enabling the composer."}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
            {showScrollToLatest ? (
              <button className="button outline scroll-to-latest" type="button" onClick={scrollToLatest}>
                <ArrowDown size={14} strokeWidth={1.5} aria-hidden="true" />
                Back to latest
              </button>
            ) : null}
          </div>

          <footer className="composer-footer">
            {executionBlocker ? (
              <ExecutionCompatibilityNotice id={executionNoticeId} blocker={executionBlocker} />
            ) : null}
            {environmentConnections.map((action, index) => (
              <EnvironmentConnectionNotice action={action} key={`${action.environment_id}:${index}`} />
            ))}
            {unsupportedActionCount ? <UnsupportedActionNotice /> : null}
            {showCancelOnly ? (
              <CancelOnlyBar busy={busy} onCancel={cancel} />
            ) : null}
            {!unsupportedActionCount && functionActions.length ? (
                <FunctionActionBar
                  actions={functionActions}
                  agentName={selected.agent.name || "Agent"}
                  autoFocus={!environmentConnections.length && !unsupportedActionCount}
                  busy={busy || detailState !== "ready"}
                  executionBlocker={executionBlocker}
                  executionDescriptionId={executionBlocker ? executionNoticeId : undefined}
                  onCancel={cancel}
                  onSubmit={onFunctionResult}
                />
            ) : environmentConnections.length || unsupportedActionCount ? null : (
              <form className="composer" onSubmit={(event) => void send(event)}>
              <textarea
                value={message}
                onChange={(event) => {
                  const next = event.target.value;
                  setMessage(next);
                  draftsBySessionRef.current.set(selected.id, next);
                  const element = event.currentTarget;
                  element.style.height = "auto";
                  element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
                }}
                onKeyDown={onComposerKeyDown}
                placeholder={selected.status === "failed"
                  ? "This Session has failed"
                  : executionBlocker
                    ? "Execution compatibility is not publicly proven"
                    : `Message ${selected.agent.name || "the Agent"}…`}
                aria-label="Message the Agent"
                aria-describedby={executionBlocker ? executionNoticeId : undefined}
                rows={1}
                disabled={Boolean(executionBlocker) || detailState !== "ready" || selected.status === "failed"}
              />
              <div className="composer-bar">
                <span className="composer-context">
                  <span className="initial-tile">{(selected.agent.name?.charAt(0) || "A").toUpperCase()}</span>
                  <span>{selected.agent.name || "Untitled Agent"}</span>
                </span>
                {selected.status === "in_progress" || selected.status === "requires_action" ? (
                  <CancelActiveTurnButton busy={busy} onCancel={cancel} />
                ) : (
                  <button
                    className="composer-action send"
                    type="submit"
                    aria-label="Send message"
                    title="Send message"
                    disabled={Boolean(executionBlocker) || busy || detailState !== "ready" || !message.trim() || selected.status === "failed" || streamState !== "listening"}
                    aria-describedby={executionBlocker ? executionNoticeId : undefined}
                  >
                    <ArrowUp size={16} strokeWidth={2} />
                  </button>
                )}
              </div>
              </form>
            )}
          </footer>
        </div>
      ) : (
        <div className="workspace-empty">
          <MessageSquare size={24} strokeWidth={1.5} />
          <h2>Select or create a Session</h2>
          <p>Sessions keep the durable Agent configuration, Turns, and Items.</p>
        </div>
      )}

      <Modal
        open={newSessionOpen}
        onClose={() => setNewSessionOpen(false)}
        title="Start an idle Session"
        footer={
          <>
            <button className="button outline" type="button" onClick={() => setNewSessionOpen(false)}>Cancel</button>
            <button className="button primary" type="button" onClick={() => void createSession()} disabled={busy || coreState !== "ready" || !agentId || Boolean(selectedAgentBlocker)}>
              {busy ? "Creating…" : "Create Session"}
            </button>
          </>
        }
      >
        <label className="field">
          <span>Saved Agent</span>
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            {!firstStartableAgent ? <option value="">No Session-compatible saved Agent</option> : null}
            {agents.map((agent) => {
              const blocker = knownSessionAdmissionBlocker(agent);
              return (
                <option value={agent.id} key={agent.id} disabled={Boolean(blocker)}>
                  {agent.name || agent.id} · {agent.model}{blocker ? " · Session unavailable" : ""}
                </option>
              );
            })}
          </select>
          <small>The initial slice uses environment: none. Saved-only reasoning, non-auto tiers, JSON schema, multi-agent settings, unsupported tool shapes, and attached MCP credentials cannot start this Web Session flow.</small>
        </label>
        {!firstStartableAgent ? (
          <div className="notice warning" role="note">
            No loaded Agent matches the known Core Session-admission profile. Create an Agent with the Web defaults or update the saved configuration first.
          </div>
        ) : null}
        <div className="notice success">
          <StatusIcon status="completed" /> The Session starts idle so the UI can subscribe before the first Turn.
        </div>
      </Modal>
      <SessionActionsDialog
        busy={busy}
        session={actionSession}
        onClose={() => setActionSession(null)}
        onDelete={onDeleteSession}
        onDeleted={(sessionId) => {
          draftsBySessionRef.current.delete(sessionId);
          if (selectedIdRef.current === sessionId) setMessage("");
          restoreFocusAfterDeleteRef.current = true;
        }}
        onRetrieve={onRetrieveSession}
        onUpdate={onUpdateSession}
      />
    </section>
  );
}
