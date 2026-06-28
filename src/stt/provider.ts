export type SttTranscriptionContext = {
  language: string | null;
  prompt: string | null;
  sessionId: string;
  chunkId: string;
  userId: string;
  displayName: string;
};

export type SttTranscriptionOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type SttTranscriptionResult = {
  text: string;
};

export interface SttProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly supportsPrompt: boolean;
  preflight?(): Promise<void>;
  prepare?(options?: SttTranscriptionOptions): Promise<void>;
  transcribe(
    inputAudioPath: string,
    context: SttTranscriptionContext,
    options?: SttTranscriptionOptions,
  ): Promise<SttTranscriptionResult>;
  stop?(): Promise<void>;
  reapTrackedPids?(): void;
}

export class FakeSttProvider implements SttProvider {
  readonly providerName = "dirong-fake-stt";
  readonly modelName = "fake-v1";
  readonly supportsPrompt = false;

  async transcribe(
    _inputAudioPath: string,
    context: SttTranscriptionContext,
  ): Promise<SttTranscriptionResult> {
    return {
      text: [
        "[FAKE STT]",
        `${context.displayName} speaker chunk`,
        `chunk=${context.chunkId}`,
        "Real STT is intentionally not called in Phase 2.",
      ].join(" "),
    };
  }
}
