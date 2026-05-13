import type {
  AiCleanupFailureKind,
  AiCleanupJobRow,
  AiCleanupLeaseRepairSummary,
  AiCleanupSttTerminalSnapshot,
  MeetingNotesDraftRow,
  SessionRow,
  TranscriptSegmentRow,
} from "../../storage/rows.js";

export type AiCleanupTimelineStore = {
  listTranscriptTimelineSegments(input: {
    sessionId: string;
    includeNoSpeech?: boolean;
    includeFakeStt?: boolean;
  }): TranscriptSegmentRow[];
};

export type GetOrCreateAiCleanupJobInput = {
  id: string;
  sessionId: string;
  provider: string;
  model: string;
  command: string | null;
  promptVersion: string;
  inputContractVersion: string;
  inputHash: string;
  inputEntryCount: number;
  inputTimelineJsonPath: string | null;
  inputTimelineMarkdownPath: string | null;
  maxAttempts: number;
};

export type GetAiCleanupJobByIdentityInput = {
  sessionId: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
};

export type ClaimAiCleanupJobInput = {
  jobId: string;
  workerId: string;
  leaseMs: number;
};

export type UpdateAiCleanupJobArtifactsInput = {
  jobId: string;
  command?: string | null;
  promptPath?: string | null;
  rawOutputPath?: string | null;
  stderrPath?: string | null;
  parsedJsonPath?: string | null;
  markdownPath?: string | null;
  outputHash?: string | null;
};

export type BlockAiCleanupJobInput = {
  jobId: string;
  failureKind: AiCleanupFailureKind;
  error: string;
};

export type FailProcessingAiCleanupJobInput = {
  jobId: string;
  failureKind: AiCleanupFailureKind;
  error: string;
};

export type CompleteAiCleanupJobInput = {
  jobId: string;
  draftId: string;
  schemaVersion: string;
  language: string;
  title: string;
  summaryText: string;
  draftJson: string;
  markdown: string;
  jsonPath: string;
  markdownPath: string;
  rawOutputPath: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  outputHash: string;
};

export type ListFinalizedSessionsForAiCleanupAutomationInput = {
  limit?: number;
  provider?: string;
  model?: string;
  promptVersion?: string;
  nowIso?: string;
};

export type AiCleanupRunStore = AiCleanupTimelineStore & {
  getSession(sessionId: string): SessionRow | null;
  getOrCreateAiCleanupJob(
    input: GetOrCreateAiCleanupJobInput,
  ): AiCleanupJobRow;
  getAiCleanupJob(jobId: string): AiCleanupJobRow | null;
  getMeetingNotesDraftByJobId(jobId: string): MeetingNotesDraftRow | null;
  blockAiCleanupJob(input: BlockAiCleanupJobInput): void;
  releaseExpiredAiCleanupLeases(nowIso?: string): number;
  claimAiCleanupJob(input: ClaimAiCleanupJobInput): AiCleanupJobRow | null;
  updateAiCleanupJobArtifacts(input: UpdateAiCleanupJobArtifactsInput): void;
  failProcessingAiCleanupJob(input: FailProcessingAiCleanupJobInput): void;
  completeAiCleanupJob(input: CompleteAiCleanupJobInput): MeetingNotesDraftRow;
};

export type AiCleanupAutomationStore = AiCleanupRunStore & {
  releaseExpiredProcessingLeases(nowIso?: string): number;
  repairExpiredAiCleanupProcessingJobs(
    nowIso?: string,
  ): AiCleanupLeaseRepairSummary;
  listFinalizedSessionsForAiCleanupAutomation(
    input: ListFinalizedSessionsForAiCleanupAutomationInput,
  ): SessionRow[];
  getAiCleanupSttTerminalSnapshot(
    sessionId: string,
  ): AiCleanupSttTerminalSnapshot | null;
  getAiCleanupJobByIdentity(
    input: GetAiCleanupJobByIdentityInput,
  ): AiCleanupJobRow | null;
};
