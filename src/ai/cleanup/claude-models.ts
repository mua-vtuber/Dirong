export const DEFAULT_CLAUDE_CLEANUP_MODEL = "haiku";

export const CLAUDE_API_MODEL_ALIASES = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
} as const;

export function resolveClaudeApiModelName(
  model: string | null | undefined,
): string {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === "default") {
    return CLAUDE_API_MODEL_ALIASES.haiku;
  }
  if (trimmed === "haiku") {
    return CLAUDE_API_MODEL_ALIASES.haiku;
  }
  if (trimmed === "sonnet") {
    return CLAUDE_API_MODEL_ALIASES.sonnet;
  }
  if (trimmed === "opus") {
    return CLAUDE_API_MODEL_ALIASES.opus;
  }
  return trimmed;
}
