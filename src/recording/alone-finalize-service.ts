import type { VoiceState } from "discord.js";
import { redactSensitiveText } from "../errors.js";
import type {
  RecordingRuntimeState,
  SessionStatus,
  SessionStore,
} from "../storage/session-store.js";

export type AloneFinalizeStatus =
  | "disabled"
  | "idle"
  | "countdown"
  | "deferred_reconnecting"
  | "triggering"
  | "finalized"
  | "skipped"
  | "failed"
  | "stopped";

export type AloneFinalizeSnapshot = {
  enabled: boolean;
  status: AloneFinalizeStatus;
  checkedAt: string | null;
  sessionId: string | null;
  voiceChannelId: string | null;
  aloneSince: string | null;
  finalizeAt: string | null;
  remainingMs: number | null;
  nonBotMemberCount: number | null;
  message: string;
  userAction: string | null;
  technicalDetail: string | null;
  warnings: string[];
};

export type AloneFinalizeMemberCountResult =
  | {
      ok: true;
      nonBotMemberCount: number;
      botMemberCount: number;
      totalMemberCount: number;
      source?: string;
    }
  | {
      ok: false;
      reason: string;
      technicalDetail?: string | null;
    };

export type AloneFinalizeStopResult = {
  sessionId: string;
  status: SessionStatus;
  sessionDir: string;
};

export type AloneFinalizeProducer = {
  getRuntimeState(): RecordingRuntimeState;
  stop(input: {
    stoppedByUserId: string;
    stoppedByDisplayName: string;
  }): Promise<AloneFinalizeStopResult>;
};

export type AloneFinalizeServiceOptions = {
  enabled: boolean;
  graceMs: number;
  store: SessionStore;
  producer: AloneFinalizeProducer;
  countNonBotMembers(
    voiceChannelId: string,
  ): Promise<AloneFinalizeMemberCountResult>;
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => AloneFinalizeTimer;
  clearTimeout?: (timer: AloneFinalizeTimer) => void;
};

type AloneFinalizeTimer = ReturnType<typeof setTimeout> & {
  unref?: () => void;
};

type CountdownState = {
  sessionId: string;
  voiceChannelId: string;
  aloneSinceMs: number;
  finalizeAtMs: number;
};

type VoiceStateLike = Pick<VoiceState, "channelId">;

export class AloneFinalizeService {
  private started = false;
  private timer: AloneFinalizeTimer | null = null;
  private countdown: CountdownState | null = null;
  private finalizePromise: Promise<void> | null = null;
  private snapshot: AloneFinalizeSnapshot;
  private readonly now: () => number;
  private readonly setTimer: (
    callback: () => void,
    delayMs: number,
  ) => AloneFinalizeTimer;
  private readonly clearTimer: (timer: AloneFinalizeTimer) => void;

