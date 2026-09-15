import type { CreateAgentInput, SavedAgent } from "@agents-core-web/agents-client";

export interface AgentFormValues {
  name: string;
  model: string;
  instructions: string;
  metadata: string;
}

export interface AgentFormValidation {
  input?: CreateAgentInput;
  metadataError?: string;
  modelError?: string;
}

export function valuesFromAgent(agent?: SavedAgent): AgentFormValues {
  return {
    name: agent?.name ?? "",
    model: agent?.model ?? "",
    instructions: agent?.instructions ?? "",
    metadata: JSON.stringify(agent?.metadata ?? {}, null, 2),
  };
}

export function validateAgentForm(values: AgentFormValues): AgentFormValidation {
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

  return {
    input: {
      model,
      name: values.name.trim() || null,
      instructions: values.instructions.trim() || null,
      metadata: metadata as Record<string, string>,
    },
  };
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
