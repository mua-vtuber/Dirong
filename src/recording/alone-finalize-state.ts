import { redactSensitiveText } from "../errors.js";
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
      ? "혼자 남음 자동 종료 대기 중"
      : "혼자 남음 자동 종료가 꺼져 있습니다.",
    userAction: enabled
      ? null
      : "DIRONG_ALONE_FINALIZE_ENABLED=true로 명시 opt-in해야 동작합니다.",
    technicalDetail: null,
    warnings: [],
  });
}

export function reduceAloneFinalizeSnapshot(
  snapshot: AloneFinalizeSnapshot,
  event: AloneFinalizeSnapshotEvent,
): AloneFinalizeSnapshot {
  switch (event.type) {
    case "stopped":
      return makeAloneFinalizeSnapshot({
        ...snapshot,
        status: event.enabled ? "stopped" : "disabled",
        checkedAt: event.checkedAt,
        message: event.enabled
          ? "혼자 남음 자동 종료 중지됨"
          : "혼자 남음 자동 종료가 꺼져 있습니다.",
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
        message: "혼자 남음 자동 종료 대기 중",
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
        message: countdownMessage(event.remainingMs),
        userAction: "grace 시간 안에 사람이 돌아오면 자동 종료가 취소됩니다.",
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
        message: "혼자 남음 감지됨: Discord 재연결 중이라 자동 종료를 보류했습니다.",
        userAction: "연결이 안정되면 다시 확인합니다. 녹음 데이터는 보존됩니다.",
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
        message: "혼자 남음 grace가 끝나 녹음을 자동 종료하는 중",
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
        message: `혼자 남음으로 녹음을 자동 종료했습니다. 상태: ${event.resultStatus}`,
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
        message: "혼자 남음 자동 종료 실패. 녹음/STT 데이터는 보존됩니다.",
        userAction: "dashboard와 로그를 확인한 뒤 필요하면 /dirong stop을 실행해 주세요.",
        technicalDetail: event.technicalDetail,
        warnings: ["alone_finalize_failed"],
      });
  }
}

export function withDynamicAloneFinalizeCountdown(
  snapshot: AloneFinalizeSnapshot,
  countdown: AloneFinalizeCountdownState | null,
  nowMs: number,
): AloneFinalizeSnapshot {
  if (snapshot.status !== "countdown" || !countdown) {
    return snapshot;
  }
  const remainingMs = Math.max(0, countdown.finalizeAtMs - nowMs);
  return {
    ...snapshot,
    remainingMs,
    message: countdownMessage(remainingMs),
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

function countdownMessage(remainingMs: number): string {
  return `혼자 남음 감지, ${Math.ceil(remainingMs / 1000)}초 후 자동 종료`;
}
