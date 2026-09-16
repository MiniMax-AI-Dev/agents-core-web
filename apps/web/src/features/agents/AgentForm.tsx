import { Info } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { CreateAgentInput, SavedAgent } from "@agents-core-web/agents-client";

import {
  buildModelOptionGroups,
  CUSTOM_MODEL_OPTION,
  modelIdFromOption,
  modelOptionValue,
} from "../../lib/model-options";
import { validateAgentForm, valuesFromAgent } from "./agent-form";

interface AgentFormProps {
  agent?: SavedAgent;
  disabled?: boolean;
  formId: string;
  knownModels: string[];
  onDraftChange?: (values: ReturnType<typeof valuesFromAgent>) => void;
  onSubmit: (input: CreateAgentInput) => Promise<unknown>;
}

export function AgentForm({ agent, disabled = false, formId, knownModels, onDraftChange, onSubmit }: AgentFormProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const options = buildModelOptionGroups(
    knownModels,
    import.meta.env.VITE_AGENT_MODEL_PRESETS,
    agent?.model ?? import.meta.env.VITE_AGENT_DEFAULT_MODEL,
  );
  const initial = valuesFromAgent(agent);
  const initialIsSuggested = [...options.configured, ...options.previouslyUsed].includes(initial.model);
  const [name, setName] = useState(initial.name);
  const [modelChoice, setModelChoice] = useState(
    initial.model && !initialIsSuggested ? CUSTOM_MODEL_OPTION : modelOptionValue(initial.model || options.defaultModel),
  );
  const [customModel, setCustomModel] = useState(initialIsSuggested ? "" : initial.model);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [metadata, setMetadata] = useState(initial.metadata);
  const [reasoningEffort, setReasoningEffort] = useState(initial.reasoningEffort);
  const [reasoningSummary, setReasoningSummary] = useState(initial.reasoningSummary);
  const [serviceTier, setServiceTier] = useState(initial.serviceTier);
  const [textFormat] = useState(initial.textFormat);
  const [textVerbosity, setTextVerbosity] = useState(initial.textVerbosity);
  const [modelError, setModelError] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const model = modelChoice === CUSTOM_MODEL_OPTION ? customModel : modelIdFromOption(modelChoice) ?? "";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => nameRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    onDraftChange?.({
      name,
      model,
      instructions,
      metadata,
      reasoningEffort,
      reasoningSummary,
      serviceTier,
      textFormat,
      textVerbosity,
    });
  }, [instructions, metadata, model, name, onDraftChange, reasoningEffort, reasoningSummary, serviceTier, textFormat, textVerbosity]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = validateAgentForm({
      name,
      model,
      instructions,
      metadata,
      reasoningEffort,
      reasoningSummary,
      serviceTier,
      textFormat,
      textVerbosity,
    }, agent ? "update" : "create");
    setModelError(result.modelError ?? null);
    setMetadataError(result.metadataError ?? null);
    if (!result.input) return;
    await onSubmit(result.input);
  };

  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
      <fieldset className="agent-form-fields" disabled={disabled}>
      <label className="field">
        <span>Name</span>
        <input
          ref={nameRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Repository builder"
          data-agent-initial-focus="true"
        />
      </label>
      <label className="field">
        <span>Instructions</span>
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="Describe how this Agent should work…"
          rows={5}
        />
      </label>
      <div className="field">
        <label className="field-label" htmlFor={`${formId}-model`}>
          <span>Model</span>
          <span className="field-optional">Web suggestions</span>
        </label>
        <select
          id={`${formId}-model`}
          value={modelChoice}
          onChange={(event) => setModelChoice(event.target.value)}
          aria-describedby={`${formId}-model-help ${formId}-model-note${modelError ? ` ${formId}-model-error` : ""}`}
          aria-invalid={Boolean(modelError)}
          required
        >
          <optgroup label="Configured suggestions">
            {options.configured.map((modelId) => (
              <option value={modelOptionValue(modelId)} key={modelId}>
                {modelId}{modelId === options.defaultModel ? " · Default" : ""}
              </option>
            ))}
          </optgroup>
          {options.previouslyUsed.length ? (
            <optgroup label="Previously used by saved Agents">
              {options.previouslyUsed.map((modelId) => (
                <option value={modelOptionValue(modelId)} key={modelId}>{modelId}</option>
              ))}
            </optgroup>
          ) : null}
          <option value={CUSTOM_MODEL_OPTION}>Custom model ID…</option>
        </select>
        <small id={`${formId}-model-help`}>
          Choose a Web suggestion or enter an ID configured for your runtime.
        </small>
        {modelError ? <small className="field-error" id={`${formId}-model-error`} role="alert">{modelError}</small> : null}
      </div>
      {modelChoice === CUSTOM_MODEL_OPTION ? (
        <label className="field">
          <span>Custom model ID</span>
          <input
            value={customModel}
            onChange={(event) => setCustomModel(event.target.value)}
            placeholder="provider/model-name"
            spellCheck={false}
            aria-describedby={`${formId}-model-note`}
            required
          />
        </label>
      ) : null}
      <div className="model-picker-note" id={`${formId}-model-note`} role="note">
        <Info size={14} strokeWidth={1.5} aria-hidden="true" />
        <span>
          Model choices are editable Web-side suggestions, not a discovered Core catalog. Saving <code>{model || "a model ID"}</code> does not prove the current executor can run it.
        </span>
      </div>
      <section className="agent-form-section" aria-labelledby={`${formId}-generation-title`}>
        <div className="agent-form-section-heading">
          <h3 id={`${formId}-generation-title`}>Generation</h3>
          <span>Saved configuration, not runtime discovery</span>
        </div>
        <div className="agent-form-grid">
          <label className="field">
            <span>Text format</span>
            <input
              value={textFormat.type === "text" ? "Text" : "JSON schema · preserved"}
              readOnly
              aria-describedby={`${formId}-text-format-help`}
            />
            <small id={`${formId}-text-format-help`}>
              Displayed from the Agent contract. This Web preserves JSON schemas but does not edit them yet.
            </small>
          </label>
          <label className="field">
            <span>Reasoning effort</span>
            <select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value as typeof reasoningEffort)}>
              <option value="">Core default</option>
              {(["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const).map((value) => (
                <option value={value} key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Text verbosity</span>
            <select value={textVerbosity} onChange={(event) => setTextVerbosity(event.target.value as typeof textVerbosity)}>
              {(["low", "medium", "high"] as const).map((value) => (
                <option value={value} key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Reasoning summary</span>
            <select value={reasoningSummary} onChange={(event) => setReasoningSummary(event.target.value as typeof reasoningSummary)}>
              <option value="">Core default</option>
              {(["concise", "detailed", "auto"] as const).map((value) => (
                <option value={value} key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Service tier</span>
            <select value={serviceTier} onChange={(event) => setServiceTier(event.target.value as typeof serviceTier)}>
              {(["auto", "default", "flex", "priority", "fast"] as const).map((value) => (
                <option value={value} key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="agent-form-capability-note">
          These fields are saved by Agent Core. The connected executor, model, and provider may support a narrower set; the first real Turn remains authoritative.
        </p>
      </section>
      <label className="field">
        <span>Metadata</span>
        <textarea
          className="agent-metadata-input"
          value={metadata}
          onChange={(event) => setMetadata(event.target.value)}
          rows={5}
          spellCheck={false}
          aria-describedby={`${formId}-metadata-help${metadataError ? ` ${formId}-metadata-error` : ""}`}
          aria-invalid={Boolean(metadataError)}
        />
        <small id={`${formId}-metadata-help`}>JSON object with string values only. Never store secrets in Agent metadata.</small>
        {metadataError ? <small className="field-error" id={`${formId}-metadata-error`} role="alert">{metadataError}</small> : null}
      </label>
      </fieldset>
    </form>
  );
}