  constructor(private readonly options: AloneFinalizeServiceOptions) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimeout ?? setTimeout;
    this.clearTimer = options.clearTimeout ?? clearTimeout;
    this.snapshot = makeSnapshot({
      enabled: options.enabled,
      status: options.enabled ? "idle" : "disabled",
      checkedAt: null,
      sessionId: null,
      voiceChannelId: null,
      aloneSince: null,
      finalizeAt: null,
      remainingMs: null,
      nonBotMemberCount: null,
      message: options.enabled
        ? "혼자 남음 자동 종료 대기 중"
        : "혼자 남음 자동 종료가 꺼져 있습니다.",
      userAction: options.enabled
        ? null
        : "DIRONG_ALONE_FINALIZE_ENABLED=true로 명시 opt-in해야 동작합니다.",
      technicalDetail: null,
      warnings: [],
    });
  }

  start(): void {
    if (this.started || !this.options.enabled) {
      return;
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.cancelCountdown({ recordEvent: false });
    if (this.finalizePromise) {
      await this.finalizePromise;
    }
    this.snapshot = makeSnapshot({
      ...this.snapshot,
      status: this.options.enabled ? "stopped" : "disabled",
      checkedAt: this.isoNow(),
      message: this.options.enabled
        ? "혼자 남음 자동 종료 중지됨"
        : "혼자 남음 자동 종료가 꺼져 있습니다.",
      userAction: null,
    });
  }

  getSnapshot(): AloneFinalizeSnapshot {
    return cloneSnapshot(this.withDynamicCountdown(this.snapshot));
  }

  async handleVoiceStateUpdate(
    oldState: VoiceStateLike,
    newState: VoiceStateLike,
  ): Promise<void> {
    if (!this.options.enabled || !this.started) {
      return;
    }

    const runtime = this.options.producer.getRuntimeState();
    if (!runtime.sessionId || !runtime.voiceChannelId) {
      this.cancelCountdown({ recordEvent: true, reason: "no_active_session" });
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "idle",
        checkedAt: this.isoNow(),
        sessionId: null,
        voiceChannelId: null,
        nonBotMemberCount: null,
        message: "혼자 남음 자동 종료 대기 중",
        userAction: null,
        technicalDetail: null,
        warnings: [],
      });
      return;
    }

    if (
      oldState.channelId !== runtime.voiceChannelId &&
      newState.channelId !== runtime.voiceChannelId
    ) {
      return;
    }

    await this.evaluateActiveSession(runtime);
  }

  private async evaluateActiveSession(
    runtime: RecordingRuntimeState,
  ): Promise<void> {
    if (!runtime.sessionId || !runtime.voiceChannelId) {
      return;
    }

    const session = this.options.store.getSession(runtime.sessionId);
    if (!session) {
      this.cancelCountdown({ recordEvent: false });
      this.recordImmediateSkipped({
        sessionId: null,
        voiceChannelId: runtime.voiceChannelId,
        reason: "session_not_found",
        level: "warn",
      });
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "skipped",
        checkedAt: this.isoNow(),
        sessionId: runtime.sessionId,
        voiceChannelId: runtime.voiceChannelId,
        message: "혼자 남음 자동 종료 건너뜀: 세션을 찾지 못했습니다.",
        userAction: "녹음 상태와 dashboard를 확인해 주세요.",
        technicalDetail: null,
        warnings: ["session_not_found"],
      });
      return;
    }

    if (isFinalStopState(session.status)) {
      this.cancelCountdown({ recordEvent: false });
      this.recordImmediateSkipped({
        sessionId: session.id,
        voiceChannelId: runtime.voiceChannelId,
        reason: `session_${session.status}`,
        level: "info",
      });
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "skipped",
        checkedAt: this.isoNow(),
        sessionId: session.id,
        voiceChannelId: runtime.voiceChannelId,
        nonBotMemberCount: null,
        message: `혼자 남음 자동 종료 건너뜀: 세션 상태가 ${session.status}입니다.`,
        userAction: null,
        technicalDetail: null,
        warnings: [],
      });
      return;
    }

    const memberCount = await this.options.countNonBotMembers(runtime.voiceChannelId);
    if (!memberCount.ok) {
      this.cancelCountdown({ recordEvent: false });
      this.recordImmediateSkipped({
        sessionId: session.id,
        voiceChannelId: runtime.voiceChannelId,
        reason: memberCount.reason,
        level: "warn",
        technicalDetail: memberCount.technicalDetail ?? null,
      });
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "skipped",
        checkedAt: this.isoNow(),
        sessionId: session.id,
        voiceChannelId: runtime.voiceChannelId,
        nonBotMemberCount: null,
        message: "혼자 남음 자동 종료 건너뜀: 음성 채널 인원을 정확히 확인하지 못했습니다.",
        userAction: "녹음은 계속됩니다. dashboard와 Discord 채널 상태를 확인해 주세요.",
        technicalDetail: memberCount.technicalDetail ?? memberCount.reason,
        warnings: [memberCount.reason],
      });
      return;
    }

    if (memberCount.nonBotMemberCount > 0) {
      this.cancelCountdown({
        recordEvent: true,
        reason: "human_returned",
        nonBotMemberCount: memberCount.nonBotMemberCount,
      });
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "idle",
        checkedAt: this.isoNow(),
        sessionId: session.id,
        voiceChannelId: runtime.voiceChannelId,
        nonBotMemberCount: memberCount.nonBotMemberCount,
        message: "혼자 남음 자동 종료 대기 중",
        userAction: null,
        technicalDetail: null,
        warnings: [],
      });
      return;
    }

    if (session.status === "reconnecting") {
      this.cancelCountdown({ recordEvent: false });
      this.options.store.recordConnectionEvent({
        sessionId: session.id,
        eventType: "alone_deferred_reconnecting",
        level: "warn",
        details: {
          voiceChannelId: runtime.voiceChannelId,
          nonBotMemberCount: memberCount.nonBotMemberCount,
        },
      });
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "deferred_reconnecting",
        checkedAt: this.isoNow(),
        sessionId: session.id,
        voiceChannelId: runtime.voiceChannelId,
        aloneSince: null,
        finalizeAt: null,
        remainingMs: null,
        nonBotMemberCount: 0,
        message: "혼자 남음 감지됨: Discord 재연결 중이라 자동 종료를 보류했습니다.",
        userAction: "연결이 안정되면 다시 확인합니다. 녹음 데이터는 보존됩니다.",
        technicalDetail: null,
        warnings: ["reconnecting"],
      });
      return;
    }

    if (session.status !== "active") {
      this.cancelCountdown({ recordEvent: false });
      this.recordImmediateSkipped({
        sessionId: session.id,
        voiceChannelId: runtime.voiceChannelId,
        reason: `session_${session.status}`,
        level: "info",
      });
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "skipped",
        checkedAt: this.isoNow(),
        sessionId: session.id,
        voiceChannelId: runtime.voiceChannelId,
        nonBotMemberCount: 0,
        message: `혼자 남음 자동 종료 건너뜀: 세션 상태가 ${session.status}입니다.`,
        userAction: null,
        technicalDetail: null,
        warnings: [],
      });
      return;
    }

    this.startCountdown(session.id, runtime.voiceChannelId, memberCount);
  }

  private startCountdown(
    sessionId: string,
    voiceChannelId: string,
    memberCount: Extract<AloneFinalizeMemberCountResult, { ok: true }>,
  ): void {
    if (
      this.countdown?.sessionId === sessionId &&
      this.countdown.voiceChannelId === voiceChannelId
    ) {
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        checkedAt: this.isoNow(),
        nonBotMemberCount: memberCount.nonBotMemberCount,
      });
      return;
    }

    this.cancelCountdown({ recordEvent: false });
    const aloneSinceMs = this.now();
    const finalizeAtMs = aloneSinceMs + Math.max(1, this.options.graceMs);
    this.countdown = {
      sessionId,
      voiceChannelId,
      aloneSinceMs,
      finalizeAtMs,
    };
    this.timer = this.setTimer(() => {
      const countdown = this.countdown;
      this.timer = null;
      if (!countdown) {
        return;
      }
      this.finalizePromise = this.handleGraceExpired(countdown).finally(() => {
        this.finalizePromise = null;
      });
    }, Math.max(1, this.options.graceMs));
    this.timer.unref?.();

    this.options.store.recordConnectionEvent({
      sessionId,
      eventType: "alone_since",
      level: "warn",
      details: {
        voiceChannelId,
        aloneSince: this.isoFromMs(aloneSinceMs),
        finalizeAt: this.isoFromMs(finalizeAtMs),
        graceMs: this.options.graceMs,
        nonBotMemberCount: memberCount.nonBotMemberCount,
        botMemberCount: memberCount.botMemberCount,
        totalMemberCount: memberCount.totalMemberCount,
      },
    });

    this.snapshot = makeSnapshot({
      ...this.snapshot,
      status: "countdown",
      checkedAt: this.isoNow(),
      sessionId,
      voiceChannelId,
      aloneSince: this.isoFromMs(aloneSinceMs),
      finalizeAt: this.isoFromMs(finalizeAtMs),
      remainingMs: Math.max(0, finalizeAtMs - this.now()),
      nonBotMemberCount: 0,
      message: countdownMessage(Math.max(0, finalizeAtMs - this.now())),
      userAction: "grace 시간 안에 사람이 돌아오면 자동 종료가 취소됩니다.",
      technicalDetail: null,
      warnings: [],
    });
  }

  private async handleGraceExpired(countdown: CountdownState): Promise<void> {
    this.countdown = null;
    const runtime = this.options.producer.getRuntimeState();
    if (
      runtime.sessionId !== countdown.sessionId ||
      runtime.voiceChannelId !== countdown.voiceChannelId
    ) {
      this.recordSkipped(countdown, "active_session_changed", "info");
      return;
    }

    const session = this.options.store.getSession(countdown.sessionId);
    if (!session) {
      this.recordSkipped(countdown, "session_not_found", "warn");
      return;
    }

    if (session.status === "reconnecting") {
      this.options.store.recordConnectionEvent({
        sessionId: session.id,
        eventType: "alone_deferred_reconnecting",
        level: "warn",
        details: { voiceChannelId: countdown.voiceChannelId },
      });
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "deferred_reconnecting",
        checkedAt: this.isoNow(),
        sessionId: session.id,
        voiceChannelId: countdown.voiceChannelId,
        aloneSince: null,
        finalizeAt: null,
        remainingMs: null,
        nonBotMemberCount: 0,
        message: "혼자 남음 감지됨: Discord 재연결 중이라 자동 종료를 보류했습니다.",
        userAction: "연결이 안정되면 다시 확인합니다. 녹음 데이터는 보존됩니다.",
        technicalDetail: null,
        warnings: ["reconnecting"],
      });
      return;
    }

    if (session.status !== "active") {
      this.recordSkipped(countdown, `session_${session.status}`, "info");
      return;
    }

    const memberCount = await this.options.countNonBotMembers(countdown.voiceChannelId);
    if (!memberCount.ok) {
      this.recordSkipped(
        countdown,
        memberCount.reason,
        "warn",
        memberCount.technicalDetail ?? null,
      );
      return;
    }

    if (memberCount.nonBotMemberCount > 0) {
      this.options.store.recordConnectionEvent({
        sessionId: countdown.sessionId,
        eventType: "alone_cancelled",
        details: {
          reason: "human_returned_before_expiry_check",
          nonBotMemberCount: memberCount.nonBotMemberCount,
        },
      });
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "idle",
        checkedAt: this.isoNow(),
        sessionId: countdown.sessionId,
        voiceChannelId: countdown.voiceChannelId,
        aloneSince: null,
        finalizeAt: null,
        remainingMs: null,
        nonBotMemberCount: memberCount.nonBotMemberCount,
        message: "혼자 남음 자동 종료 대기 중",
        userAction: null,
        technicalDetail: null,
        warnings: [],
      });
      return;
    }

    this.options.store.recordConnectionEvent({
      sessionId: countdown.sessionId,
      eventType: "alone_finalize_triggered",
      level: "warn",
      details: {
        voiceChannelId: countdown.voiceChannelId,
        aloneSince: this.isoFromMs(countdown.aloneSinceMs),
        graceMs: this.options.graceMs,
        nonBotMemberCount: memberCount.nonBotMemberCount,
        botMemberCount: memberCount.botMemberCount,
        totalMemberCount: memberCount.totalMemberCount,
      },
    });
    this.snapshot = makeSnapshot({
      ...this.snapshot,
      status: "triggering",
      checkedAt: this.isoNow(),
      sessionId: countdown.sessionId,
      voiceChannelId: countdown.voiceChannelId,
      aloneSince: null,
      finalizeAt: null,
      remainingMs: null,
      nonBotMemberCount: 0,
      message: "혼자 남음 grace가 끝나 녹음을 자동 종료하는 중",
      userAction: null,
      technicalDetail: null,
      warnings: [],
    });

    try {
      const result = await this.options.producer.stop({
        stoppedByUserId: "system_alone",
        stoppedByDisplayName: "디롱이 자동 종료",
      });
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "finalized",
        checkedAt: this.isoNow(),
        sessionId: result.sessionId,
        voiceChannelId: countdown.voiceChannelId,
        message: `혼자 남음으로 녹음을 자동 종료했습니다. 상태: ${result.status}`,
        userAction: null,
        technicalDetail: null,
        warnings: result.status === "finalized" ? [] : [`session_${result.status}`],
      });
    } catch (error) {
      const detail = summarizeError(error);
      this.options.store.recordConnectionEvent({
        sessionId: countdown.sessionId,
        eventType: "alone_finalize_failed",
        level: "error",
        details: { error: detail },
      });
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "failed",
        checkedAt: this.isoNow(),
        sessionId: countdown.sessionId,
        voiceChannelId: countdown.voiceChannelId,
        message: "혼자 남음 자동 종료 실패. 녹음/STT 데이터는 보존됩니다.",
        userAction: "dashboard와 로그를 확인한 뒤 필요하면 /dirong stop을 실행해 주세요.",
        technicalDetail: detail,
        warnings: ["alone_finalize_failed"],
      });
    }
  }

  private recordSkipped(
    countdown: CountdownState,
    reason: string,
    level: "info" | "warn",
    technicalDetail: string | null = null,
  ): void {
    this.options.store.recordConnectionEvent({
      sessionId: countdown.sessionId,
      eventType: "alone_finalize_skipped",
      level,
      details: {
        reason,
        voiceChannelId: countdown.voiceChannelId,
        technicalDetail,
      },
    });
    this.snapshot = makeSnapshot({
      ...this.snapshot,
      status: "skipped",
      checkedAt: this.isoNow(),
      sessionId: countdown.sessionId,
      voiceChannelId: countdown.voiceChannelId,
      aloneSince: null,
      finalizeAt: null,
      remainingMs: null,
      nonBotMemberCount: null,
      message: "혼자 남음 자동 종료를 건너뛰었습니다. 녹음은 계속됩니다.",
      userAction: "자동 종료 조건을 안전하게 확인하지 못했습니다. dashboard 상태를 확인해 주세요.",
      technicalDetail,
      warnings: [reason],
    });
  }

  private recordImmediateSkipped(input: {
    sessionId: string | null;
    voiceChannelId: string;
    reason: string;
    level: "info" | "warn";
    technicalDetail?: string | null;
  }): void {
    this.options.store.recordConnectionEvent({
      sessionId: input.sessionId,
      eventType: "alone_finalize_skipped",
      level: input.level,
      details: {
        reason: input.reason,
        voiceChannelId: input.voiceChannelId,
        technicalDetail: input.technicalDetail ?? null,
      },
    });
  }

  private cancelCountdown(input: {
    recordEvent: boolean;
    reason?: string;
    level?: "debug" | "info" | "warn" | "error";
    technicalDetail?: string | null;
    nonBotMemberCount?: number;
  }): void {
    const countdown = this.countdown;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.countdown = null;
    if (!countdown || !input.recordEvent) {
      return;
    }

    this.options.store.recordConnectionEvent({
      sessionId: countdown.sessionId,
      eventType: "alone_cancelled",
      level: input.level ?? "info",
      details: {
        reason: input.reason ?? "cancelled",
        voiceChannelId: countdown.voiceChannelId,
        nonBotMemberCount: input.nonBotMemberCount ?? null,
        technicalDetail: input.technicalDetail ?? null,
      },
    });
  }

  private withDynamicCountdown(
    snapshot: AloneFinalizeSnapshot,
  ): AloneFinalizeSnapshot {
    if (snapshot.status !== "countdown" || !this.countdown) {
      return snapshot;
    }
    const remainingMs = Math.max(0, this.countdown.finalizeAtMs - this.now());
    return {
      ...snapshot,
      remainingMs,
      message: countdownMessage(remainingMs),
    };
  }

  private isoNow(): string {
    return this.isoFromMs(this.now());
  }

  private isoFromMs(ms: number): string {
    return new Date(ms).toISOString();
  }
}

