export type SttProviderName = "local-whisper" | "openai";

export type LocalWhisperSettings = {
  provider: "local-whisper";
  language: string;
  timeoutMs: number;
  localWhisper: {
    command: string;
    args: string[];
    model: string;
    device: string;
    computeType: string;
  };
};

export type OpenAiSttSettings = {
  provider: "openai";
  language: string;
  timeoutMs: number;
  openai: {
    apiKey: string;
    model: string;
  };
};

export type SttSettings = LocalWhisperSettings | OpenAiSttSettings;

export type AppSettings = {
  stt: SttSettings;
};

export type SttSettingsOverrides = {
  provider?: SttProviderName | null;
  model?: string | null;
};
