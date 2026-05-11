export const DEFAULT_LOCAL_WHISPER_TOOL_PROFILE = "local-whisper-python-script";
export const DEFAULT_CLAUDE_TOOL_PROFILE = "claude-cli-default";

export type LocalWhisperToolProfile = typeof DEFAULT_LOCAL_WHISPER_TOOL_PROFILE;
export type ClaudeToolProfile = typeof DEFAULT_CLAUDE_TOOL_PROFILE;

export type CommandTemplate = {
  command: string;
  args: string[];
};

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

export function isLocalWhisperToolProfile(
  value: unknown,
): value is LocalWhisperToolProfile {
  return value === DEFAULT_LOCAL_WHISPER_TOOL_PROFILE;
}

export function isClaudeToolProfile(value: unknown): value is ClaudeToolProfile {
  return value === DEFAULT_CLAUDE_TOOL_PROFILE;
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
