import type {
  SessionStore,
  SpeechStatus,
  TranscriptSegmentRow,
} from "../storage/session-store.js";

export type Phase4TranscriptTimelineEntry = {
  sessionId: string;
  chunkId: string;
  sttJobId: string;
  userId: string;
  displayNameSnapshot: string;
  startMs: number;
  endMs: number;
  text: string;
  speechStatus: SpeechStatus;
  source: string;
  provider: string;
  model: string;
  inputAudioSha256: string | null;
};

export type Phase4TranscriptTimeline = {
  contractVersion: "phase3.5-transcript-timeline-v1";
  sessionId: string;
  includeNoSpeech: boolean;
  entries: Phase4TranscriptTimelineEntry[];
};

export function buildPhase4TranscriptTimeline(
  store: SessionStore,
  input: {
    sessionId: string;
    includeNoSpeech?: boolean;
  },
): Phase4TranscriptTimeline {
  const includeNoSpeech = input.includeNoSpeech ?? false;
  const rows = store.listTranscriptTimelineSegments({
    sessionId: input.sessionId,
    includeNoSpeech,
  });

  return {
    contractVersion: "phase3.5-transcript-timeline-v1",
    sessionId: input.sessionId,
    includeNoSpeech,
    entries: rows.map(toTimelineEntry),
  };
}

export function renderPhase4TranscriptTimelineMarkdown(
  timeline: Phase4TranscriptTimeline,
): string {
  return timeline.entries
    .map((entry) => {
      const text =
        entry.speechStatus === "no_speech" && entry.text.trim().length === 0
          ? "(no speech)"
          : entry.text;
      return `[${formatTime(entry.startMs)}] ${entry.displayNameSnapshot}: ${text}`;
    })
    .join("\n");
}

function toTimelineEntry(
  row: TranscriptSegmentRow,
): Phase4TranscriptTimelineEntry {
  return {
    sessionId: row.session_id,
    chunkId: row.chunk_id,
    sttJobId: row.stt_job_id,
    userId: row.user_id,
    displayNameSnapshot: row.display_name_snapshot,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
    speechStatus: row.speech_status,
    source: row.source,
    provider: row.provider,
    model: row.model,
    inputAudioSha256: row.input_audio_sha256,
  };
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
