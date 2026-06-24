export const AI_PROVIDER_NAMES = ["claude", "codex", "gemini"] as const;
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];

export const AI_PROVIDER_MODES = ["cli", "api"] as const;
export type AiProviderMode = (typeof AI_PROVIDER_MODES)[number];

export function isAiProviderName(value: unknown): value is AiProviderName {
  return AI_PROVIDER_NAMES.includes(value as AiProviderName);
}

export function isAiProviderMode(value: unknown): value is AiProviderMode {
  return AI_PROVIDER_MODES.includes(value as AiProviderMode);
}

export function supportsAiProviderMode(
  provider: AiProviderName,
  mode: AiProviderMode,
): boolean {
  return mode === "cli" || provider === "claude";
}
