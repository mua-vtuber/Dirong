import { redactSensitiveText } from "../errors.js";
import { formatLocaleText, t } from "../i18n/catalog.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
import type { AloneFinalizeSnapshot } from "./alone-finalize-service.js";

export type AloneFinalizeCountdownState = {
  sessionId: string;
  voiceChannelId: string;
  aloneSinceMs: number;
  finalizeAtMs: number;
};

export type AloneFinalizeSnapshotEvent =
  | { type: "stopped"; enabled: boolean; checkedAt: string }
  | {
      type: "countdown_refreshed";
      checkedAt: string;
      nonBotMemberCount: number;
    }
  | {
      type: "idle";
      checkedAt: string;
      sessionId: string | null;
      voiceChannelId: string | null;
      nonBotMemberCount: number | null;
      clearCountdown: boolean;
    }
  | {
      type: "countdown_started";
      checkedAt: string;
      sessionId: string;
      voiceChannelId: string;
      aloneSince: string;
      finalizeAt: string;
      remainingMs: number;
    }
  | {
      type: "deferred_reconnecting";
      checkedAt: string;
      sessionId: string;
      voiceChannelId: string;
    }
  | {
      type: "skipped";
      checkedAt: string;
      sessionId: string | null;
      voiceChannelId: string | null;
      nonBotMemberCount: number | null;
      message: string;
      userAction: string | null;
      technicalDetail: string | null;
      warnings: string[];
      clearCountdown: boolean;
    }
  | {
      type: "triggering";
      checkedAt: string;
      sessionId: string;
      voiceChannelId: string;
    }
  | {
      type: "finalized";
      checkedAt: string;
      sessionId: string;
      voiceChannelId: string;
      resultStatus: string;
    }
  | {
      type: "failed";
      checkedAt: string;
      sessionId: string;
      voiceChannelId: string;
      technicalDetail: string;
    };

export function createInitialAloneFinalizeSnapshot(
  enabled: boolean,
  locale?: DirongLocale,
): AloneFinalizeSnapshot {
  return makeAloneFinalizeSnapshot({
    enabled,
    status: enabled ? "idle" : "disabled",
    checkedAt: null,
    sessionId: null,
    voiceChannelId: null,
    aloneSince: null,
    finalizeAt: null,
    remainingMs: null,
    nonBotMemberCount: null,
    message: enabled
      ? t(locale, "runtimeStatus.aloneFinalize.idle.message")
      : t(locale, "runtimeStatus.aloneFinalize.disabled.message"),
    userAction: enabled
      ? null
      : t(locale, "runtimeStatus.aloneFinalize.disabled.action"),
    technicalDetail: null,
    warnings: [],
  });
}

