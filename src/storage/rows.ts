export type SessionStatus =
  | "created"
  | "active"
  | "reconnecting"
  | "stopping"
  | "finalized"
  | "failed"
  | "needs_repair";

export type ChunkStatus =
  | "writing"
  | "finalized"
  | "queued"
  | "transcode_failed"
  | "failed";

export type RepairScanSummary = {
  oldPartFiles: number;
  staleWritingChunksRepaired: number;
  staleWritingChunksFailed: number;
  missingSttJobsCreated: number;
  missingAudioJobsFailed: number;
  expiredLeasesReleased: number;
  orphanAudioFiles: number;
};

export type RecordingRuntimeState = {
  isRecording: boolean;
  sessionId: string | null;
  guildId?: string | null;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  openChunks: number;
};

export type SessionRow = {
  id: string;
  guild_id: string;
  guild_name: string | null;
  text_channel_id: string | null;
  voice_channel_id: string;
  voice_channel_name: string | null;
  started_by_user_id: string;
  started_by_display_name: string | null;
  stopped_by_user_id: string | null;
  stopped_by_display_name: string | null;
  status: SessionStatus;
  started_at: string;
  stopped_at: string | null;
  finalized_at: string | null;
  data_dir: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ChunkRow = {
  id: string;
  session_id: string;
  chunk_index: number;
  user_id: string;
  display_name_snapshot: string;
  status: ChunkStatus;
  started_at_ms: number;
  ended_at_ms: number | null;
  duration_ms: number | null;
  raw_audio_path: string;
  raw_audio_format: string;
  raw_byte_size: number | null;
  raw_sha256: string | null;
  stt_audio_path: string | null;
  stt_audio_format: string | null;
  stt_byte_size: number | null;
  stt_sha256: string | null;
  transcode_status: string;
  transcode_error: string | null;
  close_reason: string | null;
  pipeline_error_json: string | null;
  created_at: string;
  updated_at: string;
};

export type SttJobRow = {
  id: string;
  session_id: string;
  chunk_id: string;
  user_id: string;
  display_name_snapshot: string;
  input_audio_path: string;
  status: string;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  locked_until: string | null;
  next_attempt_at: string;
  input_audio_sha256: string | null;
  result_text_sha256: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type SpeechStatus = "speech" | "no_speech";

export type TranscriptSegmentRow = {
  id: string;
  session_id: string;
  chunk_id: string;
  stt_job_id: string;
  user_id: string;
  display_name_snapshot: string;
  start_ms: number;
  end_ms: number;
  text: string;
  speech_status: SpeechStatus;
  source: string;
  provider: string;
  model: string;
  input_audio_sha256: string | null;
  created_at: string;
  updated_at: string;
};

export type AiCleanupJobStatus =
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "blocked";

export type AiCleanupFailureKind =
  | "provider_not_found"
  | "provider_auth_required"
  | "provider_timeout"
  | "provider_nonzero_exit"
  | "missing_timeline"
  | "empty_timeline"
  | "input_too_long"
  | "unsafe_input"
  | "empty_output"
  | "malformed_json"
  | "schema_invalid"
  | "file_io"
  | "unknown";

export type AiCleanupJobRow = {
  id: string;
  session_id: string;
  status: AiCleanupJobStatus;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  locked_until: string | null;
  next_attempt_at: string;
  provider: string;
  model: string;
  command: string | null;
  prompt_version: string;
  input_contract_version: string;
  input_hash: string;
  input_entry_count: number;
  input_timeline_json_path: string | null;
  input_timeline_markdown_path: string | null;
  prompt_path: string | null;
  raw_output_path: string | null;
  stderr_path: string | null;
  parsed_json_path: string | null;
  markdown_path: string | null;
  output_hash: string | null;
  failure_kind: AiCleanupFailureKind | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type MeetingNotesDraftRow = {
  id: string;
  session_id: string;
  ai_cleanup_job_id: string;
  schema_version: string;
  language: string;
  title: string;
  summary_text: string;
  draft_json: string;
  markdown: string;
  json_path: string;
  markdown_path: string;
  raw_output_path: string;
  provider: string;
  model: string;
  prompt_version: string;
  input_hash: string;
  output_hash: string;
  validation_status: string;
  created_at: string;
  updated_at: string;
};

export type AiCleanupSttTerminalSnapshot = {
  sessionId: string;
  sessionStatus: "finalized";
  openChunkCount: number;
  sttQueuedCount: number;
  sttProcessingCount: number;
  sttDoneCount: number;
  sttFailedCount: number;
  sttFailedMissingFileCount: number;
  sttOtherNonTerminalCount: number;
  chunksMissingSttJobCount: number;
  chunksWithTranscodeFailedCount: number;
  chunksMissingSttAudioCount: number;
  realTranscriptEntryCount: number;
  isTerminal: boolean;
  canGenerateDraft: boolean;
  shouldRecordEmptyTimelineBlock: boolean;
  canInvokeRunner: boolean;
  warnings: string[];
};

export type AiCleanupLeaseRepairSummary = {
  requeued: number;
  failed: number;
};
