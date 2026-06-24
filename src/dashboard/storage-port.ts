import type { RecordingRuntimeState } from "../storage/rows.js";
import type { DashboardAudioKind } from "./security.js";

export type DashboardStore = {
  getDashboardState(
    runtime: RecordingRuntimeState,
    activeProjectId: string | null,
  ): unknown;
  getAudioPathForChunk(
    chunkId: string,
    kind: DashboardAudioKind,
  ): { path: string; format: string } | null;
};
