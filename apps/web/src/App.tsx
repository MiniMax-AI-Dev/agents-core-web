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
  AgentTurn,
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
  removeSession,
  reconcileUnknownSessionDelete,
  replaceSessionMetadata,
  requestSessionDelete,
  requestSessionDetail,
  requestSessionUpdate,
  selectionAfterSessionDelete,
  SessionActionError,
  SessionMetadataConflictError,
} from "./features/sessions/actions/session-actions";
import {
  environmentObservationFromResource,
  environmentIdsMatch,
  environmentReadIsCurrent,
  matchingSessionSnapshot,
  reduceEnvironmentObservation,
  selfHostedEnvironmentId,
  type EnvironmentObservation,
  type ScopedEnvironmentObservation,
  unavailableEnvironmentObservation,
  visibleEnvironmentObservation,
} from "./features/sessions/environment/environment-state";
import {
  listAllTurns,
  matchingTurnSnapshot,
  mergeDurableAndLiveTurns,
  turnReadIsCurrent,
  upsertTurn,
} from "./features/sessions/turns/turn-state";
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
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [turnsSessionId, setTurnsSessionId] = useState<string | null>(null);
  const [turnCollectionLoad, setTurnCollectionLoad] = useState<SelectedSessionLoad>({
    sessionId: null,
    state: "idle",
    error: null,
  });
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
  const sessionsRef = useRef<AgentSession[]>(sessions);
  const itemsSessionIdRef = useRef<string | null>(itemsSessionId);
  const turnsSessionIdRef = useRef<string | null>(turnsSessionId);
  const connectionGenerationRef = useRef(0);
  const agentCollectionRequestRef = useRef(0);
  const sessionCollectionRequestRef = useRef(0);
  const agentCollectionRevisionRef = useRef(0);
  const sessionCollectionRevisionRef = useRef(0);
  const sessionRequestRef = useRef(new Map<string, number>());
  const sessionEventRevisionRef = useRef(new Map<string, number>());
  const itemEventRevisionRef = useRef(new Map<string, number>());
  const turnEventRevisionRef = useRef(new Map<string, number>());
  const environmentEventRevisionRef = useRef(new Map<string, number>());
  const environmentRequestRef = useRef(new Map<string, number>());
  const sessionEnvironmentIdRef = useRef(new Map<string, string | null>());
  const operationRequestRef = useRef(0);
  const streamEpochRef = useRef(0);
  const selectedSessionReadAbortRef = useRef<AbortController | null>(null);
  const selectedStreamAbortRef = useRef<AbortController | null>(null);
  selectedIdRef.current = selectedId;
  sessionsRef.current = sessions;

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
  const turnState: SessionDetailState = !selectedId
    ? "idle"
    : turnCollectionLoad.sessionId === selectedId
      ? turnCollectionLoad.state
      : "loading";
  const turnError = turnCollectionLoad.sessionId === selectedId ? turnCollectionLoad.error : null;
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
        const nextEnvironmentIds = new Map(
          result.value.data.map((session) => [session.id, selfHostedEnvironmentId(session.environment)]),
        );
        const changedEnvironmentSessions = new Set<string>();
        for (const [sessionId, environmentId] of nextEnvironmentIds) {
          if (!environmentIdsMatch(sessionEnvironmentIdRef.current.get(sessionId), environmentId)) {
            changedEnvironmentSessions.add(sessionId);
          }
        }
        for (const sessionId of sessionEnvironmentIdRef.current.keys()) {
          if (!nextEnvironmentIds.has(sessionId)) changedEnvironmentSessions.add(sessionId);
        }
        for (const sessionId of changedEnvironmentSessions) {
          environmentRequestRef.current.set(
            sessionId,
            (environmentRequestRef.current.get(sessionId) ?? 0) + 1,
          );
          environmentEventRevisionRef.current.set(
            sessionId,
            (environmentEventRevisionRef.current.get(sessionId) ?? 0) + 1,
          );
        }
        sessionEnvironmentIdRef.current = nextEnvironmentIds;
        if (changedEnvironmentSessions.size) {
          setEnvironmentObservations((current) => {
            if (![...changedEnvironmentSessions].some((sessionId) => current.has(sessionId))) return current;
            const next = new Map(current);
            for (const sessionId of changedEnvironmentSessions) next.delete(sessionId);
            return next;
          });
        }
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
      const turnRevision = turnEventRevisionRef.current.get(sessionId) ?? 0;
      const environmentRevision = environmentEventRevisionRef.current.get(sessionId) ?? 0;
      sessionRequestRef.current.set(sessionId, request);
      const turnRead = { coreGeneration, request, sessionId };
      void listAllTurns(core, sessionId, signal).then((sessionTurns) => {
        const currentTurnRead = {
          coreGeneration: connectionGenerationRef.current,
          request: sessionRequestRef.current.get(sessionId) ?? 0,
          sessionId,
          selectedSessionId: selectedIdRef.current,
        };
        if (!turnReadIsCurrent(turnRead, currentTurnRead)) return;
        const liveRevisionChanged = turnRevision !== (turnEventRevisionRef.current.get(sessionId) ?? 0);
        const currentTurnsSessionId = turnsSessionIdRef.current;
        turnsSessionIdRef.current = sessionId;
        setTurns((current) => (
          liveRevisionChanged
            ? mergeDurableAndLiveTurns(
              sessionTurns,
              currentTurnsSessionId === sessionId ? current : [],
            )
            : sessionTurns
        ));
        setTurnsSessionId(sessionId);
        setTurnCollectionLoad({ sessionId, state: "ready", error: null });
      }).catch((error: unknown) => {
        const currentTurnRead = {
          coreGeneration: connectionGenerationRef.current,
          request: sessionRequestRef.current.get(sessionId) ?? 0,
          sessionId,
          selectedSessionId: selectedIdRef.current,
        };
        if (!turnReadIsCurrent(turnRead, currentTurnRead) || isAbort(error)) return;
        setTurnCollectionLoad({
          sessionId,
          state: "failed",
          error: errorMessage(error),
        });
      });
      try {
        const [session, sessionItems] = await Promise.all([
          core.retrieveSession(sessionId, { signal }),
          listAllItems(core, sessionId, signal),
        ]);
        if (
          coreGeneration !== connectionGenerationRef.current ||
          request !== sessionRequestRef.current.get(sessionId)
        ) return false;
        const currentSessionRevision = sessionEventRevisionRef.current.get(sessionId) ?? 0;
        const sessionIsCurrent = sessionRevision === currentSessionRevision;
        const environmentId = selfHostedEnvironmentId(session.environment);
        if (sessionIsCurrent) {
          sessionEnvironmentIdRef.current.set(sessionId, environmentId);
          sessionCollectionRevisionRef.current += 1;
          setSessions((current) => {
            const found = current.some((value) => value.id === session.id);
            return found
              ? current.map((value) => (value.id === session.id ? session : value))
              : [session, ...current];
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

        if (!sessionIsCurrent) return true;
        if (!environmentId) {
          if (environmentRevision === (environmentEventRevisionRef.current.get(sessionId) ?? 0)) {
            setEnvironmentObservations((current) => {
              if (!current.has(sessionId)) return current;
              const next = new Map(current);
              next.delete(sessionId);
              return next;
            });
          }
          return true;
        }
        if (signal?.aborted || selectedIdRef.current !== sessionId) return false;

        const environmentStreamEpoch = streamEpochRef.current;
        const environmentRequest = (environmentRequestRef.current.get(sessionId) ?? 0) + 1;
        environmentRequestRef.current.set(sessionId, environmentRequest);
        const environmentRead = {
          coreGeneration,
          sessionId,
          environmentId,
          sessionRequest: request,
          environmentRequest,
          streamEpoch: environmentStreamEpoch,
          sessionRevision,
          environmentRevision,
        };
        let observation: EnvironmentObservation;
        try {
          const resource = await core.retrieveEnvironment(environmentId, { signal });
          observation = environmentObservationFromResource(resource, environmentId)
            ?? unavailableEnvironmentObservation(environmentId);
        } catch (error) {
          if (isAbort(error)) return false;
          observation = unavailableEnvironmentObservation(environmentId);
        }
        if (signal?.aborted || !environmentReadIsCurrent(environmentRead, {
          coreGeneration: connectionGenerationRef.current,
          sessionId,
          environmentId: sessionEnvironmentIdRef.current.get(sessionId) ?? "",
          sessionRequest: sessionRequestRef.current.get(sessionId) ?? 0,
          environmentRequest: environmentRequestRef.current.get(sessionId) ?? 0,
          streamEpoch: streamEpochRef.current,
          sessionRevision: sessionEventRevisionRef.current.get(sessionId) ?? 0,
          environmentRevision: environmentEventRevisionRef.current.get(sessionId) ?? 0,
          selectedSessionId: selectedIdRef.current,
        })) return false;
        setEnvironmentObservations((current) => {
          const next = new Map(current);
          next.set(sessionId, { observation, sessionId, streamEpoch: environmentStreamEpoch });
          return next;
        });
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

  const refreshSelectedSession = useCallback((sessionId: string): Promise<boolean> => {
    if (selectedIdRef.current !== sessionId) return Promise.resolve(false);
    selectedSessionReadAbortRef.current?.abort();
    const controller = new AbortController();
    // Turn pagination can outlive refreshSession's Session/Item result, so retain this
    // controller until the next selected read, selection change, deletion, or Core change.
    selectedSessionReadAbortRef.current = controller;
    return refreshSession(sessionId, controller.signal);
  }, [refreshSession]);

  const recoverSessionWorkspace = useCallback(() => {
    void (async () => {
      const generation = coreGeneration;
      void refreshAgents();
      const refreshed = await refreshSessions();
      if (!refreshed || generation !== connectionGenerationRef.current) return;
      const sessionId = selectedIdRef.current;
      if (sessionId) await refreshSelectedSession(sessionId);
    })();
  }, [coreGeneration, refreshAgents, refreshSelectedSession, refreshSessions]);

  useEffect(() => {
    setAgents([]);
    setSessions([]);
    setItems([]);
    setTurns([]);
    setEnvironmentObservations(new Map());
    itemsSessionIdRef.current = null;
    setItemsSessionId(null);
    turnsSessionIdRef.current = null;
    setTurnsSessionId(null);
    setTurnCollectionLoad({ sessionId: null, state: "idle", error: null });
    setSelectedId(null);
    void refreshAgents();
    void refreshSessions();
  }, [refreshAgents, refreshSessions]);

  useEffect(() => {
    selectedSessionReadAbortRef.current?.abort();
    if (!selectedId) {
      selectedSessionReadAbortRef.current = null;
      setItems([]);
      setTurns([]);
      itemsSessionIdRef.current = null;
      setItemsSessionId(null);
      turnsSessionIdRef.current = null;
      setTurnsSessionId(null);
      setTurnCollectionLoad({ sessionId: null, state: "idle", error: null });
      setSelectedSessionLoad({ sessionId: null, state: "idle", error: null });
      setStreamConnection({ sessionId: null, state: "idle", error: null });
      return;
    }
    setItems([]);
    setTurns([]);
    itemsSessionIdRef.current = selectedId;
    setItemsSessionId(selectedId);
    turnsSessionIdRef.current = selectedId;
    setTurnsSessionId(selectedId);
    setTurnCollectionLoad({ sessionId: selectedId, state: "loading", error: null });
    setSelectedSessionLoad({ sessionId: selectedId, state: "loading", error: null });
    environmentEventRevisionRef.current.set(
      selectedId,
      (environmentEventRevisionRef.current.get(selectedId) ?? 0) + 1,
    );
    environmentRequestRef.current.set(
      selectedId,
      (environmentRequestRef.current.get(selectedId) ?? 0) + 1,
    );
    setEnvironmentObservations((current) => {
      if (!current.has(selectedId)) return current;
      const next = new Map(current);
      next.delete(selectedId);
      return next;
    });
    void refreshSelectedSession(selectedId);
    return () => {
      selectedSessionReadAbortRef.current?.abort();
      selectedSessionReadAbortRef.current = null;
    };
  }, [refreshSelectedSession, selectedId]);

  useEffect(() => {
    selectedStreamAbortRef.current?.abort();
    if (!selectedId) return;

    const sessionId = selectedId;
    const controller = new AbortController();
    selectedStreamAbortRef.current = controller;
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
      const eventSession = matchingSessionSnapshot(event, sessionId);
      if (eventSession) {
        const nextEnvironmentId = selfHostedEnvironmentId(eventSession.environment);
        const previousEnvironmentId = sessionEnvironmentIdRef.current.get(sessionId);
        if (!environmentIdsMatch(previousEnvironmentId, nextEnvironmentId)) {
          sessionEnvironmentIdRef.current.set(sessionId, nextEnvironmentId);
          environmentRequestRef.current.set(
            sessionId,
            (environmentRequestRef.current.get(sessionId) ?? 0) + 1,
          );
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
        }
      }
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
          const reduced = reduceEnvironmentObservation(
            previous,
            event,
            sessionId,
            sessionEnvironmentIdRef.current.get(sessionId) ?? null,
          );
          if (reduced) next.set(sessionId, { observation: reduced, sessionId, streamEpoch });
          else next.delete(sessionId);
          return next;
        });
      }
      if (eventSession) {
        sessionEventRevisionRef.current.set(
          sessionId,
          (sessionEventRevisionRef.current.get(sessionId) ?? 0) + 1,
        );
        sessionCollectionRevisionRef.current += 1;
        setSessions((current) => current.map((session) => (session.id === eventSession.id ? eventSession : session)));
      }
      const eventTurn = matchingTurnSnapshot(event, sessionId);
      if (eventTurn) {
        turnEventRevisionRef.current.set(
          sessionId,
          (turnEventRevisionRef.current.get(sessionId) ?? 0) + 1,
        );
        if (selectedIdRef.current === sessionId) {
          const currentTurnsSessionId = turnsSessionIdRef.current;
          turnsSessionIdRef.current = sessionId;
          setTurnsSessionId(sessionId);
          setTurns((current) => upsertTurn(
            currentTurnsSessionId === sessionId ? current : [],
            eventTurn,
          ));
        }
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
              environmentRequestRef.current.set(
                sessionId,
                (environmentRequestRef.current.get(sessionId) ?? 0) + 1,
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
      if (selectedStreamAbortRef.current === controller) selectedStreamAbortRef.current = null;
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

  const retrieveSessionForAction = useCallback(async (sessionId: string) => {
    const generation = coreGeneration;
    try {
      const session = await requestSessionDetail(core, sessionId);
      return generation === connectionGenerationRef.current ? session : undefined;
    } catch (error) {
      if (generation !== connectionGenerationRef.current) return undefined;
      throw error;
    }
  }, [core, coreGeneration]);

  const updateSessionMetadata = async (
    sessionId: string,
    baselineMetadata: Record<string, string>,
    draftMetadata: Record<string, string>,
  ): Promise<AgentSession | undefined> => {
    const generation = coreGeneration;
    let updated: AgentSession;
    try {
      updated = await requestSessionUpdate(core, sessionId, baselineMetadata, draftMetadata);
    } catch (error) {
      if (generation !== connectionGenerationRef.current) return undefined;
      if (error instanceof SessionMetadataConflictError && error.latestSession) {
        sessionCollectionRevisionRef.current += 1;
        sessionEventRevisionRef.current.set(
          sessionId,
          (sessionEventRevisionRef.current.get(sessionId) ?? 0) + 1,
        );
        setSessions((current) => replaceSessionMetadata(current, error.latestSession as AgentSession));
      }
      throw error;
    }
    if (generation !== connectionGenerationRef.current) {
      notify("The previous Core returned a Session update after the connection changed. The current Core view was not modified.", "error");
      return undefined;
    }
    sessionCollectionRevisionRef.current += 1;
    sessionEventRevisionRef.current.set(
      sessionId,
      (sessionEventRevisionRef.current.get(sessionId) ?? 0) + 1,
    );
    setSessions((current) => replaceSessionMetadata(current, updated));
    notify("Session metadata updated.", "success");
    return updated;
  };

  const removeSessionFromWorkspace = (sessionId: string, message: string): boolean => {
    const selectedAtCompletion = selectedIdRef.current;
    const deletingSelected = selectedAtCompletion === sessionId;
    const nextSelectedId = selectionAfterSessionDelete(
      sessionsRef.current,
      selectedAtCompletion,
      sessionId,
    );
    const increment = (revisions: Map<string, number>) => {
      revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1);
    };
    sessionCollectionRevisionRef.current += 1;
    increment(sessionRequestRef.current);
    increment(sessionEventRevisionRef.current);
    increment(itemEventRevisionRef.current);
    increment(turnEventRevisionRef.current);
    increment(environmentEventRevisionRef.current);
    increment(environmentRequestRef.current);
    sessionEnvironmentIdRef.current.delete(sessionId);

    setSessions((current) => {
      const next = removeSession(current, sessionId);
      sessionsRef.current = next;
      return next;
    });
    setSessionSendFailures((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });
    setEnvironmentObservations((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });

    if (deletingSelected) {
      selectedIdRef.current = nextSelectedId;
      streamEpochRef.current += 1;
      selectedSessionReadAbortRef.current?.abort();
      selectedSessionReadAbortRef.current = null;
      selectedStreamAbortRef.current?.abort();
      selectedStreamAbortRef.current = null;
      itemsSessionIdRef.current = null;
      turnsSessionIdRef.current = null;
      setItems([]);
      setItemsSessionId(null);
      setTurns([]);
      setTurnsSessionId(null);
      setSelectedSessionLoad({ sessionId: null, state: "idle", error: null });
      setTurnCollectionLoad({ sessionId: null, state: "idle", error: null });
      setStreamConnection({ sessionId: null, state: "idle", error: null });
      setSelectedId(nextSelectedId);
    }
    notify(message, "success");
    return true;
  };

  const deleteSessionFromCore = async (sessionId: string): Promise<boolean> => {
    const generation = coreGeneration;
    try {
      await requestSessionDelete(core, sessionId);
    } catch (error) {
      if (generation !== connectionGenerationRef.current) return false;
      if (!(error instanceof SessionActionError) || error.kind !== "unknown_write") throw error;

      const reconciliation = await reconcileUnknownSessionDelete(core, sessionId);
      if (generation !== connectionGenerationRef.current) return false;
      if (reconciliation.state === "missing") {
        return removeSessionFromWorkspace(
          sessionId,
          "Session is absent from Agent Core after reconciling the unknown deletion result.",
        );
      }
      if (reconciliation.state === "unknown") {
        throw new SessionActionError(
          `${error.message} The follow-up durable Session refresh also failed, so the result remains unknown.`,
          "unknown_write",
          { cause: error },
        );
      }
      throw new SessionActionError(
        `${error.message} A follow-up durable Session refresh confirmed that the Session is still present.`,
        "request_failed",
        { cause: error },
      );
    }
    if (generation !== connectionGenerationRef.current) {
      notify("The previous Core confirmed Session deletion after the connection changed. The current Core view was not modified.", "error");
      return false;
    }
    return removeSessionFromWorkspace(sessionId, "Session deleted from Agent Core.");
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
    await refreshSelectedSession(sessionId);
  };

  const cancel = async () => {
    const sessionId = selectedId;
    if (!sessionId) return;
    await run(() => core.cancelTurn(sessionId), "Cancellation requested.");
    if (coreGeneration !== connectionGenerationRef.current || selectedIdRef.current !== sessionId) return;
    await refreshSelectedSession(sessionId);
  };

  const submitFunctionResult = async (input: FunctionResultInput) => {
    const sessionId = selectedId;
    if (!sessionId) return;
    await run(() => core.submitFunctionResult(sessionId, input), "Function result submitted.");
    if (coreGeneration !== connectionGenerationRef.current || selectedIdRef.current !== sessionId) return;
    await refreshSelectedSession(sessionId);
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
    turnEventRevisionRef.current.clear();
    environmentEventRevisionRef.current.clear();
    environmentRequestRef.current.clear();
    sessionEnvironmentIdRef.current.clear();
    operationRequestRef.current += 1;
    streamEpochRef.current += 1;
    selectedSessionReadAbortRef.current?.abort();
    selectedSessionReadAbortRef.current = null;
    selectedStreamAbortRef.current?.abort();
    selectedStreamAbortRef.current = null;
    saveConnection(normalized);
    setBusy(false);
    setAgentCollectionState("connecting");
    setAgentCollectionError(null);
    setSessionCollectionState("connecting");
    setSessionCollectionError(null);
    setSelectedId(null);
    setSelectedSessionLoad({ sessionId: null, state: "idle", error: null });
    setTurnCollectionLoad({ sessionId: null, state: "idle", error: null });
    setStreamConnection({ sessionId: null, state: "idle", error: null });
    setSessionSendFailures(new Map());
    setEnvironmentObservations(new Map());
    itemsSessionIdRef.current = null;
    setItemsSessionId(null);
    turnsSessionIdRef.current = null;
    setTurnsSessionId(null);
    setTurns([]);
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
              key={`sessions:${coreGeneration}`}
              agents={agents}
              sessions={sessions}
              selected={selected}
              items={itemsSessionId === selectedId ? items : []}
              turns={turnsSessionId === selectedId ? turns : []}
              busy={busy}
              coreError={sessionCollectionError}
              coreState={sessionCollectionState}
              detailError={detailError}
              detailState={detailState}
              turnError={turnError}
              turnState={turnState}
              environmentObservation={environmentObservation}
              sendError={sendError}
              streamError={streamError}
              streamState={streamState}
              onCancel={cancel}
              onCreateSession={createSession}
              onDeleteSession={deleteSessionFromCore}
              onFunctionResult={submitFunctionResult}
              onRefresh={recoverSessionWorkspace}
              onRetrySession={() => {
                if (selectedId) void refreshSelectedSession(selectedId);
              }}
              onRetryStream={retryCurrentStream}
              onRetrieveSession={retrieveSessionForAction}
              onSelect={setSelectedId}
              onSend={sendMessage}
              onUpdateSession={updateSessionMetadata}
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
