import type {
  AgentReasoningEffort,
  AgentReasoningSummary,
  AgentServiceTier,
  AgentTextFormat,
  CreateAgentInput,
  SavedAgent,
} from "@agents-core-web/agents-client";

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
  input?: CreateAgentInput;
  metadataError?: string;
  modelError?: string;
}

export type AgentFormIntent = "create" | "update";

export function valuesFromAgent(agent?: SavedAgent): AgentFormValues {
  return {
    name: agent?.name ?? "",
    model: agent?.model ?? "",
    instructions: agent?.instructions ?? "",
    metadata: JSON.stringify(agent?.metadata ?? {}, null, 2),
    reasoningEffort: agent ? agent.reasoning.effort ?? "" : "medium",
    reasoningSummary: agent ? agent.reasoning.summary ?? "" : "auto",
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
  if (!model) return { modelError: "Enter a model ID." };

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

  const input: CreateAgentInput = {
    model,
    name: values.name.trim() || null,
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
