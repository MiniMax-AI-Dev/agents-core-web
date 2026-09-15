import {
  Bot,
  Layers3,
  MessageSquare,
  Settings2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentCoreError } from "@agents-core-web/agents-client";
import type {
  AgentCore,
  AgentSession,
  CreateAgentInput,
  FunctionResultInput,
  SavedAgent,
  SessionEvent,
  SessionItem,
  UpdateAgentInput,
} from "@agents-core-web/agents-client";

import { ConnectionModal } from "./components/ConnectionModal";
import { StatusIcon } from "./components/StatusIcon";
import { ThemeMenu } from "./components/ThemeMenu";
import { useToast } from "./components/Toast";
import { AgentsView } from "./features/agents/AgentsView";
import {
  removeSavedAgent,
  replaceSavedAgent,
  requestAgentDelete,
  requestAgentDetail,
  requestAgentUpdate,
} from "./features/agents/agent-actions";
import {
  SessionsView,
  type SessionDetailState,
  type StreamState,
} from "./features/sessions/SessionsView";
import {
  reduceEnvironmentObservation,
  reconcileEnvironmentObservation,
  type EnvironmentObservation,
  type ScopedEnvironmentObservation,
  visibleEnvironmentObservation,
} from "./features/sessions/environment/environment-state";
import { SystemView } from "./features/system/SystemView";
import {
  createCore,
  loadConnection,
  saveConnection,
  type CoreConnection,
  type CoreConnectionState,
} from "./lib/connection";
import { settleCollection } from "./lib/collection-load";
import {
  beginPendingSend,
  failPendingSend,
  type FailedPendingSend,
} from "./lib/pending-send";
import {
  mergeDurableAndLiveItems,
  updateLiveSessionItems,
  upsertSessionItem,
} from "./lib/session-items";
import {
  createDurableRefreshCoordinator,
  createStreamRecoveryBuffer,
  type DurableRefreshCoordinator,
} from "./lib/session-recovery";
import {
  beginStreamReconciliation,
  requestCurrentStreamRetry,
  shouldRetryStreamError,
  streamConnectionWasStable,
  streamReconnectDelay,
  waitForStreamReconnect,
} from "./lib/stream-reconnect";

type View = "sessions" | "agents" | "system";

interface StreamConnection {
  sessionId: string | null;
  state: StreamState;
  error: string | null;
}

