import { Bot, ChevronDown, ChevronUp, MessageSquare, PanelsTopLeft, Plus } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { SavedAgent } from "@agents-core-web/agents-client";

import type { VaultCatalog } from "../vaults/vault-catalog";
import { sessionAdmissionBlocker } from "./session-admission";
import { AGENT_TEMPLATES, type AgentTemplate } from "./agent-templates";

import "./AgentCatalog.css";

const useIsomorphicLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

export function twoRowSavedAgentCapacity(columnCount: number): number {
  return Math.max(1, Math.floor(columnCount) * 2 - 1);
}

function resolvedGridColumnCount(grid: HTMLElement): number {
  const template = window.getComputedStyle(grid).gridTemplateColumns.trim();
  if (!template || template === "none") return 1;
  return Math.max(1, template.split(/\s+/u).length);
}

function formatShortDate(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(seconds * 1000));
}

function AgentSessionStartAction({
  agent,
  busy,
  onStart,
  vaultCatalog,
}: {
  agent: SavedAgent;
  busy: boolean;
  onStart: (agentId: string) => void;
  vaultCatalog: VaultCatalog | null;
}) {
  const blocker = sessionAdmissionBlocker(agent, vaultCatalog);
  const descriptionId = useId();
  return (
    <span className="action-tooltip">
      <button
        className="button outline agent-session-start"
        type="button"
        onClick={() => {
          if (!blocker) onStart(agent.id);
        }}
        disabled={busy}
        aria-disabled={blocker ? true : undefined}
        aria-label={`Start a Session with ${agent.name || "Untitled Agent"} (${agent.id})`}
        aria-describedby={blocker ? descriptionId : undefined}
      >
        <MessageSquare size={14} strokeWidth={1.5} aria-hidden="true" />
        <span>{blocker ? "Unavailable" : "Start Session"}</span>
      </button>
      {blocker ? (
        <span className="action-tooltip-content" role="tooltip" id={descriptionId}>
          Session unavailable: {blocker}
        </span>
      ) : null}
    </span>
  );
}

