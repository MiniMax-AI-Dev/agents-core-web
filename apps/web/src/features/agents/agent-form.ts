import type {
  AgentReasoningEffort,
  AgentReasoningSummary,
  AgentServiceTier,
  AgentTextFormat,
  CreateAgentInput,
  SavedAgent,
} from "@agents-core-web/agents-client";

import { isCoreWhitespaceOnly } from "./session-admission";

export type TextVerbosity = "low" | "medium" | "high";

export interface AgentFormValues {
  name: string;
  model: string;
  instructions: string;
  metadata: string;
  reasoningEffort: AgentReasoningEffort | "";
  reasoningSummary: AgentReasoningSummary | "";
  serviceTier: AgentServiceTier;
  textFormat: AgentTextFormat;
  textVerbosity: TextVerbosity;
}

export interface AgentFormValidation {
  configurationError?: string;
  input?: CreateAgentInput;
  metadataError?: string;
  modelError?: string;
  nameError?: string;
}

export type AgentFormIntent = "create" | "update";

export function valuesFromAgent(agent?: SavedAgent): AgentFormValues {
  return {
    name: agent?.name ?? "",
    model: agent?.model ?? "",
    instructions: agent?.instructions ?? "",
    metadata: JSON.stringify(agent?.metadata ?? {}, null, 2),
    reasoningEffort: agent?.reasoning.effort ?? "",
    reasoningSummary: agent?.reasoning.summary ?? "",
    serviceTier: agent?.service_tier ?? "auto",
    textFormat: agent?.text.format ?? { type: "text" },
    textVerbosity: agent?.text.verbosity ?? "medium",
  };
}

export function validateAgentForm(
  values: AgentFormValues,
  intent: AgentFormIntent = "create",
): AgentFormValidation {
  const model = values.model.trim();
  if (isCoreWhitespaceOnly(model)) return { modelError: "Enter a model ID." };

  const name = values.name.trim();
  if ([...name].length > 128) {
    return { nameError: "Name must be at most 128 characters." };
  }

  let parsed: unknown;
  try {
    parsed = values.metadata.trim() ? JSON.parse(values.metadata) : {};
  } catch {
    return { metadataError: "Metadata must be valid JSON." };
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return { metadataError: "Metadata must be a JSON object." };
  }

  const metadata = parsed as Record<string, unknown>;
  if (Object.values(metadata).some((value) => typeof value !== "string")) {
    return { metadataError: "Every metadata value must be a string." };
  }
  const metadataEntries = Object.entries(metadata) as [string, string][];
  if (metadataEntries.length > 16) {
    return { metadataError: "Agent metadata supports at most 16 pairs." };
  }
  if (metadataEntries.some(([key, value]) => [...key].length > 64 || [...value].length > 512)) {
    return { metadataError: "Metadata keys must be at most 64 characters and values at most 512 characters." };
  }

  if (intent === "create") {
    if (values.reasoningEffort || values.reasoningSummary) {
      return { configurationError: "Current Core Sessions require both reasoning fields to use Core default." };
    }
    if (values.serviceTier !== "auto") {
      return { configurationError: "Current Core Sessions support service tier auto only." };
    }
    if (values.textFormat.type !== "text") {
      return { configurationError: "Current Core Sessions support text format only." };
    }
    if (values.textVerbosity !== "medium") {
      return { configurationError: "Low and high verbosity require a discovered compatible Codex model; use medium for this Web flow." };
    }
  }

  const input: CreateAgentInput = {
    model,
    name: name || null,
    instructions: values.instructions.trim() || null,
    metadata: metadata as Record<string, string>,
    service_tier: values.serviceTier,
    text: {
      format: values.textFormat,
      verbosity: values.textVerbosity,
    },
  };
  if (intent === "update") {
    input.reasoning = {
      effort: values.reasoningEffort || null,
      summary: values.reasoningSummary || null,
    };
  } else if (values.reasoningEffort || values.reasoningSummary) {
    input.reasoning = {
      ...(values.reasoningEffort ? { effort: values.reasoningEffort } : {}),
      ...(values.reasoningSummary ? { summary: values.reasoningSummary } : {}),
    };
  }

  return { input };
}

export interface RequestGate {
  begin(): number;
  isCurrent(request: number): boolean;
  invalidate(): void;
}

export function createRequestGate(): RequestGate {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    isCurrent(request) {
      return request === current;
    },
    invalidate() {
      current += 1;
    },
  };
}
