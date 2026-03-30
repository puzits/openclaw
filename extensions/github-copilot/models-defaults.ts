import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8192;

// Copilot model ids vary by plan/org and can change.
// We keep this list intentionally broad; if a model isn't available Copilot will
// return an error and users can remove it from their config.
const DEFAULT_MODEL_IDS = [
  // Anthropic Claude models
  "claude-opus-4.5",
  "claude-sonnet-4.6",
  "claude-sonnet-4.5",
  "claude-haiku-4.5",
  // OpenAI GPT models
  "gpt-4o",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  // OpenAI reasoning models
  "o4-mini",
  "o3",
  "o3-mini",
  "o1",
  "o1-mini",
] as const;

// O-series model prefixes that support extended reasoning.
const REASONING_MODEL_PREFIXES = ["o1", "o3", "o4"];

function isReasoningModel(id: string): boolean {
  const lower = id.toLowerCase();
  return REASONING_MODEL_PREFIXES.some(
    (prefix) => lower === prefix || lower.startsWith(`${prefix}-`),
  );
}

export function getDefaultCopilotModelIds(): string[] {
  return [...DEFAULT_MODEL_IDS];
}

export function buildCopilotModelDefinition(modelId: string): ModelDefinitionConfig {
  const id = modelId.trim();
  if (!id) {
    throw new Error("Model id required");
  }
  return {
    id,
    name: id,
    // pi-coding-agent's registry schema doesn't know about a "github-copilot" API.
    // We use OpenAI-compatible responses API, while keeping the provider id as
    // "github-copilot" (pi-ai uses that to attach Copilot-specific headers).
    api: "openai-responses",
    reasoning: isReasoningModel(id),
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}
