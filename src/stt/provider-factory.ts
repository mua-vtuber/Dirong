import { LocalWhisperSttProvider } from "./local-whisper-provider.js";
import { OpenAiSttProvider } from "./openai-provider.js";
import type { SttProvider } from "./provider.js";
import type {
  SttSettings,
  SttSettingsOverrides,
} from "../settings/app-settings.js";

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
    throw new Error(
      "OPENAI_API_KEY가 없어 OpenAI STT를 호출하지 않았습니다. local-whisper를 쓰려면 --provider local-whisper를 선택해 주세요.",
    );
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
        : { apiKey: "", model: "gpt-4o-mini-transcribe" };

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
          command: "python",
          args: ["scripts/local-whisper-json.py"],
          model: "small",
          device: "cpu",
          computeType: "int8",
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
