import type { Phase4TranscriptTimeline } from "../../transcript/timeline.js";

export type AiCleanupProviderInput = {
  sessionId: string;
  language: "ko";
  promptVersion: "phase4-ai-cleanup-v2";
  outputSchemaVersion: "dirong.meeting_notes_draft.v1";
  timeline: Phase4TranscriptTimeline;
  timelineMarkdown: string;
  inputHash: string;
};

export type AiCleanupProviderOptions = {
  timeoutMs: number;
  maxOutputBytes: number;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: unknown;
};

export type AiCleanupProviderResult = {
  provider: string;
  model: string;
  commandDisplay: string | null;
  rawText: string;
  stderrText: string;
  exitCode: number | null;
  durationMs: number;
};

export interface AiCleanupProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly supportsJsonSchema: boolean;
  preflight?(): Promise<void>;
  generate(
    input: AiCleanupProviderInput,
    options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult>;
}

export class AiCleanupProviderError extends Error {
  constructor(
    readonly failureKind:
      | "provider_not_found"
      | "provider_auth_required"
      | "provider_timeout"
      | "provider_nonzero_exit"
      | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "AiCleanupProviderError";
  }
}