export function formatAloneFinalizeForStatus(
  snapshot: AloneFinalizeSnapshot,
): string {
  const lines = [
    `혼자 남음 자동 종료: ${snapshot.message}`,
  ];
  if (snapshot.sessionId) {
    lines.push(`혼자 남음 세션: ${snapshot.sessionId}`);
  }
  if (snapshot.status === "countdown" && snapshot.remainingMs !== null) {
    lines.push(`자동 종료까지: ${Math.ceil(snapshot.remainingMs / 1000)}초`);
  }
  if (snapshot.userAction) {
    lines.push(`혼자 남음 조치: ${snapshot.userAction}`);
  }
  return lines.join("\n");
}

function isFinalStopState(status: SessionStatus): boolean {
  return ["stopping", "finalized", "failed", "needs_repair"].includes(status);
}

function countdownMessage(remainingMs: number): string {
  return `혼자 남음 감지, ${Math.ceil(remainingMs / 1000)}초 후 자동 종료`;
}

function makeSnapshot(snapshot: AloneFinalizeSnapshot): AloneFinalizeSnapshot {
  return cloneSnapshot({
    ...snapshot,
    technicalDetail:
      snapshot.technicalDetail === null
        ? null
        : redactSensitiveText(snapshot.technicalDetail),
  });
}

function cloneSnapshot(snapshot: AloneFinalizeSnapshot): AloneFinalizeSnapshot {
  return {
    ...snapshot,
    warnings: [...snapshot.warnings],
  };
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = redactSensitiveText(message);
  return redacted.length <= 1000 ? redacted : `${redacted.slice(0, 1000)}...`;
}
