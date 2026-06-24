import { ClaudeApiCleanupProvider } from "./claude-api-provider.js";
import { ClaudeStreamJsonCliCleanupProvider } from "./claude-persistent-cli-provider.js";
import { TerminalCliCleanupProvider } from "./terminal-cli-provider.js";
import type { AiCleanupProvider } from "./provider.js";
import type { AiCleanupRuntimeSettings } from "../../settings/app-settings.js";

export type AiCleanupProviderFactoryOptions = {
  onClaudeOrphanKillFailed?: (event: {
    pid: number;
    errno: string | null;
  }) => void;
};

export type ManagedAiCleanupProvider = AiCleanupProvider & {
  reapTrackedPids?: () => void;
};

export function createAiCleanupProviderFromSettings(
  settings: AiCleanupRuntimeSettings,
  options: AiCleanupProviderFactoryOptions = {},
): ManagedAiCleanupProvider {
  if (settings.provider === "codex") {
    return new TerminalCliCleanupProvider({
      kind: "codex",
      command: settings.command,
      model: settings.model,
    });
  }

  if (settings.provider === "gemini") {
    return new TerminalCliCleanupProvider({
      kind: "gemini",
      command: settings.command,
      model: settings.model,
    });
  }

  if (settings.mode === "api") {
    return new ClaudeApiCleanupProvider({
      apiKey: settings.apiKey,
      model: settings.claudeModel ?? settings.model,
    });
  }

  return new ClaudeStreamJsonCliCleanupProvider({
    command: settings.claudeCommand,
    model: settings.claudeModel,
    onOrphanKillFailed: options.onClaudeOrphanKillFailed,
  });
}
