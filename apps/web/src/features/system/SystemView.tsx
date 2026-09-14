import { Cpu, ExternalLink, Layers3, Server } from "lucide-react";

import { StatusIcon } from "../../components/StatusIcon";

const layers = [
  {
    number: "01",
    title: "Open web experience",
    owner: "This repository",
    icon: Layers3,
    active: true,
    items: ["Agent library", "Session workspace", "Items & actions", "Reconnect recovery"],
  },
  {
    number: "02",
    title: "Agents API core",
    owner: "Reuse Parsar Core",
    icon: Server,
    active: true,
    items: ["Auth & schema", "Session / Turn control", "Durable Turns & Items", "Runtime scheduling"],
  },
  {
    number: "03",
    title: "Execution layer",
    owner: "Reuse native adapters",
    icon: Cpu,
    active: true,
    items: ["parsar-daemon", "Codex / Claude", "Workspace & tools", "MCP / model APIs"],
  },
];

export function SystemView() {
  return (
    <section className="page-section architecture-page">
      <header className="page-header">
        <h1>Architecture <span>Open Agent API</span></h1>
        <div className="page-actions">
          <a
            className="button outline"
            href="https://developers.openai.com/api/docs/guides/agents-api/overview"
            target="_blank"
            rel="noreferrer"
          >
            API guide <ExternalLink size={14} strokeWidth={1.5} />
          </a>
        </div>
      </header>

      <div className="architecture-intro">
        <h2>One web. Any compatible core.</h2>
        <p>The browser speaks one resource contract; environments and harnesses stay behind the independently deployed core.</p>
      </div>

      <div className="architecture-ledger" role="table" aria-label="System layers">
        <div className="architecture-ledger-header" role="row">
          <span role="columnheader">Layer</span>
          <span role="columnheader">Component</span>
          <span role="columnheader">Ownership</span>
          <span role="columnheader">Responsibilities</span>
        </div>
        {layers.map((layer) => {
          const Icon = layer.icon;
          return (
            <div className="architecture-ledger-row" role="row" key={layer.number}>
              <span className="architecture-layer-index" role="cell">{layer.number}</span>
              <span className="architecture-component" role="cell">
                <Icon size={15} strokeWidth={1.5} />
                <strong>{layer.title}</strong>
              </span>
              <span className="architecture-owner" role="cell">{layer.owner}</span>
              <span className="architecture-responsibilities" role="cell">{layer.items.join(" · ")}</span>
            </div>
          );
        })}
      </div>

      <div className="provider-section">
        <header>
          <h2>Compatible by adapter, never by assumption.</h2>
          <p>Each provider must prove lifecycle, lease, cancellation, persistence, and recovery semantics in the core.</p>
        </header>
        <div className="provider-ledger" role="list" aria-label="Environment providers">
          <div className="provider-row" role="listitem"><StatusIcon status="completed" title="Available" /><strong>None</strong><span>Available in the initial slice</span></div>
          <div className="provider-row" role="listitem"><StatusIcon status="queued" title="Planned" /><strong>Docker</strong><span>Future Parsar Core adapter</span></div>
          <div className="provider-row" role="listitem"><StatusIcon status="queued" title="Planned" /><strong>E2B</strong><span>Future Parsar Core adapter</span></div>
          <div className="provider-row" role="listitem"><StatusIcon status="queued" title="Planned" /><strong>AgentCore</strong><span>Future Parsar Core adapter</span></div>
        </div>
      </div>
    </section>
  );
}
