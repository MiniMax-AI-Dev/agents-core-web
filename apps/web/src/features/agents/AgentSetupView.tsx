import { Check, ChevronRight, Circle, Code2, MessageSquare } from "lucide-react";
import { useState } from "react";

import type { CreateAgentInput, SavedAgent } from "@agents-core-web/agents-client";

import { AgentForm } from "./AgentForm";
import { buildAgentRequestPreview } from "./agent-preview";
import { valuesFromAgent } from "./agent-form";
import { knownSessionAdmissionBlocker } from "./session-admission";

function AgentRequestPreview({
  baseUrl,
  values,
}: {
  baseUrl: string;
  values: ReturnType<typeof valuesFromAgent>;
}) {
  const preview = buildAgentRequestPreview(values, baseUrl);
  return (
    <section className="agent-request-preview" aria-labelledby="agent-request-preview-title">
      <header>
        <Code2 size={15} strokeWidth={1.5} aria-hidden="true" />
        <div>
          <h2 id="agent-request-preview-title">Request preview</h2>
          <p>Uses placeholders only. The connected Core credential is never read into this preview.</p>
        </div>
      </header>
      <div className="agent-preview-block">
        <span>curl</span>
        <pre>{preview.curl}</pre>
      </div>
      <div className="agent-preview-block">
        <span>agent.json</span>
        <pre>{preview.json}</pre>
      </div>
    </section>
  );
}

function SetupGuide({ saved }: { saved: boolean }) {
  const steps = [
    ["Define an Agent", "Choose a model and instructions; the Web keeps generation settings on the current Session-safe profile.", true],
    ["Save the definition", "Core becomes the durable source of truth for the saved Agent.", saved],
    ["Start a Session", "Create an idle environment:none Session and subscribe before sending input.", false],
    ["Exchange events", "A real Turn still requires a compatible worker, executor, model, and provider.", false],
  ] as const;
  return (
    <section className="agent-setup-guide" aria-labelledby="agent-setup-guide-title">
      <h2 id="agent-setup-guide-title">Get started creating an Agent</h2>
      <ol>
        {steps.map(([title, description, complete]) => (
          <li className={complete ? "complete" : ""} key={title}>
            {complete ? <Check size={13} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" />}
            <div><strong>{title}</strong><span>{description}</span></div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function AgentSetupView({
  actionError,
  baseUrl,
  busy,
  knownModels,
  onBack,
  onCreate,
  onStartSession,
}: {
  actionError: string | null;
  baseUrl: string;
  busy: boolean;
  knownModels: string[];
  onBack: () => void;
  onCreate: (input: CreateAgentInput) => Promise<SavedAgent | undefined>;
  onStartSession: (agentId: string) => void;
}) {
  const [draft, setDraft] = useState(() => valuesFromAgent());
  const [created, setCreated] = useState<SavedAgent | null>(null);
  const formId = "create-agent";
  const sessionAdmissionBlocker = created ? knownSessionAdmissionBlocker(created) : null;

  const create = async (input: CreateAgentInput) => {
    const agent = await onCreate(input);
    if (agent) setCreated(agent);
  };

  return (
    <section className="page-section agent-setup-page">
      <header className="agent-setup-header">
        <div className="agent-setup-breadcrumb" aria-label="Breadcrumb">
          <button type="button" onClick={onBack}>Agents</button>
          <ChevronRight size={14} aria-hidden="true" />
          <h1>{created?.name || "New Agent"}</h1>
        </div>
        <div className="agent-setup-tabs" role="tablist" aria-label="Agent setup sections">
          <button type="button" role="tab" aria-selected="true">Setup</button>
          <button type="button" role="tab" aria-selected="false" disabled title="Session history is available from the Sessions product view">Sessions</button>
        </div>
      </header>

      <div className="agent-setup-layout">
        <section className="agent-setup-editor" aria-label="Agent definition">
          {actionError ? (
            <div className="agent-action-error" role="alert">
              <strong>Request failed</strong><span>{actionError}</span>
            </div>
          ) : null}
          {created ? (
            <div className="notice success agent-created-notice" role="status">
              <Check size={14} aria-hidden="true" />
              Agent definition saved as <code>{created.id}</code>. This does not prove execution readiness.
            </div>
          ) : null}
          {sessionAdmissionBlocker ? (
            <div className="notice warning" id="created-agent-session-blocker" role="note">
              Saved successfully, but Start Session is unavailable. {sessionAdmissionBlocker}
            </div>
          ) : null}
          <AgentForm
            disabled={busy || Boolean(created)}
            formId={formId}
            knownModels={knownModels}
            onDraftChange={setDraft}
            onSubmit={create}
          />
          <footer className="agent-setup-actions">
            <button className="button outline" type="button" onClick={onBack} disabled={busy}>Back to Agents</button>
            <button className="button primary" type="submit" form={formId} disabled={busy || Boolean(created)}>
              {busy ? "Saving…" : created ? "Agent saved" : "Save Agent definition"}
            </button>
            <button
              className="button primary agent-start-session"
              type="button"
              disabled={busy || !created || Boolean(sessionAdmissionBlocker)}
              aria-describedby={sessionAdmissionBlocker ? "created-agent-session-blocker" : undefined}
              onClick={() => created && onStartSession(created.id)}
            >
              <MessageSquare size={14} strokeWidth={1.5} aria-hidden="true" />
              Start Session
            </button>
          </footer>
        </section>

        <aside className="agent-setup-aside">
          <AgentRequestPreview baseUrl={baseUrl} values={draft} />
          <SetupGuide saved={Boolean(created)} />
        </aside>
      </div>
    </section>
  );
}