export function AgentCatalog({
  agents,
  busy,
  coreReady,
  hasSavedAgents,
  openingAgentId,
  vaultCatalog,
  onClearSearch,
  onCreate,
  onEdit,
  onExpandedChange,
  onStartSession,
  onUseTemplate,
  expanded,
  isFiltering,
}: {
  agents: SavedAgent[];
  busy: boolean;
  coreReady: boolean;
  expanded: boolean;
  hasSavedAgents: boolean;
  isFiltering: boolean;
  openingAgentId: string | null;
  vaultCatalog: VaultCatalog | null;
  onClearSearch: () => void;
  onCreate: (returnFocus: HTMLButtonElement) => void;
  onEdit: (agent: SavedAgent, returnFocus: HTMLButtonElement) => void;
  onExpandedChange: (expanded: boolean) => void;
  onStartSession: (agentId: string) => void;
  onUseTemplate: (template: AgentTemplate, returnFocus: HTMLButtonElement) => void;
}) {
  const interactionDisabled = busy;
  const gridId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);
  const savedCapacity = twoRowSavedAgentCapacity(columnCount);
  const canExpand = !isFiltering && agents.length > savedCapacity;
  const visibleAgents = isFiltering || expanded ? agents : agents.slice(0, savedCapacity);
  const hiddenAgentCount = Math.max(0, agents.length - savedCapacity);

  useIsomorphicLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const updateColumnCount = () => {
      const next = resolvedGridColumnCount(grid);
      setColumnCount((current) => current === next ? current : next);
    };
    updateColumnCount();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateColumnCount);
      return () => window.removeEventListener("resize", updateColumnCount);
    }

    const observer = new ResizeObserver(updateColumnCount);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="agents-catalog-scroll">
      <section className="agent-catalog-section" aria-labelledby="saved-agents-heading">
        <h2 id="saved-agents-heading">Agents</h2>
        <div ref={gridRef} id={gridId} className="agent-card-grid" role="list" aria-label="Agents" aria-busy={openingAgentId ? true : undefined}>
          <div className="agent-catalog-slot" role="listitem">
            <button
              className="agent-catalog-card agent-create-card"
              type="button"
              data-create-agent-entry="true"
              onClick={(event) => onCreate(event.currentTarget)}
              disabled={!coreReady || interactionDisabled}
            >
              <span className="agent-card-icon"><Plus size={19} strokeWidth={1.7} aria-hidden="true" /></span>
              <strong>Create agent</strong>
              <span className="agent-card-description">Describe the tasks you want the Agent to perform when it runs.</span>
            </button>
          </div>
          {visibleAgents.map((agent) => (
            <article className="agent-catalog-card agent-saved-card" role="listitem" key={agent.id}>
              <button
                className="agent-card-main"
                type="button"
                onClick={(event) => onEdit(agent, event.currentTarget)}
                disabled={interactionDisabled || openingAgentId === agent.id}
                aria-label={`Edit ${agent.name || "Untitled Agent"} (${agent.id})`}
                data-agent-id={agent.id}
              >
                <span className="agent-card-icon"><Bot size={18} strokeWidth={1.7} aria-hidden="true" /></span>
                <strong>{agent.name || "Untitled Agent"}</strong>
                <span className="agent-card-description">{agent.instructions || "No instructions yet."}</span>
                <span className="agent-card-meta">
                  <code>{agent.model}</code>
                  <span>{agent.tools.length} {agent.tools.length === 1 ? "tool" : "tools"}</span>
                  <time dateTime={new Date(agent.updated_at * 1000).toISOString()}>{formatShortDate(agent.updated_at)}</time>
                </span>
                {openingAgentId === agent.id ? <span className="agent-card-opening" role="status">Opening latest definition…</span> : null}
              </button>
              <footer>
                <AgentSessionStartAction
                  agent={agent}
                  busy={interactionDisabled}
                  onStart={onStartSession}
                  vaultCatalog={vaultCatalog}
                />
              </footer>
            </article>
          ))}
        </div>
        {canExpand ? (
          <div className="agent-catalog-more">
            <span>{expanded ? `Showing all ${agents.length} saved Agents` : `${hiddenAgentCount} more saved ${hiddenAgentCount === 1 ? "Agent" : "Agents"}`}</span>
            <button
              className="button outline"
              type="button"
              aria-controls={gridId}
              aria-expanded={expanded}
              onClick={() => onExpandedChange(!expanded)}
            >
              {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              {expanded ? "Show less" : `Show ${hiddenAgentCount} more`}
            </button>
          </div>
        ) : null}
        {!agents.length ? (
          <div className="agent-catalog-empty" role="status">
            <strong>{hasSavedAgents ? "No matching Agents" : "No saved Agents"}</strong>
            <span>{hasSavedAgents ? "Try another name, model, or ID." : "Start from a blank Agent or choose a starter template below."}</span>
            {hasSavedAgents ? <button className="button outline" type="button" onClick={onClearSearch}>Clear search</button> : null}
          </div>
        ) : null}
      </section>

      <section className="agent-catalog-section agent-template-section" aria-labelledby="agent-templates-heading">
        <header>
          <div>
            <h2 id="agent-templates-heading">Starter templates</h2>
            <p>Prompt starters only. Add and verify any tools separately.</p>
          </div>
        </header>
        <div className="agent-template-grid" role="list" aria-label="Agent starter templates">
          {AGENT_TEMPLATES.map((template) => (
            <div className="agent-catalog-slot" role="listitem" key={template.id}>
              <button
                className="agent-catalog-card agent-template-card"
                type="button"
                data-agent-template-id={template.id}
                onClick={(event) => onUseTemplate(template, event.currentTarget)}
                disabled={!coreReady || interactionDisabled}
                aria-label={`Use ${template.name} template`}
              >
                <span className="agent-card-icon"><PanelsTopLeft size={18} strokeWidth={1.7} aria-hidden="true" /></span>
                <strong>{template.name}</strong>
                <span className="agent-card-description">{template.description}</span>
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
