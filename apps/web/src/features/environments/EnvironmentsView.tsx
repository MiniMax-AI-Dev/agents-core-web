import { AlertCircle, Eye, FileBox, KeyRound, Search } from "lucide-react";
import { useState } from "react";

import type {
  AgentSession,
  EnvironmentConnectionAction,
  SelfHostedAgentEnvironment,
} from "@agents-core-web/agents-client";

import { EnvironmentPanel } from "../sessions/environment/EnvironmentPanel";
import {
  environmentIdsMatch,
  type EnvironmentObservation,
  type ScopedEnvironmentObservation,
} from "../sessions/environment/environment-state";

export interface ObservedEnvironment {
  environment: SelfHostedAgentEnvironment;
  observation: EnvironmentObservation | null;
  session: AgentSession;
}

function isSelfHostedEnvironment(environment: unknown): environment is SelfHostedAgentEnvironment {
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) return false;
  const value = environment as Record<string, unknown>;
  return value.type === "self_hosted" &&
    typeof value.id === "string" &&
    typeof value.remote_url === "string" &&
    typeof value.workspace_directory === "string" &&
    Array.isArray(value.capability_directories) &&
    value.capability_directories.every((entry) => typeof entry === "string");
}

function connectionActions(session: AgentSession): EnvironmentConnectionAction[] {
  const actions: unknown = session.required_actions;
  if (!Array.isArray(actions)) return [];
  return actions.filter((action): action is EnvironmentConnectionAction => (
    action !== null &&
    typeof action === "object" &&
    (action as Record<string, unknown>).type === "environment_connection" &&
    typeof (action as Record<string, unknown>).environment_id === "string"
  ));
}

export function observedEnvironments(
  sessions: AgentSession[],
  observations: ReadonlyMap<string, ScopedEnvironmentObservation>,
): ObservedEnvironment[] {
  return sessions.flatMap((session) => {
    const environment: unknown = session.environment;
    if (!isSelfHostedEnvironment(environment)) return [];
    const scoped = observations.get(session.id);
    const observation = scoped?.sessionId === session.id &&
      environmentIdsMatch(scoped.observation.environmentId, environment.id)
      ? scoped.observation
      : null;
    return [{ environment, observation, session }];
  });
}

export function EnvironmentsView({
  observations,
  onOpenSession,
  sessions,
}: {
  observations: ReadonlyMap<string, ScopedEnvironmentObservation>;
  onOpenSession: (sessionId: string) => void;
  sessions: AgentSession[];
}) {
  const [query, setQuery] = useState("");
  const allObserved = observedEnvironments(sessions, observations);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery ? allObserved.filter(({ environment, session }) => [
    environment.id,
    environment.workspace_directory,
    environment.remote_url,
    session.id,
    session.agent.name,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery))) : allObserved;

  return (
    <section className="page-section environments-page">
      <header className="page-header environments-header">
        <div>
          <h1>Environments <span>Observed</span></h1>
          <p>Session-scoped self-hosted projections from the currently loaded Core data.</p>
        </div>
        <label className="search-control">
          <Search size={14} strokeWidth={1.5} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Environment, Session, or path…"
            aria-label="Search observed Environments"
          />
        </label>
      </header>

      <div className="environments-scroll">
        <section className="environment-catalog-boundary" role="note" aria-label="Environment catalog boundary">
          <AlertCircle size={16} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <strong>Not an exhaustive Environment catalog</strong>
            <p>
              Agent Core exposes retrieval by ID, not list. This view derives only from {sessions.length} currently loaded Session{sessions.length === 1 ? "" : "s"}; absent Environments remain unknown.
            </p>
          </div>
        </section>

        <section className="environment-unavailable-grid" aria-label="Unavailable Environment APIs">
          <article>
            <FileBox size={17} strokeWidth={1.5} aria-hidden="true" />
            <div><strong>Environment templates</strong><span>Unavailable</span></div>
            <p>The connected Core contract has no template create, list, retrieve, update, or delete API.</p>
          </article>
          <article>
            <KeyRound size={17} strokeWidth={1.5} aria-hidden="true" />
            <div><strong>Environment keys</strong><span>Operator-owned</span></div>
            <p>Executor credentials are issued outside the browser. No secret is created, stored, or displayed here.</p>
          </article>
        </section>

        <section className="observed-environments" aria-labelledby="observed-environments-title">
          <header>
            <div>
              <h2 id="observed-environments-title">Observed self-hosted Environments</h2>
              <p>Durable Session projection plus the latest matching Environment observation already read by this Web.</p>
            </div>
            <span>{visible.length}{normalizedQuery ? ` of ${allObserved.length}` : ""}</span>
          </header>

          {visible.length ? (
            <div className="observed-environment-list">
              {visible.map(({ environment, observation, session }) => (
                <article className="observed-environment" key={`${session.id}:${environment.id}`}>
                  <header>
                    <div>
                      <strong>{session.agent.name || "Untitled Agent"}</strong>
                      <span>Session <code>{session.id}</code></span>
                    </div>
                    <button className="button outline" type="button" onClick={() => onOpenSession(session.id)}>
                      <Eye size={13} strokeWidth={1.5} aria-hidden="true" />
                      Open Session
                    </button>
                  </header>
                  <EnvironmentPanel
                    environment={environment}
                    observation={observation}
                    connectionActions={connectionActions(session)}
                  />
                </article>
              ))}
            </div>
          ) : (
            <div className="environment-overview-empty">
              <Eye size={22} strokeWidth={1.5} aria-hidden="true" />
              <h3>{allObserved.length ? "No matching observed Environments" : "No self-hosted Environment is currently observed"}</h3>
              <p>
                {allObserved.length
                  ? "Try another Environment ID, Session ID, or Workspace path."
                  : "Loaded environment:none Sessions do not appear here. This is not proof that Core has no other Environments."}
              </p>
              {allObserved.length ? <button className="button outline" type="button" onClick={() => setQuery("")}>Clear search</button> : null}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
