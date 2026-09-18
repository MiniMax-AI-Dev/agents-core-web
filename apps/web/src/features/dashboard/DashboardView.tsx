import { AlertTriangle, RefreshCw } from "lucide-react";
import { useMemo } from "react";

import type { AgentSession, SavedAgent } from "@agents-core-web/agents-client";

import { StatusIcon, type StatusKind } from "../../components/StatusIcon";
import {
  buildDashboardSnapshot,
  dashboardEnvironmentLabel,
  dashboardStatusLabel,
  formatDashboardTimestamp,
  type DashboardCollectionState,
  type DashboardSessionRow,
} from "./dashboard-model";
import "./DashboardView.css";

export interface DashboardViewProps {
  agents: readonly SavedAgent[];
  sessions: readonly AgentSession[];
  agentCollectionState: DashboardCollectionState;
  agentCollectionError: string | null;
  agentCollectionHasSnapshot: boolean;
  sessionCollectionState: DashboardCollectionState;
  sessionCollectionError: string | null;
  sessionCollectionHasSnapshot: boolean;
  onRefresh: () => void;
  onOpenSession: (sessionId: string) => void;
}

function collectionHasSnapshot(state: DashboardCollectionState, hasSnapshot: boolean): boolean {
  return state === "ready" || hasSnapshot;
}

function collectionStatusKind(state: DashboardCollectionState): StatusKind {
  if (state === "ready") return "completed";
  if (state === "failed") return "failed";
  return "running";
}

function CollectionStateRow({
  label,
  state,
  error,
  count,
  hasSnapshot,
}: {
  label: string;
  state: DashboardCollectionState;
  error: string | null;
  count: number;
  hasSnapshot: boolean;
}) {
  const snapshotAvailable = collectionHasSnapshot(state, hasSnapshot);
  const description = state === "ready"
    ? `Loaded ${count.toLocaleString("en-US")} record${count === 1 ? "" : "s"} · reached Core end marker`
    : state === "connecting"
      ? snapshotAvailable ? "Refreshing · last loaded result remains visible" : "Loading from Agent Core"
      : snapshotAvailable ? "Refresh failed · last loaded result remains visible" : "Unavailable";
  return (
    <div
      className={`dashboard-collection-state dashboard-collection-state-${state}`}
      role={state === "failed" ? "alert" : "status"}
    >
      <StatusIcon status={collectionStatusKind(state)} title={`${label} collection ${state}`} />
      <strong>{label}</strong>
      <span>{description}</span>
      {state === "failed" ? <small>{error || "The Agent Core collection request failed."}</small> : null}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      <small>{detail}</small>
    </div>
  );
}

