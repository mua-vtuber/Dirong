import type { DashboardAudioKind } from "./security.js";
import { createSignedAudioPath } from "./security.js";
import type {
  DashboardAiReadinessSource,
  DashboardRuntimeSources,
} from "./server.js";
import { resolveAppLocale } from "../i18n/app-locale.js";
import { isRecord } from "./http.js";

export function appendAiReadinessToDashboardState(
  state: unknown,
  aiReadinessSource?: DashboardAiReadinessSource,
): unknown {
  return appendDashboardRuntimeSnapshots(state, {
    aiReadiness: aiReadinessSource,
  });
}

export function appendDashboardRuntimeSnapshots(
  state: unknown,
  sources: DashboardRuntimeSources = {},
): unknown {
  if (!isRecord(state)) {
    return state;
  }
  if (
    !sources.aiReadiness &&
    !sources.aiCleanupAutomation &&
    !sources.aloneFinalize &&
    !sources.notion &&
    !sources.notionAutomation &&
    !sources.setupStatus &&
    !sources.sttAutomation
  ) {
    return state;
  }

  const setupSnapshot = sources.setupStatus?.getSnapshot();
  const locale = resolveAppLocale({
    getLocale: () => sources.setupStatus?.getLocale?.(),
    locale: setupSnapshot?.locale,
  });

  return {
    ...state,
    ...(sources.aiReadiness
      ? { aiReadiness: sources.aiReadiness.getSnapshot(locale) }
      : {}),
    ...(sources.aiCleanupAutomation
      ? { aiCleanupAutomation: sources.aiCleanupAutomation.getSnapshot(locale) }
      : {}),
    ...(sources.aloneFinalize
      ? { aloneFinalize: sources.aloneFinalize.getSnapshot(locale) }
      : {}),
    ...(sources.notion
      ? { notion: sources.notion.getSnapshot() }
      : {}),
    ...(sources.notionAutomation
      ? { notionAutomation: sources.notionAutomation.getSnapshot(locale) }
      : {}),
    ...(sources.setupStatus
      ? { setup: setupSnapshot }
      : {}),
    ...(sources.setupWizard
      ? { setupWizard: sources.setupWizard.getState().wizard }
      : {}),
    ...(sources.sttAutomation
      ? { sttAutomation: sources.sttAutomation.getSnapshot(locale) }
      : {}),
  };
}

export function appendSignedAudioUrlsToDashboardState(
  state: unknown,
  audioTokenSecret: string,
): unknown {
  if (!isRecord(state) || !Array.isArray(state.recentChunks)) {
    return state;
  }

  return {
    ...state,
    recentChunks: state.recentChunks.map((chunk) => {
      if (!isRecord(chunk) || typeof chunk.id !== "string") {
        return chunk;
      }

      const audioUrls: Partial<Record<DashboardAudioKind, string>> = {};
      if (hasPositiveNumber(chunk.raw_byte_size) && chunk.status !== "writing") {
        audioUrls.raw = createSignedAudioPath({
          chunkId: chunk.id,
          kind: "raw",
          secret: audioTokenSecret,
        });
      }
      if (
        typeof chunk.stt_audio_path === "string" &&
        hasPositiveNumber(chunk.stt_byte_size) &&
        chunk.status !== "writing"
      ) {
        audioUrls.stt = createSignedAudioPath({
          chunkId: chunk.id,
          kind: "stt",
          secret: audioTokenSecret,
        });
      }

      return Object.keys(audioUrls).length > 0
        ? { ...chunk, audioUrls }
        : chunk;
    }),
  };
}

function hasPositiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
