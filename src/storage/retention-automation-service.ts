import { summarizeSafeError } from "../errors.js";
import {
  resolveAppLocale,
  type AppLocaleResolver,
} from "../i18n/app-locale.js";
import { t, type LocaleKey } from "../i18n/catalog.js";
import {
  PollingLoop,
  type PollingLoopTimer,
} from "../runtime/polling-loop.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
import {
  buildExpiredTextArtifactDeletionPlans,
  executeRetentionDeletionPlan,
  type RetentionPolicy,
} from "./file-retention.js";
import type { DirongDatabase } from "./sqlite.js";

export type RetentionAutomationStatus =
  | "idle"
  | "running"
  | "done"
  | "failed"
  | "stopped";

export type RetentionAutomationSnapshot = {
  status: RetentionAutomationStatus;
  checkedAt: string | null;
  lastSweepDeletedFiles: number;
  lastSweepSessions: number;
  message: string;
  technicalDetail: string | null;
};

export type RetentionAutomationServiceOptions = {
  database: DirongDatabase;
  storageRoot: string | null;
  // 매 tick 호출되어 최신 settings 기반 RetentionPolicy를 반환해야 한다.
  // 시작 시점 스냅샷에 고정하면 사용자가 바꾼 보관 일수가 반영되지 않는다.
  getRetentionPolicy: () => RetentionPolicy;
  intervalMs: number;
  // 녹음 중 디스크 I/O 경합을 피하기 위한 안전 가드.
  isRecording?: () => boolean;
  now?: () => Date;
  localeResolver?: AppLocaleResolver;
  setTimeout?: (callback: () => void, delayMs: number) => PollingLoopTimer;
  clearTimeout?: (timer: PollingLoopTimer) => void;
};

const RETENTION_AUTOMATION_MESSAGE_KEYS: Record<
  RetentionAutomationStatus,
  LocaleKey
> = {
  idle: "runtimeStatus.retentionAutomation.idle.message",
  running: "runtimeStatus.retentionAutomation.running.message",
  done: "runtimeStatus.retentionAutomation.done.message",
  failed: "runtimeStatus.retentionAutomation.failed.message",
  stopped: "runtimeStatus.retentionAutomation.stopped.message",
};

export class RetentionAutomationService {
  private readonly loop: PollingLoop<RetentionAutomationSnapshot>;
  private snapshot: RetentionAutomationSnapshot;

  constructor(private readonly options: RetentionAutomationServiceOptions) {
    this.snapshot = {
      status: "idle",
      checkedAt: null,
      lastSweepDeletedFiles: 0,
      lastSweepSessions: 0,
      message: this.messageForStatus("idle"),
      technicalDetail: null,
    };
    this.loop = new PollingLoop({
      intervalMs: options.intervalMs,
      runTick: (signal) => this.tick(signal),
      onScheduledError: (error) => {
        this.snapshot = {
          ...this.snapshot,
          status: "failed",
          checkedAt: this.now().toISOString(),
          message: this.messageForStatus("failed"),
          technicalDetail: summarizeSafeError(error),
        };
      },
      setTimeout: options.setTimeout,
      clearTimeout: options.clearTimeout,
    });
  }

  start(): void {
    this.loop.start();
  }

  async stop(): Promise<void> {
    await this.loop.stop();
    this.snapshot = {
      ...this.snapshot,
      status: "stopped",
      checkedAt: this.now().toISOString(),
      message: this.messageForStatus("stopped"),
    };
  }

  async runOnce(): Promise<RetentionAutomationSnapshot> {
    await this.loop.runOnce();
    return this.getSnapshot();
  }

  getSnapshot(locale?: DirongLocale): RetentionAutomationSnapshot {
    const resolved = resolveAppLocale({
      locale,
      getLocale: this.options.localeResolver,
    });
    return {
      ...this.snapshot,
      message: t(resolved, RETENTION_AUTOMATION_MESSAGE_KEYS[this.snapshot.status]),
    };
  }

  private async tick(
    _signal: AbortSignal,
  ): Promise<RetentionAutomationSnapshot> {
    const checkedAt = this.now().toISOString();

    if (this.options.isRecording?.()) {
      this.snapshot = {
        status: "idle",
        checkedAt,
        lastSweepDeletedFiles: 0,
        lastSweepSessions: 0,
        message: this.messageForStatus("idle"),
        technicalDetail: null,
      };
      return this.snapshot;
    }

    const policy = this.options.getRetentionPolicy();
    const plans = buildExpiredTextArtifactDeletionPlans({
      database: this.options.database,
      storageRoot: this.options.storageRoot,
      policy,
      nowIso: checkedAt,
    });
    const results = plans.map((plan) => executeRetentionDeletionPlan(plan));
    const deleted = results.reduce((sum, result) => sum + result.deleted, 0);
    const failed = results.reduce((sum, result) => sum + result.failed, 0);

    if (failed > 0) {
      this.snapshot = {
        status: "failed",
        checkedAt,
        lastSweepDeletedFiles: deleted,
        lastSweepSessions: plans.length,
        message: this.messageForStatus("failed"),
        technicalDetail: formatRetentionSweepFailures(results),
      };
      return this.snapshot;
    }

    const status: RetentionAutomationStatus = deleted > 0 ? "done" : "idle";
    this.snapshot = {
      status,
      checkedAt,
      lastSweepDeletedFiles: deleted,
      lastSweepSessions: plans.length,
      message: this.messageForStatus(status),
      technicalDetail: null,
    };
    return this.snapshot;
  }

  private messageForStatus(status: RetentionAutomationStatus): string {
    return t(this.resolveLocale(), RETENTION_AUTOMATION_MESSAGE_KEYS[status]);
  }

  private resolveLocale(): DirongLocale {
    return resolveAppLocale({ getLocale: this.options.localeResolver });
  }

  private now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }
}

function formatRetentionSweepFailures(
  results: ReturnType<typeof executeRetentionDeletionPlan>[],
): string {
  return results
    .flatMap((result) =>
      result.results
        .filter((item) => item.status === "failed")
        .map((item) =>
          [
            `session=${item.target.sessionId}`,
            `kind=${item.target.kind}`,
            `path=${item.target.resolvedPath ?? item.target.path}`,
            `error=${item.error ?? "unknown"}`,
          ].join(" / "),
        ),
    )
    .join("\n");
}