function SessionLedger({
  label,
  sessions,
  onOpenSession,
}: {
  label: string;
  sessions: readonly DashboardSessionRow[];
  onOpenSession: (sessionId: string) => void;
}) {
  return (
    <div className="dashboard-session-ledger" role="table" aria-label={label}>
      <div className="dashboard-session-ledger-header" role="row">
        <span role="columnheader">Session</span>
        <span role="columnheader">Agent</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Environment</span>
        <span role="columnheader">Last active</span>
        <span role="columnheader">Tokens</span>
      </div>
      {sessions.map((session, index) => (
        <div className="dashboard-session-ledger-row" role="row" key={`${session.id ?? "unavailable"}:${index}`}>
          <span className="dashboard-session-identity" role="cell">
            <button
              type="button"
              disabled={session.id === null}
              onClick={() => {
                if (session.id !== null) onOpenSession(session.id);
              }}
            >
              {session.title}
            </button>
            <code>{session.id ?? "Unavailable"}</code>
          </span>
          <span className="dashboard-session-agent" role="cell">
            <strong>{session.agentLabel}</strong>
            <code>{session.model}</code>
          </span>
          <span className={`dashboard-session-status dashboard-session-status-${session.status}`} role="cell">
            {dashboardStatusLabel(session.status)}
          </span>
          <span
            role="cell"
            title={session.environmentProfile === "self_hosted"
              ? "This is a Session profile, not proof that an executor is connected."
              : session.environmentProfile === "openai_hosted"
                ? "Core owns this managed placement; the label is not proof that its Runtime is ready."
                : undefined}
          >
            {dashboardEnvironmentLabel(session.environmentProfile)}
          </span>
          <span role="cell">
            {session.lastActiveAt === null ? "Unknown" : (
              <time dateTime={new Date(session.lastActiveAt * 1_000).toISOString()}>
                {formatDashboardTimestamp(session.lastActiveAt)}
              </time>
            )}
          </span>
          <span className="dashboard-session-tokens" role="cell">
            {session.totalTokens === null ? "Unknown" : session.totalTokens.toLocaleString("en-US")}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DashboardView({
  agents,
  sessions,
  agentCollectionState,
  agentCollectionError,
  agentCollectionHasSnapshot,
  sessionCollectionState,
  sessionCollectionError,
  sessionCollectionHasSnapshot,
  onRefresh,
  onOpenSession,
}: DashboardViewProps) {
  const snapshot = useMemo(() => buildDashboardSnapshot(agents, sessions), [agents, sessions]);
  const agentsAvailable = collectionHasSnapshot(agentCollectionState, agentCollectionHasSnapshot);
  const sessionsAvailable = collectionHasSnapshot(sessionCollectionState, sessionCollectionHasSnapshot);
  const refreshing = agentCollectionState === "connecting" || sessionCollectionState === "connecting";
  const usageDetail = !sessionsAvailable
    ? "Session page-chain result unavailable."
    : snapshot.usage.reportedSessionCount === 0
      ? "No loaded Session reports aggregate Usage."
      : `${snapshot.usage.reportedSessionCount.toLocaleString("en-US")} of ${snapshot.loadedSessionCount.toLocaleString("en-US")} loaded Sessions report aggregate Usage.`;
  const statusEntries = [
    ["Idle", snapshot.statusCounts.idle],
    ["In progress", snapshot.statusCounts.in_progress],
    ["Requires action", snapshot.statusCounts.requires_action],
    ["Failed", snapshot.statusCounts.failed],
    ...(snapshot.statusCounts.unknown > 0 ? [["Unavailable", snapshot.statusCounts.unknown]] : []),
  ] as const;

  return (
    <section className="page-section dashboard-page" aria-labelledby="dashboard-heading">
      <header className="page-header">
        <h1 id="dashboard-heading">Dashboard <span>Loaded Core results</span></h1>
        <div className="page-actions">
          <button
            className="button outline"
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh Dashboard snapshot"
          >
            <RefreshCw className={refreshing ? "refresh-spinning" : undefined} size={14} strokeWidth={1.5} aria-hidden="true" />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="dashboard-scroll">
        <div className="dashboard-intro">
          <h2>Core resources at a glance</h2>
          <p>
            This page summarizes the last successfully traversed Agent and Session page-chain results from the
            connected Core. A ready result reached Core&apos;s end marker within the 100-page safety limit, but the
            independent page reads are not an atomic snapshot or a current Core total. A refresh is rejected
            instead of publishing its partial result if pagination cannot reach the end marker.
            API access, saved configuration, and Session admission do not prove worker, executor, model, provider,
            Function, or MCP readiness.
          </p>
        </div>

        <section className="dashboard-collection-section" aria-labelledby="dashboard-collection-heading">
          <h2 id="dashboard-collection-heading">Loaded page-chain results</h2>
          <div className="dashboard-collection-states">
            <CollectionStateRow
              label="Agents"
              state={agentCollectionState}
              error={agentCollectionError}
              count={agents.length}
              hasSnapshot={agentCollectionHasSnapshot}
            />
            <CollectionStateRow
              label="Sessions"
              state={sessionCollectionState}
              error={sessionCollectionError}
              count={sessions.length}
              hasSnapshot={sessionCollectionHasSnapshot}
            />
          </div>
        </section>

        <dl className="dashboard-summary" aria-label="Loaded resource summary">
          <Metric
            label="Loaded Agents"
            value={agentsAvailable ? snapshot.loadedAgentCount.toLocaleString("en-US") : "Unavailable"}
            detail="Count applies only to the last loaded page-chain result, not a current Core total; failed or incomplete refreshes keep the previous result."
          />
          <Metric
            label="Loaded Sessions"
            value={sessionsAvailable ? snapshot.loadedSessionCount.toLocaleString("en-US") : "Unavailable"}
            detail="Count applies only to the last loaded page-chain result, not a current Core total; failed or incomplete refreshes keep the previous result."
          />
          <Metric
            label="Reported aggregate tokens"
            value={!sessionsAvailable || snapshot.usage.totalTokens === null
              ? "Unknown"
              : snapshot.usage.totalTokens.toLocaleString("en-US")}
            detail={usageDetail}
          />
        </dl>

        <section className="dashboard-section" aria-labelledby="dashboard-status-heading">
          <header>
            <h2 id="dashboard-status-heading">Session status</h2>
            <p>Exact statuses from the loaded Session page-chain result; Idle is not relabelled as Completed.</p>
          </header>
          {sessionsAvailable ? (
            <div className="dashboard-status-ledger" role="list" aria-label="Loaded Session status counts">
              {statusEntries.map(([label, count]) => (
                <div role="listitem" key={label}>
                  <span>{label}</span>
                  <strong>{count.toLocaleString("en-US")}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="dashboard-unavailable"><AlertTriangle size={14} aria-hidden="true" />Session status is unavailable.</p>
          )}
        </section>

        <section className="dashboard-section" aria-labelledby="dashboard-attention-heading">
          <header>
            <h2 id="dashboard-attention-heading">Needs attention</h2>
            <p>Loaded Sessions that require an action or report a failed status.</p>
          </header>
          {!sessionsAvailable ? (
            <p className="dashboard-unavailable"><AlertTriangle size={14} aria-hidden="true" />Session page-chain result is unavailable.</p>
          ) : snapshot.attentionSessions.length ? (
            <SessionLedger label="Sessions needing attention" sessions={snapshot.attentionSessions} onOpenSession={onOpenSession} />
          ) : (
            <p className="dashboard-empty">No Sessions in the loaded result require attention.</p>
          )}
        </section>

        <section className="dashboard-section dashboard-recent" aria-labelledby="dashboard-recent-heading">
          <header>
            <h2 id="dashboard-recent-heading">Recent Sessions</h2>
            <p>Up to eight loaded Sessions ordered by valid Core-reported last activity.</p>
          </header>
          {!sessionsAvailable ? (
            <p className="dashboard-unavailable"><AlertTriangle size={14} aria-hidden="true" />Recent Sessions are unavailable.</p>
          ) : snapshot.recentSessions.length ? (
            <SessionLedger label="Recent Sessions" sessions={snapshot.recentSessions} onOpenSession={onOpenSession} />
          ) : (
            <p className="dashboard-empty">No Sessions in the loaded result.</p>
          )}
        </section>
      </div>
    </section>
  );
}
