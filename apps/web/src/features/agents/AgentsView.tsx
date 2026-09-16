import { Bot, MessageSquare, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { CreateAgentInput, SavedAgent, UpdateAgentInput } from "@agents-core-web/agents-client";

import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import type { CoreConnectionState } from "../../lib/connection";
import { AgentDialog } from "./AgentDialog";
import { AgentForm } from "./AgentForm";
import { AgentSetupView } from "./AgentSetupView";
import { createRequestGate } from "./agent-form";
import { knownSessionAdmissionBlocker } from "./session-admission";

interface AgentsViewProps {
  agents: SavedAgent[];
  busy: boolean;
  coreBaseUrl?: string;
  coreError: string | null;
  coreState: CoreConnectionState;
  createRequest?: number;
  onCreateRequestConsumed?: (request: number) => void;
  onCreate: (input: CreateAgentInput) => Promise<SavedAgent | undefined>;
  onDelete?: (agentId: string) => Promise<void>;
  onRefresh: () => void;
  onRetrieve?: (agentId: string) => Promise<SavedAgent | undefined>;
  onStartSession: (agentId: string) => Promise<void>;
  onUpdate?: (agentId: string, input: UpdateAgentInput) => Promise<SavedAgent | undefined>;
}

type DialogMode = "closed" | "create" | "detail" | "edit" | "delete";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The Agent Core request failed.";
}

function AgentsLoadingSkeleton() {
  return (
    <div className="agents-loading" aria-busy="true" aria-label="Loading Agents">
      <div className="agents-loading-header" />
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="agents-loading-row" key={index}>
          <Skeleton className="skeleton-status" />
          <Skeleton className="skeleton-tile" />
          <Skeleton className="skeleton-agent-name" />
          <Skeleton />
          <Skeleton className="skeleton-model" />
          <Skeleton className="skeleton-age" />
        </div>
      ))}
    </div>
  );
}

function formatShortDate(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(seconds * 1000));
}

function formatTimestamp(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(seconds * 1000));
}

function initial(name: string | null): string {
  return (name?.trim().charAt(0) || "A").toUpperCase();
}

function StructuredValue({ value }: { value: unknown }) {
  return <pre className="agent-structured-value">{JSON.stringify(value, null, 2)}</pre>;
}

function AgentSessionStartAction({
  agent,
  busy,
  onStart,
}: {
  agent: SavedAgent;
  busy: boolean;
  onStart: (agentId: string) => void;
}) {
  const blocker = knownSessionAdmissionBlocker(agent);
  const descriptionId = `start-session-${agent.id}`;
  return (
    <span className="action-tooltip">
      <button
        className="icon-button ghost agent-session-start"
        type="button"
        onClick={() => {
          if (!blocker) onStart(agent.id);
        }}
        disabled={busy}
        aria-disabled={blocker ? true : undefined}
        aria-label={`Start a Session with ${agent.name || "this Agent"}`}
        aria-describedby={descriptionId}
      >
        <MessageSquare size={14} strokeWidth={1.5} />
      </button>
      <span className="action-tooltip-content" role="tooltip" id={descriptionId}>
        {blocker ? `Session unavailable: ${blocker}` : "Start Session"}
      </span>
    </span>
  );
}

export function AgentDetails({ agent }: { agent: SavedAgent }) {
  const blocker = knownSessionAdmissionBlocker(agent);
  return (
    <div className="agent-details">
      <div className="agent-detail-summary">
        <dl>
          <div><dt>ID</dt><dd><code>{agent.id}</code></dd></div>
          <div><dt>Created</dt><dd><time dateTime={new Date(agent.created_at * 1000).toISOString()}>{formatTimestamp(agent.created_at)}</time></dd></div>
          <div><dt>Updated</dt><dd><time dateTime={new Date(agent.updated_at * 1000).toISOString()}>{formatTimestamp(agent.updated_at)}</time></dd></div>
          <div><dt>Model</dt><dd><code>{agent.model}</code></dd></div>
          <div><dt>Name</dt><dd>{agent.name ?? <span className="agent-null-value">Not set</span>}</dd></div>
          <div><dt>Instructions</dt><dd>{agent.instructions ?? <span className="agent-null-value">Not set</span>}</dd></div>
          <div><dt>Metadata</dt><dd><StructuredValue value={agent.metadata} /></dd></div>
        </dl>
      </div>
      <div className="agent-capability-warning" role="note">
        {blocker
          ? `This Agent can be saved, but the known Core Session profile cannot start it: ${blocker}`
          : "Saved advanced configuration is not runtime proof. Model, provider, host, tools, and conditional verbosity still require executor validation."}
      </div>
      <section className="agent-capabilities" aria-labelledby="agent-capabilities-title">
        <h3 id="agent-capabilities-title">Advanced configuration · read only</h3>
        <dl>
          <div><dt>Tools</dt><dd><StructuredValue value={agent.tools} /></dd></div>
          <div><dt>Reasoning</dt><dd><StructuredValue value={agent.reasoning} /></dd></div>
          <div><dt>Text</dt><dd><StructuredValue value={agent.text} /></dd></div>
          <div><dt>Service tier</dt><dd><code>{agent.service_tier}</code></dd></div>
          <div><dt>Multi-agent</dt><dd><StructuredValue value={agent.multi_agent} /></dd></div>
        </dl>
      </section>
    </div>
  );
}

