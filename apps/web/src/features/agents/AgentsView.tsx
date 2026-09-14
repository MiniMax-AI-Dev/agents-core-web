import { Bot, Info, MessageSquare, Plus, RefreshCw, Search } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { CreateAgentInput, SavedAgent } from "@agents-core-web/agents-client";

import { ErrorState } from "../../components/ErrorState";
import { Modal } from "../../components/Modal";
import { Skeleton } from "../../components/Skeleton";
import type { CoreConnectionState } from "../../lib/connection";
import {
  buildModelOptionGroups,
  CUSTOM_MODEL_OPTION,
  modelIdFromOption,
  modelOptionValue,
} from "../../lib/model-options";

interface AgentsViewProps {
  agents: SavedAgent[];
  busy: boolean;
  coreError: string | null;
  coreState: CoreConnectionState;
  onCreate: (input: CreateAgentInput) => Promise<void>;
  onRefresh: () => void;
  onStartSession: (agentId: string) => Promise<void>;
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

function formatDate(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(seconds * 1000));
}

function initial(name: string | null): string {
  return (name?.trim().charAt(0) || "A").toUpperCase();
}

export function AgentsView({
  agents,
  busy,
  coreError,
  coreState,
  onCreate,
  onRefresh,
  onStartSession,
}: AgentsViewProps) {
  const modelOptions = buildModelOptionGroups(
    agents.map((agent) => agent.model),
    import.meta.env.VITE_AGENT_MODEL_PRESETS,
    import.meta.env.VITE_AGENT_DEFAULT_MODEL,
  );
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [modelChoice, setModelChoice] = useState(modelOptionValue(modelOptions.defaultModel));
  const [customModel, setCustomModel] = useState("");
  const [instructions, setInstructions] = useState("");
  const [query, setQuery] = useState("");
  const selectedModel = modelIdFromOption(modelChoice);
  const model = modelChoice === CUSTOM_MODEL_OPTION ? customModel.trim() : selectedModel ?? "";

  const normalizedQuery = query.trim().toLowerCase();
  const filteredAgents = normalizedQuery
    ? agents.filter((agent) => [agent.name, agent.model, agent.instructions, agent.id]
      .some((value) => value?.toLowerCase().includes(normalizedQuery)))
    : agents;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (coreState !== "ready" || !model.trim()) return;
    try {
      await onCreate({
        model: model.trim(),
        name: name.trim() || null,
        instructions: instructions.trim() || null,
      });
    } catch {
      return;
    }
    setName("");
    setModelChoice(modelOptionValue(modelOptions.defaultModel));
    setCustomModel("");
    setInstructions("");
    setOpen(false);
  };

  const startSession = (agentId: string) => {
    void onStartSession(agentId).catch(() => undefined);
  };

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
          <button className="button primary" type="button" onClick={() => setOpen(true)} disabled={coreState !== "ready"}>
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
                  <span className="agent-copy">
                    <strong>{agent.name || "Untitled Agent"}</strong>
                    <small>{agent.instructions || agent.id}</small>
                  </span>
                </div>
                <code className="ledger-model" role="cell" title={agent.model}>{agent.model}</code>
                <span className="ledger-number" role="cell">{agent.tools.length}</span>
                <span className="ledger-age" role="cell">{formatDate(agent.updated_at)}</span>
                <span className="ledger-actions" role="cell">
                  <span className="action-tooltip">
                    <button
                      className="icon-button ghost"
                      type="button"
                      onClick={() => startSession(agent.id)}
                      disabled={busy}
                      aria-label={`Start a Session with ${agent.name || "this Agent"}`}
                      aria-describedby={`start-session-${agent.id}`}
                    >
                      <MessageSquare size={14} strokeWidth={1.5} />
                    </button>
                    <span className="action-tooltip-content" role="tooltip" id={`start-session-${agent.id}`}>Start Session</span>
                  </span>
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
            <button className="button primary" type="button" onClick={() => setOpen(true)}>Create Agent</button>
          )}
        </div>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create an Agent"
        footer={
          <>
            <button className="button outline" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="button primary" type="submit" form="create-agent" disabled={busy || coreState !== "ready" || !model.trim()}>
              {busy ? "Creating…" : "Create Agent"}
            </button>
          </>
        }
      >
        <form id="create-agent" className="form-stack" onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Repository builder" />
          </label>
          <div className="field">
            <label className="field-label" htmlFor="create-agent-model">
              <span>Model</span>
              <span className="field-optional">Web suggestions</span>
            </label>
            <select
              id="create-agent-model"
              value={modelChoice}
              onChange={(event) => setModelChoice(event.target.value)}
              aria-describedby="create-agent-model-help create-agent-model-note"
              required
            >
              <optgroup label="Configured suggestions">
                {modelOptions.configured.map((modelId) => (
                  <option value={modelOptionValue(modelId)} key={modelId}>
                    {modelId}{modelId === modelOptions.defaultModel ? " · Default" : ""}
                  </option>
                ))}
              </optgroup>
              {modelOptions.previouslyUsed.length ? (
                <optgroup label="Previously used by saved Agents">
                  {modelOptions.previouslyUsed.map((modelId) => (
                    <option value={modelOptionValue(modelId)} key={modelId}>{modelId}</option>
                  ))}
                </optgroup>
              ) : null}
              <option value={CUSTOM_MODEL_OPTION}>Custom model ID…</option>
            </select>
            <small id="create-agent-model-help">
              Start with the Web default, choose a previously used ID, or enter one configured for your runtime.
            </small>
          </div>
          {modelChoice === CUSTOM_MODEL_OPTION ? (
            <label className="field">
              <span>Custom model ID</span>
              <input
                value={customModel}
                onChange={(event) => setCustomModel(event.target.value)}
                placeholder="provider/model-name"
                spellCheck={false}
                autoFocus
                aria-describedby="create-agent-model-note"
                required
              />
            </label>
          ) : null}
          <div className="model-picker-note" id="create-agent-model-note" role="note">
            <Info size={14} strokeWidth={1.5} aria-hidden="true" />
            <span>
              These options are Web-side suggestions, not live discovery. The connected runtime decides whether{" "}
              <code>{model || "your custom model ID"}</code> can execute.
            </span>
          </div>
          <label className="field">
            <span>Instructions</span>
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Describe how this Agent should work…"
              rows={5}
            />
          </label>
        </form>
      </Modal>
    </section>
  );
}
