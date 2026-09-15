import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  ExternalLink,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Square,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import type {
  AgentSession,
  EnvironmentConnectionAction,
  FunctionCallAction,
  FunctionResultInput,
  SavedAgent,
  SessionItem,
} from "@agents-core-web/agents-client";

import type { FailedPendingSend } from "../../lib/pending-send";

import { ErrorState } from "../../components/ErrorState";
import { Modal } from "../../components/Modal";
import { MessageMarkdown } from "../../components/MessageMarkdown";
import { Skeleton } from "../../components/Skeleton";
import { StatusIcon, type StatusKind } from "../../components/StatusIcon";
import type { CoreConnectionState } from "../../lib/connection";
import { useThreadScroll } from "../../lib/use-thread-scroll";

export type StreamState = "idle" | "connecting" | "listening" | "recovering" | "failed";
export type SessionDetailState = "idle" | "loading" | "ready" | "failed";

interface SessionsViewProps {
  agents: SavedAgent[];
  sessions: AgentSession[];
  selected: AgentSession | null;
  items: SessionItem[];
  busy: boolean;
  coreError: string | null;
  coreState: CoreConnectionState;
  detailError: string | null;
  detailState: SessionDetailState;
  sendError?: FailedPendingSend | null;
  streamError: string | null;
  streamState: StreamState;
  onCancel: () => Promise<void>;
  onCreateSession: (agentId: string) => Promise<void>;
  onFunctionResult: (input: FunctionResultInput) => Promise<void>;
  onRefresh: () => void;
  onRetrySession: () => void;
  onRetryStream: () => void;
  onSelect: (sessionId: string) => void;
  onSend: (text: string) => Promise<void>;
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

function textOf(item: SessionItem): string {
  return (item.content ?? [])
    .map((content) => content.text)
    .filter((value): value is string => Boolean(value))
    .join("\n");
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

const TRACE_COLLAPSE_MS = 220;

function TraceCollapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), TRACE_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [mounted, open]);

  return (
    <div className={`trace-collapse ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="trace-collapse-clip">
        {mounted ? <div className="trace-collapse-body">{children}</div> : null}
      </div>
    </div>
  );
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

function itemStatusKind(status: SessionItem["status"]): StatusKind {
  if (status === "in_progress") return "running";
  if (status === "failed") return "failed";
  if (status === "incomplete") return "interrupted";
  return "completed";
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1_000);
  if (seconds < 1) return "";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes) return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function firstString(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  for (const entry of Object.values(value)) {
    if (typeof entry === "string" && entry.trim()) return entry.trim();
  }
  return "";
}

function toolPresentation(item: SessionItem) {
  if (item.type === "command_execution") {
    return { Icon: TerminalSquare, verb: "Run", target: item.command || "Command" };
  }
  if (item.type === "web_search_call") {
    const action = item.action;
    const target = action?.query || action?.queries?.join(", ") || action?.url || action?.pattern || "Web search";
    return { Icon: Search, verb: "Search", target };
  }
  if (item.type === "function_call_output") {
    return { Icon: Wrench, verb: "Return", target: item.name || item.call_id || "Function result" };
  }
  if (item.type === "mcp_call") {
    return {
      Icon: Wrench,
      verb: "Use",
      target: [item.server_label, item.name, firstString(item.arguments)].filter(Boolean).join(" ") || "MCP tool",
    };
  }
  return { Icon: Wrench, verb: "Use", target: [item.name, firstString(item.arguments)].filter(Boolean).join(" ") || "Function" };
}

function toolArguments(item: SessionItem): unknown {
  if (item.type === "command_execution") {
    return item.cwd ? { command: item.command, cwd: item.cwd } : { command: item.command };
  }
  if (item.type === "web_search_call") return item.action;
  return item.arguments;
}

function toolResult(item: SessionItem): unknown {
  const result: Record<string, unknown> = {};
  if (item.output !== undefined) result.output = item.output;
  if (item.error !== undefined && item.error !== null) result.error = item.error;
  if (item.exit_code !== undefined && item.exit_code !== null) result.exit_code = item.exit_code;
  if (item.duration_ms !== undefined && item.duration_ms !== null) result.duration_ms = item.duration_ms;
  const entries = Object.entries(result);
  if (!entries.length) return undefined;
  if (entries.length === 1 && entries[0]?.[0] === "output") return entries[0][1];
  return result;
}

function WorkStep({ item }: { item: SessionItem }) {
  const [open, setOpen] = useState(false);
  const { Icon, verb, target } = toolPresentation(item);
  const args = toolArguments(item);
  const result = item.status === "in_progress" ? undefined : toolResult(item);
  const hasArgs = args !== undefined && args !== null;
  const hasResult = result !== undefined && result !== null;
  const expandable = hasArgs || hasResult;

  const row = (
    <>
      <Icon className="trace-step-icon" size={14} strokeWidth={1.5} aria-hidden="true" />
      <span className="trace-step-verb">{verb}</span>
      <span className="trace-step-target" title={target}>{target}</span>
      {item.status !== "completed" ? <StatusIcon status={itemStatusKind(item.status)} title={item.status.replaceAll("_", " ")} /> : null}
      {item.duration_ms ? <span className="trace-duration">{formatDuration(item.duration_ms)}</span> : null}
      {expandable ? <ChevronRight className={`trace-step-chevron ${open ? "open" : ""}`} size={14} strokeWidth={1.5} aria-hidden="true" /> : null}
    </>
  );

  return (
    <li className="trace-step" data-trace-step={item.id}>
      {expandable ? (
        <button className="trace-step-row" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {row}
        </button>
      ) : (
        <div className="trace-step-row">{row}</div>
      )}
      {expandable ? (
        <TraceCollapse open={open}>
          <div className="trace-step-details">
            {hasArgs ? (
              <div>
                <p>Arguments</p>
                <pre>{pretty(args)}</pre>
              </div>
            ) : null}
            {hasResult ? (
              <div>
                <p>Result</p>
                <pre>{pretty(result)}</pre>
              </div>
            ) : null}
          </div>
        </TraceCollapse>
      ) : null}
    </li>
  );
}

function mergeFunctionSteps(items: SessionItem[]): SessionItem[] {
  const merged: SessionItem[] = [];
  const calls = new Map<string, number>();

  for (const item of items) {
    if (item.type === "function_call" && item.call_id) {
      calls.set(item.call_id, merged.length);
      merged.push(item);
      continue;
    }
    if (item.type === "function_call_output" && item.call_id) {
      const callIndex = calls.get(item.call_id);
      const call = callIndex === undefined ? undefined : merged[callIndex];
      if (callIndex !== undefined && call) {
        merged[callIndex] = {
          ...call,
          status: item.status,
          output: item.output,
          error: item.error,
          duration_ms: item.duration_ms ?? call.duration_ms,
        };
        continue;
      }
    }
    merged.push(item);
  }

  return merged;
}

function WorkTrace({ items }: { items: SessionItem[] }) {
  const steps = mergeFunctionSteps(items);
  const status: StatusKind = steps.some((item) => item.status === "failed")
    ? "failed"
    : steps.some((item) => item.status === "in_progress")
      ? "running"
      : steps.some((item) => item.status === "incomplete")
        ? "interrupted"
        : "completed";
  const running = status === "running";
  const [expanded, setExpanded] = useState(running);
  const duration = steps.reduce((total, item) => total + (item.duration_ms ?? 0), 0);
  const current = running ? [...steps].reverse().find((item) => item.status === "in_progress") : undefined;

  useEffect(() => setExpanded(running), [running]);

  return (
    <section className="work-trace" aria-label="Agent work trace" aria-busy={running} data-work-trace={status}>
      <button className="trace-header" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <StatusIcon status={status} />
        <span>{status === "running" ? "Running" : status === "failed" ? "Failed" : status === "interrupted" ? "Interrupted" : "Completed"}</span>
        {duration ? <span className="trace-duration" aria-hidden={running || undefined}>· {formatDuration(duration)}</span> : null}
        <ChevronDown className={`trace-header-chevron ${expanded ? "" : "closed"}`} size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <TraceCollapse open={expanded}>
        <ul className="trace-steps">
          {steps.map((item) => <WorkStep item={item} key={item.id} />)}
        </ul>
      </TraceCollapse>
      {!expanded && current ? (
        <ul className="trace-steps" data-work-trace-tail="">
          <WorkStep item={current} key={`tail:${current.id}`} />
        </ul>
      ) : null}
    </section>
  );
}

function ThreadItems({ items, agentName }: { items: SessionItem[]; agentName: string }) {
  const rendered = [];
  for (let index = 0; index < items.length;) {
    const item = items[index];
    if (!item) break;
    if (item.type === "message") {
      const assistant = item.role === "assistant";
      rendered.push(
        <article className={`message-row ${assistant ? "assistant" : "user"}`} key={item.id}>
          <div className="message-body">
            {assistant ? <div className="message-byline">{agentName || "Agent"}{item.phase === "commentary" ? " · working note" : ""}</div> : null}
            {assistant ? (
              <MessageMarkdown content={textOf(item) || "Empty message item"} />
            ) : (
              <div className="message-copy">{textOf(item) || "Empty message item"}</div>
            )}
          </div>
        </article>,
      );
      index += 1;
      continue;
    }

    const traceItems = [item];
    let cursor = index + 1;
    while (cursor < items.length && items[cursor]?.type !== "message" && items[cursor]?.turn_id === item.turn_id) {
      const next = items[cursor];
      if (next) traceItems.push(next);
      cursor += 1;
    }
    rendered.push(<WorkTrace items={traceItems} key={`trace:${item.turn_id}:${item.id}`} />);
    index = cursor;
  }
  return rendered;
}

function FunctionActionBar({
  actions,
  agentName,
  busy,
  onCancel,
  onSubmit,
}: {
  actions: FunctionCallAction[];
  agentName: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: FunctionResultInput) => Promise<void>;
}) {
  const current = actions[0];
  const [result, setResult] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setResult("");
    inputRef.current?.focus({ preventScroll: true });
  }, [current?.call_id]);

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
        rows={3}
        disabled={busy}
      />
      <div className="approval-actions">
        <button
          className="button outline"
          type="button"
          disabled={busy}
          onClick={() => submit(false)}
        >
          Return error
        </button>
        <button
          className="button primary"
          type="button"
          disabled={busy || !result.trim()}
          onClick={() => submit(true)}
        >
          Submit result
        </button>
        <button className="composer-action" type="button" onClick={onCancel} disabled={busy} aria-label="Cancel active Turn" title="Cancel active Turn">
          <Square size={13} fill="currentColor" strokeWidth={1.5} />
        </button>
      </div>
    </section>
  );
}

function EnvironmentConnectionBar({ action }: { action: EnvironmentConnectionAction }) {
  return (
    <section className="approval-bar" aria-label="Environment connection required">
      <div className="approval-heading">
        <TerminalSquare size={14} strokeWidth={1.5} aria-hidden="true" />
        <span>Environment connection required</span>
      </div>
      <p>
        Environment <code>{action.environment_id}</code> must be connected by the Core operator.
        This Web cannot complete or approve the connection.
      </p>
    </section>
  );
}

export function SessionsView({
  agents,
  sessions,
  selected,
  items,
  busy,
  coreError,
  coreState,
  detailError,
  detailState,
  sendError = null,
  streamError,
  streamState,
  onCancel,
  onCreateSession,
  onFunctionResult,
  onRefresh,
  onRetrySession,
  onRetryStream,
  onSelect,
  onSend,
}: SessionsViewProps) {
  const [message, setMessage] = useState("");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [threadContent, setThreadContent] = useState<HTMLDivElement | null>(null);
  const sendingRef = useRef(false);
  const draftsBySessionRef = useRef(new Map<string, string>());
  const selectedIdRef = useRef(selected?.id ?? null);
  selectedIdRef.current = selected?.id ?? null;
  const { scrollToLatest, showScrollToLatest } = useThreadScroll(
    selected?.id ?? "",
    viewport,
    threadContent,
  );

  useEffect(() => {
    if (!agentId && agents[0]) setAgentId(agents[0].id);
  }, [agentId, agents]);

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
    if (coreState !== "ready" || !agentId) return;
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

  const environmentConnection = selected?.required_actions.find(
    (action): action is EnvironmentConnectionAction => action.type === "environment_connection",
  );

  return (
    <section className="page-section session-page">
      <aside className="session-browser">
        <header className="session-browser-header">
          <h1>Sessions <span>Conversations</span></h1>
          <div className="session-browser-actions">
            <button className="icon-button ghost" type="button" onClick={onRefresh} disabled={coreState === "connecting"} aria-label="Recover durable state">
              <RefreshCw className={coreState === "connecting" ? "refresh-spinning" : undefined} size={14} strokeWidth={1.5} />
            </button>
            <button className="icon-button primary" type="button" onClick={() => setNewSessionOpen(true)} disabled={coreState !== "ready" || !agents.length} aria-label="New Session">
              <Plus size={14} strokeWidth={1.5} />
            </button>
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
            <button
              type="button"
              className={`session-row ${selected?.id === session.id ? "active" : ""}`}
              key={session.id}
              onClick={() => onSelect(session.id)}
            >
              <StatusIcon status={sessionStatusKind(session.status)} title={session.status.replaceAll("_", " ")} />
              <span className="session-row-copy">
                <strong>{sessionTitle(session)}</strong>
                <small>{session.agent.name || session.agent.model}</small>
              </span>
              <span className="session-age">{relativeTime(session.last_active_at)}</span>
            </button>
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
          </header>

          <div className="conversation-thread-frame">
            <div ref={setViewport} className="conversation-scroll">
              <div ref={setThreadContent} className="thread-content">
                <div className="session-origin">
                  <Clock3 size={13} strokeWidth={1.5} />
                  <span>Session</span>
                  <code>{selected.id}</code>
                </div>

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
                    <h3>Session is ready</h3>
                    <p>
                      {streamState === "listening"
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
            {selected.required_actions.length ? (
              environmentConnection ? (
                <EnvironmentConnectionBar action={environmentConnection} />
              ) : (
                <FunctionActionBar
                  actions={selected.required_actions.filter(
                    (action): action is FunctionCallAction => action.type === "function_call",
                  )}
                  agentName={selected.agent.name || "Agent"}
                  busy={busy || detailState !== "ready"}
                  onCancel={cancel}
                  onSubmit={onFunctionResult}
                />
              )
            ) : (
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
                placeholder={selected.status === "failed" ? "This Session has failed" : `Message ${selected.agent.name || "the Agent"}…`}
                aria-label="Message the Agent"
                rows={1}
                disabled={detailState !== "ready" || selected.status === "failed"}
              />
              <div className="composer-bar">
                <span className="composer-context">
                  <span className="initial-tile">{(selected.agent.name?.charAt(0) || "A").toUpperCase()}</span>
                  <span>{selected.agent.name || "Untitled Agent"}</span>
                </span>
                {selected.status === "in_progress" || selected.status === "requires_action" ? (
                  <button className="composer-action" type="button" onClick={cancel} disabled={busy} aria-label="Cancel active Turn" title="Cancel active Turn">
                    <Square size={13} fill="currentColor" strokeWidth={1.5} />
                  </button>
                ) : (
                  <button
                    className="composer-action send"
                    type="submit"
                    aria-label="Send message"
                    title="Send message"
                    disabled={busy || detailState !== "ready" || !message.trim() || selected.status === "failed" || streamState !== "listening"}
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
            <button className="button primary" type="button" onClick={() => void createSession()} disabled={busy || coreState !== "ready" || !agentId}>
              {busy ? "Creating…" : "Create Session"}
            </button>
          </>
        }
      >
        <label className="field">
          <span>Saved Agent</span>
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            {agents.map((agent) => (
              <option value={agent.id} key={agent.id}>{agent.name || agent.id} · {agent.model}</option>
            ))}
          </select>
          <small>The initial slice uses environment: none; runtime placement remains core-owned.</small>
        </label>
        <div className="notice success">
          <StatusIcon status="completed" /> The Session starts idle so the UI can subscribe before the first Turn.
        </div>
      </Modal>
    </section>
  );
}
