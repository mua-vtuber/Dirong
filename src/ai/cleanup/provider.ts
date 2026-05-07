import type { Phase4TranscriptTimeline } from "../../transcript/timeline.js";
import type {
  AiCleanupProgressContext,
  AiCleanupProgressObserver,
} from "./progress.js";

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
  progress?: AiCleanupProgressObserver;
  progressContext?: AiCleanupProgressContext;
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

export type AiCleanupProviderResetReason =
  | "request_success"
  | "request_failure"
  | "request_timeout"
  | "before_repair";

export type LegacyAiCleanupProviderResetReason =
  | "success"
  | "failure"
  | "timeout";

export interface AiCleanupProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly supportsJsonSchema: boolean;
  readonly supportsWarmSession?: boolean;
  readonly supportsStreamingProgress?: boolean;
  preflight?(): Promise<void>;
  generate(
    input: AiCleanupProviderInput,
    options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult>;
  resetSession?(reason: AiCleanupProviderResetReason): Promise<void>;
  resetAfterRequest?(reason: LegacyAiCleanupProviderResetReason): Promise<void>;
  stop?(): Promise<void>;
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
