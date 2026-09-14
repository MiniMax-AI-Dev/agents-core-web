export const DEFAULT_MODEL_PRESETS = [
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.3-codex-spark",
] as const;

export const DEFAULT_MODEL_ID = "gpt-5.6-sol";
export const CUSTOM_MODEL_OPTION = "custom";
const MODEL_OPTION_PREFIX = "model:";

export interface ModelOptionGroups {
  defaultModel: string;
  configured: string[];
  previouslyUsed: string[];
}

export function modelOptionValue(modelId: string): string {
  return `${MODEL_OPTION_PREFIX}${encodeURIComponent(modelId)}`;
}

export function modelIdFromOption(value: string): string | null {
  if (!value.startsWith(MODEL_OPTION_PREFIX)) return null;
  try {
    return decodeURIComponent(value.slice(MODEL_OPTION_PREFIX.length));
  } catch {
    return null;
  }
}

function uniqueModelIds(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const model = value.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    result.push(model);
  }

  return result;
}

export function buildModelOptionGroups(
  savedAgentModels: Iterable<string>,
  configuredPresets?: string,
  configuredDefault?: string,
): ModelOptionGroups {
  const parsedPresets = uniqueModelIds(configuredPresets?.split(",") ?? []);
  const hasConfiguredPresets = parsedPresets.length > 0;
  const configured = hasConfiguredPresets ? parsedPresets : [...DEFAULT_MODEL_PRESETS];
  const requestedDefault = configuredDefault?.trim() || (hasConfiguredPresets ? configured[0] : DEFAULT_MODEL_ID);
  const defaultModel = requestedDefault || configured[0] || "";

  if (defaultModel && !configured.includes(defaultModel)) configured.unshift(defaultModel);

  const configuredSet = new Set(configured);
  const previouslyUsed = uniqueModelIds(savedAgentModels).filter((model) => !configuredSet.has(model));

  return { defaultModel, configured, previouslyUsed };
}
