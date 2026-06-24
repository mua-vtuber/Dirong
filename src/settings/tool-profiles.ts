import type { AiProviderName } from "./ai-providers.js";

export const DEFAULT_LOCAL_WHISPER_TOOL_PROFILE = "local-whisper-python-script";
export const DEFAULT_CLAUDE_TOOL_PROFILE = "claude-cli-default";
export const DEFAULT_CODEX_TOOL_PROFILE = "codex-cli-default";
export const DEFAULT_GEMINI_TOOL_PROFILE = "gemini-cli-default";

export type LocalWhisperToolProfile = typeof DEFAULT_LOCAL_WHISPER_TOOL_PROFILE;
export type ClaudeToolProfile = typeof DEFAULT_CLAUDE_TOOL_PROFILE;
export type CodexToolProfile = typeof DEFAULT_CODEX_TOOL_PROFILE;
export type GeminiToolProfile = typeof DEFAULT_GEMINI_TOOL_PROFILE;
export type AiToolProfile =
  | ClaudeToolProfile
  | CodexToolProfile
  | GeminiToolProfile;

export type CommandTemplate = {
  command: string;
  args: string[];
};

export const DEFAULT_AI_TOOL_PROFILES = {
  claude: DEFAULT_CLAUDE_TOOL_PROFILE,
  codex: DEFAULT_CODEX_TOOL_PROFILE,
  gemini: DEFAULT_GEMINI_TOOL_PROFILE,
} as const satisfies Record<AiProviderName, AiToolProfile>;

const LOCAL_WHISPER_PROFILES: Record<LocalWhisperToolProfile, CommandTemplate> = {
  "local-whisper-python-script": {
    command: "python",
    args: ["scripts/local-whisper-json.py"],
  },
};

const CLAUDE_PROFILES: Record<ClaudeToolProfile, CommandTemplate> = {
  "claude-cli-default": {
    command: "claude",
    args: [],
  },
};

const AI_PROFILES: Record<AiToolProfile, CommandTemplate> = {
  ...CLAUDE_PROFILES,
  "codex-cli-default": {
    command: "codex",
    args: [],
  },
  "gemini-cli-default": {
    command: "gemini",
    args: [],
  },
};

const AI_PROFILE_PROVIDERS: Record<AiToolProfile, AiProviderName> = {
  "claude-cli-default": "claude",
  "codex-cli-default": "codex",
  "gemini-cli-default": "gemini",
};

export function isLocalWhisperToolProfile(
  value: unknown,
): value is LocalWhisperToolProfile {
  return value === DEFAULT_LOCAL_WHISPER_TOOL_PROFILE;
}

export function isClaudeToolProfile(value: unknown): value is ClaudeToolProfile {
  return value === DEFAULT_CLAUDE_TOOL_PROFILE;
}

export function isCodexToolProfile(value: unknown): value is CodexToolProfile {
  return value === DEFAULT_CODEX_TOOL_PROFILE;
}

export function isGeminiToolProfile(value: unknown): value is GeminiToolProfile {
  return value === DEFAULT_GEMINI_TOOL_PROFILE;
}

export function isAiToolProfile(value: unknown): value is AiToolProfile {
  return (
    isClaudeToolProfile(value) ||
    isCodexToolProfile(value) ||
    isGeminiToolProfile(value)
  );
}

export function isAiToolProfileForProvider(
  value: unknown,
  provider: AiProviderName,
): value is AiToolProfile {
  return isAiToolProfile(value) && AI_PROFILE_PROVIDERS[value] === provider;
}

export function defaultAiToolProfile(provider: AiProviderName): AiToolProfile {
  return DEFAULT_AI_TOOL_PROFILES[provider];
}

export function resolveLocalWhisperToolProfile(
  profile: LocalWhisperToolProfile = DEFAULT_LOCAL_WHISPER_TOOL_PROFILE,
): CommandTemplate {
  return cloneTemplate(LOCAL_WHISPER_PROFILES[profile]);
}

export function resolveClaudeToolProfile(
  profile: ClaudeToolProfile = DEFAULT_CLAUDE_TOOL_PROFILE,
): CommandTemplate {
  return cloneTemplate(CLAUDE_PROFILES[profile]);
}

export function resolveAiToolProfile(
  profile: AiToolProfile,
): CommandTemplate {
  return cloneTemplate(AI_PROFILES[profile]);
}

export function matchesLocalWhisperToolProfile(input: {
  command: string | null;
  args: readonly string[];
  profile?: LocalWhisperToolProfile;
}): boolean {
  const template = resolveLocalWhisperToolProfile(
    input.profile ?? DEFAULT_LOCAL_WHISPER_TOOL_PROFILE,
  );
  return input.command === template.command && arraysEqual(input.args, template.args);
}

export function matchesClaudeToolProfile(input: {
  command: string | null;
  profile?: ClaudeToolProfile;
}): boolean {
  const template = resolveClaudeToolProfile(
    input.profile ?? DEFAULT_CLAUDE_TOOL_PROFILE,
  );
  return input.command === template.command;
}

export function matchesAiToolProfile(input: {
  command: string | null;
  profile: AiToolProfile;
}): boolean {
  const template = resolveAiToolProfile(input.profile);
  return input.command === template.command;
}

function cloneTemplate(template: CommandTemplate): CommandTemplate {
  return {
    command: template.command,
    args: [...template.args],
  };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
