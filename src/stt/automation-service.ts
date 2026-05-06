import { redactSensitiveText } from "../errors.js";
import type { SessionStore } from "../storage/session-store.js";
import type { SttProvider } from "./provider.js";
import { runSttBatch, type SttRunResult } from "./runner.js";

export type SttAutomationStatus =
  | "disabled"
  | "idle"
  | "running"
  | "done"
  | "failed"
  | "stopped";

export type SttAutomationSnapshot = {
  enabled: boolean;
  status: SttAutomationStatus;
  provider: string;
  model: string;
  checkedAt: string | null;
  message: string;
  userAction: string | null;
  technicalDetail: string | null;
  lastRun: SttRunResult | null;
};

export type SttAutomationServiceOptions = {
  enabled: boolean;
  provider: SttProvider;
  pollIntervalMs: number;
  batchLimit: number;
  runner: {
    workerId: string;
    leaseMs: number;
    language: string | null;
    timeoutMs: number;
    contextSegments: number;
  };
};

export class SttAutomationService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickPromise: Promise<SttAutomationSnapshot> | null = null;
  private started = false;
  private stopping = false;
  private snapshot: SttAutomationSnapshot;

  constructor(
    private readonly store: SessionStore,
    private readonly options: SttAutomationServiceOptions,
  ) {
    this.snapshot = makeSnapshot({
      enabled: options.enabled,
      status: options.enabled ? "idle" : "disabled",
      provider: options.provider.providerName,
      model: options.provider.modelName,
      checkedAt: null,
      message: options.enabled
        ? "STT 자동 실행 대기 중"
        : "STT 자동 실행이 꺼져 있습니다.",
      userAction: options.enabled ? null : "필요하면 수동 Phase 3 STT CLI를 실행해 주세요.",
      technicalDetail: null,
      lastRun: null,
    });
  }

  start(): void {
    if (this.started || !this.options.enabled) {
      return;
    }
    this.started = true;
    this.stopping = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.tickPromise) {
      await this.tickPromise;
    }
    this.snapshot = makeSnapshot({
      ...this.snapshot,
      status: "stopped",
      checkedAt: new Date().toISOString(),
      message: "STT 자동 실행 중지됨",
      userAction: null,
    });
  }

  getSnapshot(): SttAutomationSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  async runOnce(): Promise<SttAutomationSnapshot> {
    if (!this.options.enabled) {
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "disabled",
        checkedAt: new Date().toISOString(),
        message: "STT 자동 실행이 꺼져 있습니다.",
        userAction: "필요하면 수동 Phase 3 STT CLI를 실행해 주세요.",
      });
      return this.getSnapshot();
    }

    if (this.tickPromise) {
      return await this.tickPromise;
    }

    this.tickPromise = this.tick();
    try {
      return await this.tickPromise;
    } finally {
      this.tickPromise = null;
    }
  }

  private schedule(delayMs: number): void {
    if (!this.started || this.stopping) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runScheduledTick();
    }, Math.max(0, delayMs));
    this.timer.unref?.();
  }

  private async runScheduledTick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.snapshot = makeSnapshot({
        ...this.snapshot,
        status: "failed",
        checkedAt: new Date().toISOString(),
        message: "STT 자동 실행 중 오류가 발생했습니다.",
        userAction: "녹음 파일은 보존됩니다. STT 설정과 로그를 확인해 주세요.",
        technicalDetail: summarizeError(error),
      });
    } finally {
      this.schedule(this.options.pollIntervalMs);
    }
  }

  private async tick(): Promise<SttAutomationSnapshot> {
    this.snapshot = makeSnapshot({
      ...this.snapshot,
      status: "running",
      checkedAt: new Date().toISOString(),
      message: "STT queued job 확인 중",
      userAction: null,
      technicalDetail: null,
    });

    const result = await runSttBatch(this.store, {
      workerId: this.options.runner.workerId,
      limit: this.options.batchLimit,
      leaseMs: this.options.runner.leaseMs,
      dryRun: false,
      source: "real",
      provider: this.options.provider,
      language: this.options.runner.language,
      timeoutMs: this.options.runner.timeoutMs,
      contextSegments: this.options.runner.contextSegments,
    });

    const failed = result.failed + result.missingAudio;
    this.snapshot = makeSnapshot({
      ...this.snapshot,
      status:
        result.examined === 0
          ? "idle"
          : failed > 0 && result.done === 0
            ? "failed"
            : "done",
      checkedAt: new Date().toISOString(),
      message: messageForResult(result),
      userAction:
        failed > 0
          ? "실패한 STT job은 dashboard와 로그를 확인해 주세요."
          : null,
      technicalDetail:
        failed > 0
          ? summarizeFailedSamples(result)
          : null,
      lastRun: result,
    });

    return this.getSnapshot();
  }
}

export function formatSttAutomationForStatus(
  snapshot: SttAutomationSnapshot,
): string {
  const lines = [
    `STT 자동화: ${snapshot.message}`,
    `STT provider: ${snapshot.provider} / ${snapshot.model}`,
  ];
  if (snapshot.lastRun) {
    lines.push(
      [
        "STT batch:",
        `examined:${snapshot.lastRun.examined}`,
        `done:${snapshot.lastRun.done}`,
        `missing:${snapshot.lastRun.missingAudio}`,
        `failed:${snapshot.lastRun.failed}`,
        `more:${snapshot.lastRun.remainingQueuedHint > 0 ? "yes" : "no"}`,
      ].join(" "),
    );
  }
  if (snapshot.userAction) {
    lines.push(`STT 조치: ${snapshot.userAction}`);
  }
  return lines.join("\n");
}

function messageForResult(result: SttRunResult): string {
  if (result.examined === 0) {
    return "STT 자동 실행 대기 중: queued job 없음";
  }
  const failed = result.failed + result.missingAudio;
  if (failed > 0 && result.done === 0) {
    return "STT 처리 실패. 녹음 파일과 job 상태는 보존됩니다.";
  }
  if (result.remainingQueuedHint > 0) {
    return "STT batch 처리 완료: 추가 queued job이 남아 있습니다.";
  }
  return "STT batch 처리 완료";
}

function summarizeFailedSamples(result: SttRunResult): string | null {
  const failures = result.samples
    .filter((sample) => sample.status.startsWith("failed"))
    .map((sample) => `${sample.jobId}: ${sample.error ?? sample.status}`);
  if (failures.length === 0) {
    return null;
  }
  return failures.slice(0, 3).join("\n");
}

function makeSnapshot(snapshot: SttAutomationSnapshot): SttAutomationSnapshot {
  return cloneSnapshot({
    ...snapshot,
    technicalDetail:
      snapshot.technicalDetail === null
        ? null
        : redactSensitiveText(snapshot.technicalDetail),
  });
}

function cloneSnapshot(snapshot: SttAutomationSnapshot): SttAutomationSnapshot {
  return {
    ...snapshot,
    lastRun: snapshot.lastRun
      ? {
          ...snapshot.lastRun,
          samples: snapshot.lastRun.samples.map((sample) => ({ ...sample })),
        }
      : null,
  };
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = redactSensitiveText(message);
  return redacted.length <= 1000 ? redacted : `${redacted.slice(0, 1000)}...`;
}