export function reduceAloneFinalizeSnapshot(
  snapshot: AloneFinalizeSnapshot,
  event: AloneFinalizeSnapshotEvent,
  locale?: DirongLocale,
): AloneFinalizeSnapshot {
  switch (event.type) {
    case "stopped":
      return makeAloneFinalizeSnapshot({
        ...snapshot,
        status: event.enabled ? "stopped" : "disabled",
        checkedAt: event.checkedAt,
        message: event.enabled
          ? t(locale, "runtimeStatus.aloneFinalize.stopped.message")
          : t(locale, "runtimeStatus.aloneFinalize.disabled.message"),
        userAction: null,
      });
    case "countdown_refreshed":
      return makeAloneFinalizeSnapshot({
        ...snapshot,
        checkedAt: event.checkedAt,
        nonBotMemberCount: event.nonBotMemberCount,
      });
    case "idle":
      return makeAloneFinalizeSnapshot({
        ...clearCountdownFields(snapshot, event.clearCountdown),
        status: "idle",
        checkedAt: event.checkedAt,
        sessionId: event.sessionId,
        voiceChannelId: event.voiceChannelId,
        nonBotMemberCount: event.nonBotMemberCount,
        message: t(locale, "runtimeStatus.aloneFinalize.idle.message"),
        userAction: null,
        technicalDetail: null,
        warnings: [],
      });
    case "countdown_started":
      return makeAloneFinalizeSnapshot({
        ...snapshot,
        status: "countdown",
        checkedAt: event.checkedAt,
        sessionId: event.sessionId,
        voiceChannelId: event.voiceChannelId,
        aloneSince: event.aloneSince,
        finalizeAt: event.finalizeAt,
        remainingMs: event.remainingMs,
        nonBotMemberCount: 0,
        message: countdownMessage(event.remainingMs, locale),
        userAction: t(locale, "runtimeStatus.aloneFinalize.countdown.action"),
        technicalDetail: null,
        warnings: [],
      });
    case "deferred_reconnecting":
      return makeAloneFinalizeSnapshot({
        ...snapshot,
        status: "deferred_reconnecting",
        checkedAt: event.checkedAt,
        sessionId: event.sessionId,
        voiceChannelId: event.voiceChannelId,
        aloneSince: null,
        finalizeAt: null,
        remainingMs: null,
        nonBotMemberCount: 0,
        message: t(locale, "runtimeStatus.aloneFinalize.deferredReconnecting.message"),
        userAction: t(locale, "runtimeStatus.aloneFinalize.deferredReconnecting.action"),
        technicalDetail: null,
        warnings: ["reconnecting"],
      });
    case "skipped":
      return makeAloneFinalizeSnapshot({
        ...clearCountdownFields(snapshot, event.clearCountdown),
        status: "skipped",
        checkedAt: event.checkedAt,
        sessionId: event.sessionId,
        voiceChannelId: event.voiceChannelId,
        nonBotMemberCount: event.nonBotMemberCount,
        message: event.message,
        userAction: event.userAction,
        technicalDetail: event.technicalDetail,
        warnings: event.warnings,
      });
    case "triggering":
      return makeAloneFinalizeSnapshot({
        ...snapshot,
        status: "triggering",
        checkedAt: event.checkedAt,
        sessionId: event.sessionId,
        voiceChannelId: event.voiceChannelId,
        aloneSince: null,
        finalizeAt: null,
        remainingMs: null,
        nonBotMemberCount: 0,
        message: t(locale, "runtimeStatus.aloneFinalize.triggering.message"),
        userAction: null,
        technicalDetail: null,
        warnings: [],
      });
    case "finalized":
      return makeAloneFinalizeSnapshot({
        ...snapshot,
        status: "finalized",
        checkedAt: event.checkedAt,
        sessionId: event.sessionId,
        voiceChannelId: event.voiceChannelId,
        message: formatLocaleText(
          locale,
          "runtimeStatus.aloneFinalize.finalized.message",
          { status: event.resultStatus },
        ),
        userAction: null,
        technicalDetail: null,
        warnings: event.resultStatus === "finalized" ? [] : [`session_${event.resultStatus}`],
      });
    case "failed":
      return makeAloneFinalizeSnapshot({
        ...snapshot,
        status: "failed",
        checkedAt: event.checkedAt,
        sessionId: event.sessionId,
        voiceChannelId: event.voiceChannelId,
        message: t(locale, "runtimeStatus.aloneFinalize.failed.message"),
        userAction: t(locale, "runtimeStatus.aloneFinalize.failed.action"),
        technicalDetail: event.technicalDetail,
        warnings: ["alone_finalize_failed"],
      });
  }
}

export function withDynamicAloneFinalizeCountdown(
  snapshot: AloneFinalizeSnapshot,
  countdown: AloneFinalizeCountdownState | null,
  nowMs: number,
  locale?: DirongLocale,
): AloneFinalizeSnapshot {
  if (snapshot.status !== "countdown" || !countdown) {
    return snapshot;
  }
  const remainingMs = Math.max(0, countdown.finalizeAtMs - nowMs);
  return {
    ...snapshot,
    remainingMs,
    message: countdownMessage(remainingMs, locale),
  };
}

export function cloneAloneFinalizeSnapshot(
  snapshot: AloneFinalizeSnapshot,
): AloneFinalizeSnapshot {
  return {
    ...snapshot,
    warnings: [...snapshot.warnings],
  };
}

function makeAloneFinalizeSnapshot(
  snapshot: AloneFinalizeSnapshot,
): AloneFinalizeSnapshot {
  return cloneAloneFinalizeSnapshot({
    ...snapshot,
    technicalDetail:
      snapshot.technicalDetail === null
        ? null
        : redactSensitiveText(snapshot.technicalDetail),
  });
}

function clearCountdownFields(
  snapshot: AloneFinalizeSnapshot,
  clear: boolean,
): AloneFinalizeSnapshot {
  if (!clear) {
    return snapshot;
  }
  return {
    ...snapshot,
    aloneSince: null,
    finalizeAt: null,
    remainingMs: null,
  };
}

function countdownMessage(remainingMs: number, locale?: DirongLocale): string {
  return formatLocaleText(
    locale,
    "runtimeStatus.aloneFinalize.countdown.message",
    { seconds: Math.ceil(remainingMs / 1000) },
  );
}
