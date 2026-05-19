import { LocalWhisperSttProvider } from "./local-whisper-provider.js";
import { OpenAiSttProvider } from "./openai-provider.js";
import { t } from "../i18n/catalog.js";
import type { SttProvider } from "./provider.js";
import type {
  SttSettings,
  SttSettingsOverrides,
} from "../settings/app-settings.js";
import { DEFAULT_STT_SETTINGS } from "../settings/defaults.js";

export type Phase3SttProviderSelection = {
  provider: SttProvider;
  settings: SttSettings;
};

export function createPhase3SttProvider(
  settings: SttSettings,
  overrides: SttSettingsOverrides = {},
): Phase3SttProviderSelection {
  const selectedSettings = applySttSettingsOverrides(settings, overrides);

  if (selectedSettings.provider === "openai") {
    return {
      settings: selectedSettings,
      provider: new OpenAiSttProvider(
        selectedSettings.openai.apiKey,
        selectedSettings.openai.model,
        selectedSettings.timeoutMs,
      ),
    };
  }

  return {
    settings: selectedSettings,
    provider: new LocalWhisperSttProvider({
      command: selectedSettings.localWhisper.command,
      args: selectedSettings.localWhisper.args,
      model: selectedSettings.localWhisper.model,
      device: selectedSettings.localWhisper.device,
      computeType: selectedSettings.localWhisper.computeType,
      defaultTimeoutMs: selectedSettings.timeoutMs,
    }),
  };
}

export function assertPhase3SttProviderReady(input: {
  settings: SttSettings;
  dryRun: boolean;
}): void {
  if (
    !input.dryRun &&
    input.settings.provider === "openai" &&
    !input.settings.openai.apiKey
  ) {
    throw new Error(t("ko", "runtimeCli.sttProvider.openAiNotCalled"));
  }
}

export function applySttSettingsOverrides(
  settings: SttSettings,
  overrides: SttSettingsOverrides,
): SttSettings {
  const provider = overrides.provider ?? settings.provider;

  if (provider === "openai") {
    const existingOpenAi =
      settings.provider === "openai"
        ? settings.openai
        : {
            apiKey: DEFAULT_STT_SETTINGS.openai.apiKey,
            model: DEFAULT_STT_SETTINGS.openai.model,
          };

    return {
      provider,
      language: settings.language,
      timeoutMs: settings.timeoutMs,
      openai: {
        ...existingOpenAi,
        model: overrides.model ?? existingOpenAi.model,
      },
    };
  }

  const existingLocalWhisper =
    settings.provider === "local-whisper"
      ? settings.localWhisper
      : {
          command: DEFAULT_STT_SETTINGS.localWhisper.command,
          args: [...DEFAULT_STT_SETTINGS.localWhisper.args],
          model: DEFAULT_STT_SETTINGS.localWhisper.model,
          device: DEFAULT_STT_SETTINGS.localWhisper.device,
          computeType: DEFAULT_STT_SETTINGS.localWhisper.computeType,
        };

  return {
    provider,
    language: settings.language,
    timeoutMs: settings.timeoutMs,
    localWhisper: {
      ...existingLocalWhisper,
      model: overrides.model ?? existingLocalWhisper.model,
    },
  };
}