export function AgentDeleteConfirmation({ agent }: { agent: SavedAgent }) {
  return (
    <div className="agent-delete-confirmation">
      <p>Delete <strong>{agent.name || "Untitled Agent"}</strong> from Agent Core?</p>
      <p>This removes the saved Agent only after Core confirms success. Existing Sessions keep their durable Agent snapshots.</p>
    </div>
  );
}

export function AgentsView({
  agents,
  busy,
  coreBaseUrl = "/v1",
  coreError,
  coreState,
  createRequest = 0,
  onCreateRequestConsumed,
  onCreate,
  onDelete,
  onRefresh,
  onRetrieve,
  onStartSession,
  onUpdate,
}: AgentsViewProps) {
  const [mode, setMode] = useState<DialogMode>("closed");
  const [selectedAgent, setSelectedAgent] = useState<SavedAgent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [createSetupRevision, setCreateSetupRevision] = useState(0);
  const requestGate = useRef(createRequestGate());
  const detailActionRef = useRef<HTMLButtonElement>(null);
  const createReturnFocusRef = useRef<HTMLElement | null>(null);
  const restoreDetailFocus = useRef(false);
  const lastCreateRequestRef = useRef(0);
  const knownModels = agents.map((agent) => agent.model);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAgents = normalizedQuery
    ? agents.filter((agent) => [agent.name, agent.model, agent.instructions, agent.id]
      .some((value) => value?.toLowerCase().includes(normalizedQuery)))
    : agents;

  const closeDialog = () => {
    requestGate.current.invalidate();
    restoreDetailFocus.current = false;
    setMode("closed");
    setActionError(null);
    setDetailLoading(false);
  };

  const closeCreateSetup = () => {
    const returnFocus = createReturnFocusRef.current;
    createReturnFocusRef.current = null;
    closeDialog();
    window.requestAnimationFrame(() => {
      if (returnFocus?.isConnected) {
        returnFocus.focus();
        return;
      }
      document.querySelector<HTMLButtonElement>('button[data-create-agent-entry="true"]')?.focus();
    });
  };

  const openCreateSetup = (returnFocus: HTMLElement | null) => {
    requestGate.current.invalidate();
    createReturnFocusRef.current = returnFocus;
    setActionError(null);
    setCreateSetupRevision((current) => current + 1);
    setMode("create");
  };

  const returnToDetail = () => {
    if (busy) return;
    requestGate.current.invalidate();
    restoreDetailFocus.current = true;
    setActionError(null);
    setMode("detail");
  };

  useEffect(() => {
    if (mode !== "detail" || busy || detailLoading || !restoreDetailFocus.current) return;

    const frame = window.requestAnimationFrame(() => {
      detailActionRef.current?.focus();
      restoreDetailFocus.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [busy, detailLoading, mode, selectedAgent]);

  useEffect(() => {
    if (!createRequest || createRequest === lastCreateRequestRef.current) return;
    lastCreateRequestRef.current = createRequest;
    requestGate.current.invalidate();
    createReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActionError(null);
    setCreateSetupRevision((current) => current + 1);
    setMode("create");
    onCreateRequestConsumed?.(createRequest);
  }, [createRequest, onCreateRequestConsumed]);

  const retrieve = async (agent: SavedAgent) => {
    const request = requestGate.current.begin();
    restoreDetailFocus.current = false;
    setSelectedAgent(agent);
    setMode("detail");
    setActionError(null);
    setDetailLoading(true);
    try {
      if (!onRetrieve) throw new Error("Agent retrieval is unavailable for this Agent Core connection.");
      const latest = await onRetrieve(agent.id);
      if (!latest) throw new Error("The Agent detail request was interrupted by a connection change.");
      if (requestGate.current.isCurrent(request)) setSelectedAgent(latest);
    } catch (error) {
      if (requestGate.current.isCurrent(request)) setActionError(errorMessage(error));
    } finally {
      if (requestGate.current.isCurrent(request)) setDetailLoading(false);
    }
  };

  const submitCreate = async (input: CreateAgentInput) => {
    const request = requestGate.current.begin();
    setActionError(null);
    try {
      const created = await onCreate(input);
      return requestGate.current.isCurrent(request) ? created : undefined;
    } catch (error) {
      if (requestGate.current.isCurrent(request)) setActionError(errorMessage(error));
      return undefined;
    }
  };

  const submitUpdate = async (input: CreateAgentInput) => {
    if (!selectedAgent) return;
    const request = requestGate.current.begin();
    setActionError(null);
    try {
      if (!onUpdate) throw new Error("Agent updates are unavailable for this Agent Core connection.");
      const updated = await onUpdate(selectedAgent.id, input);
      if (!updated) throw new Error("The Agent update was interrupted by a connection change.");
      if (!requestGate.current.isCurrent(request)) return;
      setSelectedAgent(updated);
      restoreDetailFocus.current = true;
      setMode("detail");
    } catch (error) {
      if (requestGate.current.isCurrent(request)) setActionError(errorMessage(error));
    }
  };

  const confirmDelete = async () => {
    if (!selectedAgent) return;
    const request = requestGate.current.begin();
    setActionError(null);
    try {
      if (!onDelete) throw new Error("Delete is unavailable for this Agent Core connection.");
      await onDelete(selectedAgent.id);
      if (requestGate.current.isCurrent(request)) closeDialog();
    } catch (error) {
      if (requestGate.current.isCurrent(request)) setActionError(errorMessage(error));
    }
  };

  const startSession = (agentId: string) => {
    void onStartSession(agentId).catch(() => undefined);
  };

  const dialogTitle = mode === "create"
    ? "Create an Agent"
    : mode === "edit"
      ? "Edit Agent"
      : mode === "delete"
        ? "Delete Agent?"
        : selectedAgent?.name || "Agent details";

  if (mode === "create") {
    return (
      <AgentSetupView
        key={createSetupRevision}
        actionError={actionError}
        baseUrl={coreBaseUrl}
        busy={busy}
        knownModels={knownModels}
        onBack={closeCreateSetup}
        onCreate={submitCreate}
        onStartSession={startSession}
      />
    );
  }
  const formId = "edit-agent";

  return (
    <section className="page-section agents-page">
      <header className="page-header">
        <h1>Agents</h1>
        <div className="page-actions">
          <label className="search-control">
            <Search size={14} strokeWidth={1.5} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, model, or ID…"
              aria-label="Search Agents"
              disabled={coreState !== "ready"}
            />
          </label>
          <button className="icon-button outline" type="button" onClick={onRefresh} disabled={coreState === "connecting"} aria-label="Refresh Agents">
            <RefreshCw className={coreState === "connecting" ? "refresh-spinning" : undefined} size={14} strokeWidth={1.5} />
          </button>
          <button data-create-agent-entry="true" className="button primary" type="button" onClick={(event) => openCreateSetup(event.currentTarget)} disabled={busy || coreState !== "ready"}>
            <Plus size={14} strokeWidth={1.5} /> New Agent
          </button>
        </div>
      </header>

      {coreState === "connecting" && !agents.length ? <AgentsLoadingSkeleton /> : null}

      {coreState === "failed" ? (
        <div className="collection-error">
          <ErrorState
            title={agents.length ? "Couldn’t refresh Agents" : "Couldn’t load Agents"}
            description={agents.length
              ? "The last loaded Agent configurations remain available."
              : "The Web could not read Agent configurations from the connected Agent Core."}
            detail={coreError ?? undefined}
            hint="Check the Agent Core connection in the sidebar, then retry."
            onRetry={onRefresh}
          />
        </div>
      ) : null}

      {coreState === "ready" || agents.length ? filteredAgents.length ? (
        <div className="ledger agent-ledger" role="table" aria-label="Agents">
          <div className="ledger-header" role="row">
            <span role="columnheader">Agent</span>
            <span role="columnheader">Model</span>
            <span role="columnheader">Tools</span>
            <span role="columnheader">Updated</span>
            <span role="columnheader" aria-label="Actions" />
          </div>
          <div className="ledger-body" role="rowgroup">
            {filteredAgents.map((agent) => (
              <div className="ledger-row" role="row" key={agent.id}>
                <div className="agent-identity" role="cell">
                  <span className="initial-tile">{initial(agent.name)}</span>
                  <button className="agent-detail-trigger" type="button" onClick={() => void retrieve(agent)} aria-label={`Open details for ${agent.name || "this Agent"}`} disabled={busy}>
                    <strong>{agent.name || "Untitled Agent"}</strong>
                    <small>{agent.instructions || agent.id}</small>
                  </button>
                </div>
                <code className="ledger-model" role="cell" title={agent.model}>{agent.model}</code>
                <span className="ledger-number" role="cell">{agent.tools.length}</span>
                <span className="ledger-age" role="cell">{formatShortDate(agent.updated_at)}</span>
                <span className="ledger-actions" role="cell">
                  <AgentSessionStartAction agent={agent} busy={busy} onStart={startSession} />
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <Bot size={24} strokeWidth={1.5} />
          <h2>{agents.length ? "No matching Agents" : "No saved Agents"}</h2>
          <p>{agents.length ? "Try another name, model, or ID." : "Create a reusable Agent configuration to start a Session."}</p>
          {agents.length ? (
            <button className="button outline" type="button" onClick={() => setQuery("")}>Clear search</button>
          ) : (
            <button data-create-agent-entry="true" className="button primary" type="button" onClick={(event) => openCreateSetup(event.currentTarget)} disabled={busy}>Create Agent</button>
          )}
        </div>
      ) : null}

      <AgentDialog
        open={mode !== "closed"}
        onClose={closeDialog}
        title={dialogTitle}
        footer={mode === "edit" ? (
          <>
            <button key="cancel-form" className="button outline" type="button" onClick={returnToDetail} disabled={busy}>Cancel</button>
            <button key="submit-form" className="button primary" type="submit" form={formId} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </>
        ) : mode === "detail" ? (
          <>
            <button key="open-delete" className="button danger" type="button" onClick={() => { requestGate.current.invalidate(); restoreDetailFocus.current = false; setActionError(null); setMode("delete"); }} disabled={busy || detailLoading}>
              <Trash2 size={14} strokeWidth={1.5} /> Delete
            </button>
            <button ref={detailActionRef} key="open-edit" className="button primary" type="button" onClick={() => { requestGate.current.invalidate(); restoreDetailFocus.current = false; setActionError(null); setMode("edit"); }} disabled={busy || detailLoading || Boolean(actionError)}>
              <Pencil size={14} strokeWidth={1.5} /> Edit
            </button>
          </>
        ) : mode === "delete" ? (
          <>
            <button key="cancel-delete" className="button outline" type="button" onClick={returnToDetail} disabled={busy}>Cancel</button>
            <button key="confirm-delete" className="button danger" type="button" onClick={() => void confirmDelete()} disabled={busy} autoFocus>
              {busy ? "Deleting…" : "Delete Agent"}
            </button>
          </>
        ) : null}
      >
        {actionError ? (
          <div className="agent-action-error" role="alert">
            <strong>Request failed</strong>
            <span>{actionError}</span>
            {mode === "detail" && selectedAgent ? <button className="button outline" type="button" onClick={() => void retrieve(selectedAgent)}>Retry latest Agent</button> : null}
          </div>
        ) : null}
        {mode === "edit" && selectedAgent ? (
          <AgentForm key={`${selectedAgent.id}:${selectedAgent.updated_at}`} agent={selectedAgent} formId={formId} knownModels={knownModels} onSubmit={submitUpdate} />
        ) : mode === "delete" && selectedAgent ? (
          <AgentDeleteConfirmation agent={selectedAgent} />
        ) : selectedAgent ? (
          <>
            {detailLoading ? <p className="agent-detail-loading" aria-live="polite">Retrieving the latest saved Agent…</p> : null}
            <AgentDetails agent={selectedAgent} />
          </>
        ) : null}
      </AgentDialog>
    </section>
  );
}