interface SelectedSessionLoad {
  sessionId: string | null;
  state: SessionDetailState;
  error: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The Agent core request failed.";
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function listAllItems(
  core: AgentCore,
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionItem[]> {
  const items: SessionItem[] = [];
  let after: string | undefined;

  while (true) {
    const page = await core.listItems(sessionId, { after, limit: 100, order: "asc", signal });
    items.push(...page.data);
    if (!page.has_more) return items;

    const nextAfter = page.last_id ?? page.data[page.data.length - 1]?.id;
    if (!nextAfter || nextAfter === after) {
      throw new Error("The Agent core returned an invalid Items pagination cursor.");
    }
    after = nextAfter;
  }
}

function projectTextEvent(current: SessionItem[], event: SessionEvent): SessionItem[] {
  const eventType = typeof event.type === "string" ? event.type : "";
  if (!eventType.includes(".output_text.")) return current;

  const partText = event.part?.type === "output_text" ? event.part.text : undefined;
  const replacement = event.text ?? partText ?? undefined;
  const addition = event.delta;
  if (replacement === undefined && addition === undefined) return current;

  const streamId = `stream:${event.turn_id ?? "turn"}:${event.output_index ?? 0}:${event.content_index ?? 0}`;
  const existingIndex = current.findIndex((item) => item.id === event.item_id || item.id === streamId);
  const existing = existingIndex >= 0 ? current[existingIndex] : undefined;
  const previousText = existing?.type === "message"
    ? (existing.content ?? []).map((content) => content.text ?? "").join("")
    : "";
  const text = replacement ?? `${previousText}${addition ?? ""}`;
  const projected: SessionItem = {
    id: existing?.id ?? event.item_id ?? streamId,
    turn_id: event.turn_id ?? existing?.turn_id ?? "",
    type: "message",
    status: eventType.endsWith(".done") || eventType.endsWith(".completed") ? "completed" : "in_progress",
    role: "assistant",
    phase: "final_answer",
    content: [{ type: "output_text", text }],
  };

  return upsertSessionItem(current, projected);
}

export function App() {
  const { show: showToast } = useToast();
  const [view, setView] = useState<View>("sessions");
  const [connection, setConnection] = useState<CoreConnection>(() => loadConnection());
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [itemsSessionId, setItemsSessionId] = useState<string | null>(null);
  const [environmentObservations, setEnvironmentObservations] = useState<Map<string, ScopedEnvironmentObservation>>(
    () => new Map(),
  );
  const [agentCollectionState, setAgentCollectionState] = useState<CoreConnectionState>("connecting");
  const [agentCollectionError, setAgentCollectionError] = useState<string | null>(null);
  const [sessionCollectionState, setSessionCollectionState] = useState<CoreConnectionState>("connecting");
  const [sessionCollectionError, setSessionCollectionError] = useState<string | null>(null);
  const [selectedSessionLoad, setSelectedSessionLoad] = useState<SelectedSessionLoad>({
    sessionId: null,
    state: "idle",
    error: null,
  });
  const [streamConnection, setStreamConnection] = useState<StreamConnection>({
    sessionId: null,
    state: "idle",
    error: null,
  });
  const [streamRetryRevision, setStreamRetryRevision] = useState(0);
  const [sessionSendFailures, setSessionSendFailures] = useState<Map<string, FailedPendingSend>>(
    () => new Map(),
  );
  const [busy, setBusy] = useState(false);
  const selectedIdRef = useRef<string | null>(selectedId);
  const itemsSessionIdRef = useRef<string | null>(itemsSessionId);
  const connectionGenerationRef = useRef(0);
  const agentCollectionRequestRef = useRef(0);
  const sessionCollectionRequestRef = useRef(0);
  const agentCollectionRevisionRef = useRef(0);
  const sessionCollectionRevisionRef = useRef(0);
  const sessionRequestRef = useRef(new Map<string, number>());
  const sessionEventRevisionRef = useRef(new Map<string, number>());
  const itemEventRevisionRef = useRef(new Map<string, number>());
  const environmentEventRevisionRef = useRef(new Map<string, number>());
  const operationRequestRef = useRef(0);
  const streamEpochRef = useRef(0);
  selectedIdRef.current = selectedId;

  const core = useMemo(() => createCore(connection), [connection]);
  const coreGeneration = connectionGenerationRef.current;
  const coreState: CoreConnectionState = agentCollectionState === "ready" || sessionCollectionState === "ready"
    ? "ready"
    : agentCollectionState === "failed" && sessionCollectionState === "failed"
      ? "failed"
      : "connecting";
  const selected = selectedId ? sessions.find((session) => session.id === selectedId) ?? null : null;
  const detailState: SessionDetailState = !selectedId
    ? "idle"
    : selectedSessionLoad.sessionId === selectedId
      ? selectedSessionLoad.state
      : "loading";
  const detailError = selectedSessionLoad.sessionId === selectedId ? selectedSessionLoad.error : null;
  const streamState: StreamState = !selectedId
    ? "idle"
    : streamConnection.sessionId !== selectedId
      ? "connecting"
      : streamConnection.state;
  const streamError = selectedId && streamConnection.sessionId === selectedId
    ? streamConnection.error
    : null;
  const sendError = selectedId ? sessionSendFailures.get(selectedId) ?? null : null;
  const environmentObservation: EnvironmentObservation | null = visibleEnvironmentObservation(
    selectedId ? environmentObservations.get(selectedId) : undefined,
    selectedId,
    streamConnection.sessionId,
    streamEpochRef.current,
  );
  const streamReady = streamState === "listening";
  const notify = useCallback((message: string, tone: "success" | "error") => {
    showToast(message, { tone, key: `${tone}:${message}` });
  }, [showToast]);

  const refreshAgents = useCallback(async () => {
    if (coreGeneration !== connectionGenerationRef.current) return false;
    const agentRevision = agentCollectionRevisionRef.current;
    const request = agentCollectionRequestRef.current + 1;
    agentCollectionRequestRef.current = request;
    setAgentCollectionState("connecting");
    setAgentCollectionError(null);
    const result = await settleCollection(() => core.listAgents({ limit: 100, order: "desc" }));
    if (
      coreGeneration !== connectionGenerationRef.current ||
      request !== agentCollectionRequestRef.current
    ) return false;
    if (result.status === "fulfilled") {
      if (agentRevision === agentCollectionRevisionRef.current) setAgents(result.value.data);
      setAgentCollectionState("ready");
      return true;
    }
    const message = errorMessage(result.reason);
    setAgentCollectionState("failed");
    setAgentCollectionError(message);
    notify(message, "error");
    return false;
  }, [core, coreGeneration, notify]);

  const refreshSessions = useCallback(async () => {
    if (coreGeneration !== connectionGenerationRef.current) return false;
    const sessionRevision = sessionCollectionRevisionRef.current;
    const request = sessionCollectionRequestRef.current + 1;
    sessionCollectionRequestRef.current = request;
    setSessionCollectionState("connecting");
    setSessionCollectionError(null);
    const result = await settleCollection(() => core.listSessions({ limit: 100, order: "desc" }));
    if (
      coreGeneration !== connectionGenerationRef.current ||
      request !== sessionCollectionRequestRef.current
    ) return false;
    if (result.status === "fulfilled") {
      if (sessionRevision === sessionCollectionRevisionRef.current) {
        setSessions(result.value.data);
        setSelectedId((current) => {
          if (current && result.value.data.some((session) => session.id === current)) return current;
          return result.value.data[0]?.id ?? null;
        });
      }
      setSessionCollectionState("ready");
      return true;
    }
    const message = errorMessage(result.reason);
    setSessionCollectionState("failed");
    setSessionCollectionError(message);
    notify(message, "error");
    return false;
  }, [core, coreGeneration, notify]);

  const refreshSession = useCallback(
    async (sessionId: string, signal?: AbortSignal): Promise<boolean> => {
      if (coreGeneration !== connectionGenerationRef.current) return false;
      const request = (sessionRequestRef.current.get(sessionId) ?? 0) + 1;
      const sessionRevision = sessionEventRevisionRef.current.get(sessionId) ?? 0;
      const itemRevision = itemEventRevisionRef.current.get(sessionId) ?? 0;
      const environmentRevision = environmentEventRevisionRef.current.get(sessionId) ?? 0;
      sessionRequestRef.current.set(sessionId, request);
      try {
        const [session, sessionItems] = await Promise.all([
          core.retrieveSession(sessionId, { signal }),
          listAllItems(core, sessionId, signal),
        ]);
        if (
          coreGeneration !== connectionGenerationRef.current ||
          request !== sessionRequestRef.current.get(sessionId)
        ) return false;
        if (sessionRevision === (sessionEventRevisionRef.current.get(sessionId) ?? 0)) {
          sessionCollectionRevisionRef.current += 1;
          setSessions((current) => {
            const found = current.some((value) => value.id === session.id);
            return found
              ? current.map((value) => (value.id === session.id ? session : value))
              : [session, ...current];
          });
        }
        if (environmentRevision === (environmentEventRevisionRef.current.get(sessionId) ?? 0)) {
          setEnvironmentObservations((current) => {
            const existing = current.get(sessionId);
            const reconciled = reconcileEnvironmentObservation(existing?.observation ?? null, session);
            if (reconciled === existing?.observation) return current;
            const next = new Map(current);
            if (reconciled && existing) next.set(sessionId, { ...existing, observation: reconciled });
            else next.delete(sessionId);
            return next;
          });
        }
        if (selectedIdRef.current === sessionId) {
          const liveRevisionChanged = itemRevision !== (itemEventRevisionRef.current.get(sessionId) ?? 0);
          const currentItemsSessionId = itemsSessionIdRef.current;
          itemsSessionIdRef.current = sessionId;
          setItems((current) => (
            liveRevisionChanged
              ? mergeDurableAndLiveItems(
                sessionItems,
                currentItemsSessionId === sessionId ? current : [],
              )
              : sessionItems
          ));
          setItemsSessionId(sessionId);
        }
        if (selectedIdRef.current === sessionId) {
          setSelectedSessionLoad({ sessionId, state: "ready", error: null });
        }
        return true;
      } catch (error) {
        if (
          coreGeneration === connectionGenerationRef.current &&
          request === sessionRequestRef.current.get(sessionId) &&
          selectedIdRef.current === sessionId
        ) {
          if (isAbort(error)) return false;
          const message = errorMessage(error);
          setSelectedSessionLoad({ sessionId, state: "failed", error: message });
          notify(message, "error");
        }
        return false;
      }
    },
    [core, coreGeneration, notify],
  );

  const recoverSessionWorkspace = useCallback(() => {
    void (async () => {
      const generation = coreGeneration;
      void refreshAgents();
      const refreshed = await refreshSessions();
      if (!refreshed || generation !== connectionGenerationRef.current) return;
      const sessionId = selectedIdRef.current;
      if (sessionId) await refreshSession(sessionId);
    })();
  }, [coreGeneration, refreshAgents, refreshSession, refreshSessions]);

  useEffect(() => {
    setAgents([]);
    setSessions([]);
    setItems([]);
    setEnvironmentObservations(new Map());
    itemsSessionIdRef.current = null;
    setItemsSessionId(null);
    setSelectedId(null);
    void refreshAgents();
    void refreshSessions();
  }, [refreshAgents, refreshSessions]);

  useEffect(() => {
    if (!selectedId) {
      setItems([]);
      itemsSessionIdRef.current = null;
      setItemsSessionId(null);
      setSelectedSessionLoad({ sessionId: null, state: "idle", error: null });
      setStreamConnection({ sessionId: null, state: "idle", error: null });
      return;
    }
    setItems([]);
    itemsSessionIdRef.current = selectedId;
    setItemsSessionId(selectedId);
    setSelectedSessionLoad({ sessionId: selectedId, state: "loading", error: null });
    environmentEventRevisionRef.current.set(
      selectedId,
      (environmentEventRevisionRef.current.get(selectedId) ?? 0) + 1,
    );
    setEnvironmentObservations((current) => {
      if (!current.has(selectedId)) return current;
      const next = new Map(current);
      next.delete(selectedId);
      return next;
    });
    const controller = new AbortController();
    void refreshSession(selectedId, controller.signal);
    return () => controller.abort();
  }, [refreshSession, selectedId]);

  useEffect(() => {
    if (!selectedId) return;

    const sessionId = selectedId;
    const controller = new AbortController();
    const streamEpoch = streamEpochRef.current + 1;
    streamEpochRef.current = streamEpoch;
    setStreamConnection({ sessionId, state: "connecting", error: null });
    let reconnectAttempt = 0;
    const recovery = createStreamRecoveryBuffer();
    let refreshCoordinator: DurableRefreshCoordinator | null = null;
    let recoveryPromise: Promise<unknown> | null = null;

    const isCurrentStream = () => (
      !controller.signal.aborted &&
      coreGeneration === connectionGenerationRef.current &&
      streamEpoch === streamEpochRef.current &&
      selectedIdRef.current === sessionId
    );

    const setCurrentStreamState = (state: StreamState, error: string | null = null) => {
      if (!isCurrentStream()) return;
      setStreamConnection((current) => (
        current.sessionId === sessionId ? { ...current, state, error } : current
      ));
    };

    const applyEvent = (event: SessionEvent) => {
      if (!isCurrentStream()) return;
      if (typeof event.session_id === "string" && event.session_id && event.session_id !== sessionId) return;
      const eventType = typeof event.type === "string" ? event.type : "";
      const isEnvironmentEvent = eventType.startsWith("agent.session.environment.");
      if (isEnvironmentEvent) {
        environmentEventRevisionRef.current.set(
          sessionId,
          (environmentEventRevisionRef.current.get(sessionId) ?? 0) + 1,
        );
        setEnvironmentObservations((current) => {
          const next = new Map(current);
          const existing = current.get(sessionId);
          const previous = existing?.streamEpoch === streamEpoch ? existing.observation : null;
          const reduced = reduceEnvironmentObservation(previous, event, sessionId);
          if (reduced) next.set(sessionId, { observation: reduced, sessionId, streamEpoch });
          else next.delete(sessionId);
          return next;
        });
      }
      if (event.session) {
        sessionEventRevisionRef.current.set(
          sessionId,
          (sessionEventRevisionRef.current.get(sessionId) ?? 0) + 1,
        );
        sessionCollectionRevisionRef.current += 1;
        setSessions((current) => current.map((session) => (session.id === event.session?.id ? event.session : session)));
      }
      if (event.item || eventType.includes(".output_text.")) {
        itemEventRevisionRef.current.set(
          sessionId,
          (itemEventRevisionRef.current.get(sessionId) ?? 0) + 1,
        );
      }
      if (event.item && selectedIdRef.current === sessionId) {
        const currentItemsSessionId = itemsSessionIdRef.current;
        itemsSessionIdRef.current = sessionId;
        setItemsSessionId(sessionId);
        setItems((current) => {
          const sessionItems = updateLiveSessionItems(
            current,
            currentItemsSessionId,
            sessionId,
            (value) => value,
          );
          const withoutTemporary = sessionItems.filter((item) => (
            event.item?.type !== "message" || event.item.role !== "assistant" || !item.id.startsWith(`stream:${event.item.turn_id}:`)
          ));
          return upsertSessionItem(withoutTemporary, event.item as SessionItem);
        });
      }
      if (eventType.includes(".output_text.") && selectedIdRef.current === sessionId) {
        const currentItemsSessionId = itemsSessionIdRef.current;
        itemsSessionIdRef.current = sessionId;
        setItemsSessionId(sessionId);
        setItems((current) => updateLiveSessionItems(
          current,
          currentItemsSessionId,
          sessionId,
          (sessionItems) => projectTextEvent(sessionItems, event),
        ));
      }
      refreshCoordinator?.accept(event);
    };

    refreshCoordinator = createDurableRefreshCoordinator(
      () => refreshSession(sessionId, controller.signal),
    );

    const listen = async () => {
      while (isCurrentStream()) {
        let openedAt: number | null = null;
        let receivedEvent = false;
        try {
          await core.streamEvents(sessionId, {
            signal: controller.signal,
            onOpen: () => {
              if (!isCurrentStream()) return;
              environmentEventRevisionRef.current.set(
                sessionId,
                (environmentEventRevisionRef.current.get(sessionId) ?? 0) + 1,
              );
              setEnvironmentObservations((current) => {
                if (!current.has(sessionId)) return current;
                const next = new Map(current);
                next.delete(sessionId);
                return next;
              });
              openedAt = beginStreamReconciliation(
                isCurrentStream,
                () => setCurrentStreamState("listening"),
                () => {
                  const token = recovery.begin();
                  recoveryPromise = refreshSession(sessionId, controller.signal)
                    .finally(() => recovery.finish(token, isCurrentStream, applyEvent));
                },
              );
            },
            onEvent: (event) => {
              if (!isCurrentStream()) return;
              receivedEvent = true;
              recovery.accept(event, applyEvent);
            },
          });
        } catch (error) {
          if (!isCurrentStream() || isAbort(error)) return;
          if (!shouldRetryStreamError(error)) {
            setCurrentStreamState("failed", errorMessage(error));
            const status = error instanceof AgentCoreError ? ` (${error.status})` : "";
            notify(
              `Live event stream was rejected by Agent Core${status}. Check the Core connection settings.`,
              "error",
            );
            return;
          }
        }

        if (!isCurrentStream()) return;
        await recoveryPromise;
        recoveryPromise = null;
        if (!isCurrentStream()) return;
        if (streamConnectionWasStable(openedAt, receivedEvent)) reconnectAttempt = 0;
        setCurrentStreamState("recovering");

        const delay = streamReconnectDelay(reconnectAttempt);
        reconnectAttempt += 1;
        if (!(await waitForStreamReconnect(delay, controller.signal))) return;
      }
    };

    void listen();

    return () => {
      refreshCoordinator?.dispose();
      recovery.invalidate();
      controller.abort();
    };
  }, [core, coreGeneration, notify, refreshSession, selectedId, streamRetryRevision]);

  const retryCurrentStream = useCallback(() => {
    requestCurrentStreamRetry(selectedIdRef.current, (sessionId) => {
      setStreamConnection({ sessionId, state: "connecting", error: null });
      setStreamRetryRevision((current) => current + 1);
    });
  }, []);

  const run = async <T,>(operation: () => Promise<T>, success?: string): Promise<T | undefined> => {
    if (coreGeneration !== connectionGenerationRef.current) return undefined;
    const operationRequest = operationRequestRef.current + 1;
    operationRequestRef.current = operationRequest;
    setBusy(true);
    try {
      const result = await operation();
      if (coreGeneration !== connectionGenerationRef.current) return undefined;
      if (success) notify(success, "success");
      return result;
    } catch (error) {
      if (coreGeneration !== connectionGenerationRef.current) return undefined;
      notify(errorMessage(error), "error");
      throw error;
    } finally {
      if (
        coreGeneration === connectionGenerationRef.current &&
        operationRequest === operationRequestRef.current
      ) setBusy(false);
    }
  };

  const createAgent = async (input: CreateAgentInput) => {
    const agent = await run(() => core.createAgent(input), "Agent created.");
    if (!agent || coreGeneration !== connectionGenerationRef.current) return;
    agentCollectionRevisionRef.current += 1;
    setAgents((current) => [agent, ...current]);
  };

  const retrieveAgent = async (agentId: string) => {
    return run(() => requestAgentDetail(core, agentId));
  };

  const updateAgent = async (agentId: string, input: UpdateAgentInput) => {
    const agent = await run(() => requestAgentUpdate(core, agentId, input), "Agent updated.");
    if (!agent || coreGeneration !== connectionGenerationRef.current) return undefined;
    agentCollectionRevisionRef.current += 1;
    setAgents((current) => replaceSavedAgent(current, agent));
    return agent;
  };

  const deleteAgent = async (agentId: string) => {
    const deleted = await run(() => requestAgentDelete(core, agentId), "Agent deleted.");
    if (!deleted || coreGeneration !== connectionGenerationRef.current) return;
    agentCollectionRevisionRef.current += 1;
    setAgents((current) => removeSavedAgent(current, agentId));
  };

  const createSession = async (agentId: string) => {
    const session = await run(
      () => core.createSession({ agent_id: agentId, environment: { type: "none" }, stream: false }),
      "Idle Session created. Opening live events…",
    );
    if (!session || coreGeneration !== connectionGenerationRef.current) return;
    sessionCollectionRevisionRef.current += 1;
    setSessions((current) => [session, ...current.filter((value) => value.id !== session.id)]);
    setSelectedId(session.id);
    setItems([]);
    itemsSessionIdRef.current = session.id;
    setItemsSessionId(session.id);
    setView("sessions");
  };

  const sendMessage = async (text: string) => {
    const sessionId = selectedId;
    if (!sessionId) return;
    if (!streamReady) {
      const message = "Wait for the live event stream to connect before sending.";
      notify(message, "error");
      throw new Error(message);
    }
    const previousFailure = sessionSendFailures.get(sessionId);
    const pending = beginPendingSend(sessionId, text, previousFailure);
    setSessionSendFailures((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });
    try {
      await run(() => core.sendMessage(sessionId, text, pending.idempotencyKey));
    } catch (error) {
      if (coreGeneration === connectionGenerationRef.current) {
        setSessionSendFailures((current) => {
          const next = new Map(current);
          next.set(sessionId, failPendingSend(pending, error, errorMessage(error)));
          return next;
        });
      }
      throw error;
    }
    if (coreGeneration !== connectionGenerationRef.current || selectedIdRef.current !== sessionId) return;
    setSessionSendFailures((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });
    await refreshSession(sessionId);
  };

  const cancel = async () => {
    const sessionId = selectedId;
    if (!sessionId) return;
    await run(() => core.cancelTurn(sessionId), "Cancellation requested.");
    if (coreGeneration !== connectionGenerationRef.current || selectedIdRef.current !== sessionId) return;
    await refreshSession(sessionId);
  };

  const submitFunctionResult = async (input: FunctionResultInput) => {
    const sessionId = selectedId;
    if (!sessionId) return;
    await run(() => core.submitFunctionResult(sessionId, input), "Function result submitted.");
    if (coreGeneration !== connectionGenerationRef.current || selectedIdRef.current !== sessionId) return;
    await refreshSession(sessionId);
  };

  const applyConnection = (next: CoreConnection) => {
    const normalized = { ...next, baseUrl: next.baseUrl.trim() || "/v1", token: next.token.trim() };
    connectionGenerationRef.current += 1;
    agentCollectionRequestRef.current += 1;
    sessionCollectionRequestRef.current += 1;
    agentCollectionRevisionRef.current = 0;
    sessionCollectionRevisionRef.current = 0;
    sessionRequestRef.current.clear();
    sessionEventRevisionRef.current.clear();
    itemEventRevisionRef.current.clear();
    environmentEventRevisionRef.current.clear();
    operationRequestRef.current += 1;
    streamEpochRef.current += 1;
    saveConnection(normalized);
    setBusy(false);
    setAgentCollectionState("connecting");
    setAgentCollectionError(null);
    setSessionCollectionState("connecting");
    setSessionCollectionError(null);
    setSelectedId(null);
    setSelectedSessionLoad({ sessionId: null, state: "idle", error: null });
    setStreamConnection({ sessionId: null, state: "idle", error: null });
    setSessionSendFailures(new Map());
    setEnvironmentObservations(new Map());
    itemsSessionIdRef.current = null;
    setItemsSessionId(null);
    setConnection(normalized);
    setConnectionOpen(false);
  };

  const navItems: Array<{ id: View; label: string; icon: typeof MessageSquare }> = [
    { id: "sessions", label: "Sessions", icon: MessageSquare },
    { id: "agents", label: "Agents", icon: Bot },
    { id: "system", label: "Architecture", icon: Layers3 },
  ];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="app-sidebar">
        <div className="brand-lockup">
          <span className="brand-mark-frame">
            <img className="brand-mark brand-mark-light" src="/parsar-mark-light.png" width="18" height="18" alt="" aria-hidden="true" />
            <img className="brand-mark brand-mark-dark" src="/parsar-mark-dark.png" width="18" height="18" alt="" aria-hidden="true" />
          </span>
          <span className="brand-name">Agents Core Web</span>
        </div>

        <nav className="main-nav" aria-label="Primary navigation">
          <p className="nav-label">Agent</p>
          {navItems.slice(0, 2).map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                className={view === item.id ? "active" : ""}
                key={item.id}
                onClick={() => setView(item.id)}
                aria-label={item.label}
                aria-current={view === item.id ? "page" : undefined}
              >
                <Icon size={15} strokeWidth={1.5} />
                <span>{item.label}</span>
                {item.id === "sessions" && sessions.length ? <em>{sessions.length}</em> : null}
              </button>
            );
          })}

          <p className="nav-label">System</p>
          {navItems.slice(2).map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                className={view === item.id ? "active" : ""}
                key={item.id}
                onClick={() => setView(item.id)}
                aria-label={item.label}
                aria-current={view === item.id ? "page" : undefined}
              >
                <Icon size={15} strokeWidth={1.5} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            className="core-switcher"
            type="button"
            onClick={() => setConnectionOpen(true)}
            aria-label="Configure Agent Core connection"
          >
            <StatusIcon
              status={coreState === "ready" ? "completed" : coreState === "failed" ? "failed" : "running"}
              title={`Core API ${coreState}`}
            />
            <span>
              <strong>Agent Core</strong>
              <small>{coreState === "connecting" ? "Connecting…" : coreState === "ready" ? "API ready" : coreState}</small>
            </span>
            <Settings2 size={14} strokeWidth={1.5} />
          </button>
          <ThemeMenu />
        </div>
      </aside>

      <main className="app-main" id="main-content" tabIndex={-1}>
        <div className="page-transition" key={view}>
          {view === "sessions" ? (
            <SessionsView
              agents={agents}
              sessions={sessions}
              selected={selected}
              items={itemsSessionId === selectedId ? items : []}
              busy={busy}
              coreError={sessionCollectionError}
              coreState={sessionCollectionState}
              detailError={detailError}
              detailState={detailState}
              environmentObservation={environmentObservation}
              sendError={sendError}
              streamError={streamError}
              streamState={streamState}
              onCancel={cancel}
              onCreateSession={createSession}
              onFunctionResult={submitFunctionResult}
              onRefresh={recoverSessionWorkspace}
              onRetrySession={() => {
                if (selectedId) void refreshSession(selectedId);
              }}
              onRetryStream={retryCurrentStream}
              onSelect={setSelectedId}
              onSend={sendMessage}
            />
          ) : null}
          {view === "agents" ? (
            <AgentsView
              agents={agents}
              busy={busy}
              coreError={agentCollectionError}
              coreState={agentCollectionState}
              onCreate={createAgent}
              onDelete={deleteAgent}
              onRefresh={() => void refreshAgents()}
              onRetrieve={retrieveAgent}
              onStartSession={createSession}
              onUpdate={updateAgent}
            />
          ) : null}
          {view === "system" ? <SystemView /> : null}
        </div>
      </main>

      <ConnectionModal
        connection={connection}
        open={connectionOpen}
        onClose={() => setConnectionOpen(false)}
        onSave={applyConnection}
      />
    </div>
  );
}
