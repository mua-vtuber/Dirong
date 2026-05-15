// Pure free-function extraction of the five private mapXxxRow helpers that lived
// on SessionStore (session-store.ts lines 771-851 in the pre-Wave-2 source). The
// path-normalization contract is preserved BYTE-IDENTICAL — these functions only
// rewrite *_path columns through `resolveStoredPath`, leaving every other column
// untouched.
//
// Each function takes `(row, resolveStoredPath)` so it stays decoupled from the
// `StoragePathResolver` constructor; facades pass `paths.resolveStoredPath`
// directly. Overload chains are preserved so call sites that pass a non-null row
// continue to receive a non-null row in the static type system (matters under
// `noUncheckedIndexedAccess`).

import type {
  AiCleanupJobRow,
  ChunkRow,
  MeetingNotesDraftRow,
  SessionRow,
  SttJobRow,
} from "./rows.js";

export type ResolveStoredPath = (filePath: string | null) => string | null;

export function mapSessionRow(
  row: SessionRow,
  resolveStoredPath: ResolveStoredPath,
): SessionRow;
export function mapSessionRow(
  row: SessionRow | null,
  resolveStoredPath: ResolveStoredPath,
): SessionRow | null;
export function mapSessionRow(
  row: SessionRow | null,
  resolveStoredPath: ResolveStoredPath,
): SessionRow | null {
  return row
    ? { ...row, data_dir: resolveStoredPath(row.data_dir) ?? row.data_dir }
    : null;
}

export function mapChunkRow(
  row: ChunkRow,
  resolveStoredPath: ResolveStoredPath,
): ChunkRow;
export function mapChunkRow(
  row: ChunkRow | null,
  resolveStoredPath: ResolveStoredPath,
): ChunkRow | null;
export function mapChunkRow(
  row: ChunkRow | null,
  resolveStoredPath: ResolveStoredPath,
): ChunkRow | null {
  return row
    ? {
        ...row,
        raw_audio_path:
          resolveStoredPath(row.raw_audio_path) ?? row.raw_audio_path,
        stt_audio_path:
          resolveStoredPath(row.stt_audio_path) ?? row.stt_audio_path,
      }
    : null;
}

export function mapSttJobRow(
  row: SttJobRow,
  resolveStoredPath: ResolveStoredPath,
): SttJobRow;
export function mapSttJobRow(
  row: SttJobRow | null,
  resolveStoredPath: ResolveStoredPath,
): SttJobRow | null;
export function mapSttJobRow(
  row: SttJobRow | null,
  resolveStoredPath: ResolveStoredPath,
): SttJobRow | null {
  return row
    ? {
        ...row,
        input_audio_path:
          resolveStoredPath(row.input_audio_path) ?? row.input_audio_path,
      }
    : null;
}

export function mapAiCleanupJobRow(
  row: AiCleanupJobRow,
  resolveStoredPath: ResolveStoredPath,
): AiCleanupJobRow;
export function mapAiCleanupJobRow(
  row: AiCleanupJobRow | null,
  resolveStoredPath: ResolveStoredPath,
): AiCleanupJobRow | null;
export function mapAiCleanupJobRow(
  row: AiCleanupJobRow | null,
  resolveStoredPath: ResolveStoredPath,
): AiCleanupJobRow | null {
  return row
    ? {
        ...row,
        input_timeline_json_path:
          resolveStoredPath(row.input_timeline_json_path) ??
          row.input_timeline_json_path,
        input_timeline_markdown_path:
          resolveStoredPath(row.input_timeline_markdown_path) ??
          row.input_timeline_markdown_path,
        prompt_path:
          resolveStoredPath(row.prompt_path) ?? row.prompt_path,
        raw_output_path:
          resolveStoredPath(row.raw_output_path) ?? row.raw_output_path,
        stderr_path: resolveStoredPath(row.stderr_path) ?? row.stderr_path,
        parsed_json_path:
          resolveStoredPath(row.parsed_json_path) ?? row.parsed_json_path,
        markdown_path:
          resolveStoredPath(row.markdown_path) ?? row.markdown_path,
      }
    : null;
}

export function mapMeetingNotesDraftRow(
  row: MeetingNotesDraftRow,
  resolveStoredPath: ResolveStoredPath,
): MeetingNotesDraftRow;
export function mapMeetingNotesDraftRow(
  row: MeetingNotesDraftRow | null,
  resolveStoredPath: ResolveStoredPath,
): MeetingNotesDraftRow | null;
export function mapMeetingNotesDraftRow(
  row: MeetingNotesDraftRow | null,
  resolveStoredPath: ResolveStoredPath,
): MeetingNotesDraftRow | null {
  return row
    ? {
        ...row,
        json_path: resolveStoredPath(row.json_path) ?? row.json_path,
        markdown_path:
          resolveStoredPath(row.markdown_path) ?? row.markdown_path,
        raw_output_path:
          resolveStoredPath(row.raw_output_path) ?? row.raw_output_path,
      }
    : null;
}
