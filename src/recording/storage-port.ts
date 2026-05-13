import type {
  RecordingRuntimeState,
  SessionRow,
  SessionStatus,
} from "../storage/rows.js";

export type ConnectionEventStore = {
  recordConnectionEvent(input: {
    sessionId: string | null;
    eventType: string;
    level?: "debug" | "info" | "warn" | "error";
    startedAtMs?: number | null;
    endedAtMs?: number | null;
    details?: unknown;
  }): void;
};

export type RepairItemStore = {
  recordRepairItem(input: {
    type: string;
    status?: "open" | "repaired" | "failed" | "ignored";
    severity?: "info" | "warn" | "error";
    sessionId?: string | null;
    path?: string | null;
    chunkId?: string | null;
    sttJobId?: string | null;
    details?: unknown;
  }): void;
};

export type SessionLifecycleStore = {
  createSession(input: {
    id: string;
    guildId: string;
    guildName: string | null;
    textChannelId: string | null;
    voiceChannelId: string;
    voiceChannelName: string | null;
    startedByUserId: string;
    startedByDisplayName: string;
    dataDir: string;
  }): void;
  updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    lastError?: string | null,
  ): void;
  stopSession(input: {
    sessionId: string;
    stoppedByUserId: string;
    stoppedByDisplayName: string;
    status: SessionStatus;
    lastError?: string | null;
  }): void;
  getSession(sessionId: string): SessionRow | null;
};

export type SpeakerStore = {
  upsertSpeaker(input: {
    sessionId: string;
    userId: string;
    displayNameSnapshot: string;
    isBot: boolean;
    seenAtMs: number;
  }): void;
};

export type ChunkWriteStore = {
  createChunkWriting(input: {
    chunkId: string;
    sessionId: string;
    chunkIndex: number;
    userId: string;
    displayNameSnapshot: string;
    startedAtMs: number;
    rawAudioPath: string;
  }): void;
  finalizeRawChunk(input: {
    chunkId: string;
    endedAtMs: number;
    durationMs: number;
    rawByteSize: number;
    rawSha256: string | null;
    closeReason: string;
    pipelineError: unknown;
  }): void;
  markChunkTranscodeFailed(input: {
    chunkId: string;
    error: string;
  }): void;
  markChunkFailed(input: {
    chunkId: string;
    error: unknown;
  }): void;
  completeChunkTranscodeAndQueueJob(input: {
    chunkId: string;
    sttAudioPath: string;
    sttAudioFormat: string;
    sttByteSize: number;
    sttSha256: string | null;
    maxAttempts: number;
  }): void;
};

export type ChunkFinalizerStore =
  & ConnectionEventStore
  & RepairItemStore
  & Pick<
    ChunkWriteStore,
    | "finalizeRawChunk"
    | "markChunkTranscodeFailed"
    | "markChunkFailed"
    | "completeChunkTranscodeAndQueueJob"
  >;

export type SpeakerChunkStore = ConnectionEventStore;

export type VoiceConnectionControllerStore = ConnectionEventStore & {
  updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    lastError?: string | null,
  ): void;
};

export type RecordingProducerStore =
  & ConnectionEventStore
  & RepairItemStore
  & SessionLifecycleStore
  & SpeakerStore
  & ChunkWriteStore;

export type AloneFinalizeStore = ConnectionEventStore & {
  getSession(sessionId: string): SessionRow | null;
};

export type RecordingRuntimeSource = {
  getRuntimeState(): RecordingRuntimeState;
};
