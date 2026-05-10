import { redactSensitiveText } from "../errors.js";
import {
  buildHumanStatusDisplay,
  formatHumanStatusDisplayForText,
  type HumanStatusDisplay,
  type HumanStatusDisplayInput,
} from "../messages/human-status.js";
import { PollingLoop } from "../runtime/polling-loop.js";
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
  display?: HumanStatusDisplay;
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
  private readonly loop: PollingLoop<SttAutomationSnapshot>;
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
    this.loop = new PollingLoop({
      intervalMs: options.pollIntervalMs,
      runTick: () => this.tick(),
      onScheduledError: (error) => {
        this.snapshot = makeSnapshot({
          ...this.snapshot,
          status: "failed",
          checkedAt: new Date().toISOString(),
          message: "STT 자동 실행 중 오류가 발생했습니다.",
          userAction: "녹음 파일은 보존됩니다. STT 설정과 로그를 확인해 주세요.",
          technicalDetail: summarizeError(error),
        });
      },
    });
  }

  start(): void {
    if (!this.options.enabled) {
      return;
    }
    this.loop.start();
  }

  async stop(): Promise<void> {
    await this.loop.stop();
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

    return await this.loop.runOnce();
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
  const display = snapshot.display ?? buildSttAutomationDisplay(snapshot);
  const lines = [
    formatHumanStatusDisplayForText(display, {
      title: "STT 자동화",
      description: "설명",
      nextAction: "STT 조치",
    }),
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
  const technicalDetail =
    snapshot.technicalDetail === null
      ? null
      : redactSensitiveText(snapshot.technicalDetail);
  return cloneSnapshot({
    ...snapshot,
    technicalDetail,
    display: buildSttAutomationDisplay({
      ...snapshot,
      technicalDetail,
    }),
  });
}

function cloneSnapshot(snapshot: SttAutomationSnapshot): SttAutomationSnapshot {
  return {
    ...snapshot,
    display: snapshot.display
      ? {
          ...snapshot.display,
          details: snapshot.display.details.map((detail) => ({ ...detail })),
        }
      : undefined,
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

function buildSttAutomationDisplay(
  snapshot: SttAutomationSnapshot,
): HumanStatusDisplay {
  return buildHumanStatusDisplay(undefined, {
    ...sttAutomationDisplayKeys(snapshot.status),
    status: snapshot.status,
    message: snapshot.message,
    userAction: snapshot.userAction,
    technicalDetail: snapshot.technicalDetail,
    details: [
      { label: "provider", value: snapshot.provider },
      { label: "model", value: snapshot.model },
      { label: "lastRun", value: snapshot.lastRun },
    ],
  });
}

function sttAutomationDisplayKeys(
  status: SttAutomationStatus,
): Pick<
  HumanStatusDisplayInput,
  "titleKey" | "descriptionKey" | "nextActionKey"
> {
  if (status === "disabled") {
    return {
      titleKey: "statusDisplay.stt.notConfigured.title",
      descriptionKey: "statusDisplay.stt.notConfigured.description",
      nextActionKey: "statusDisplay.stt.notConfigured.nextAction",
    };
  }
  if (status === "running") {
    return {
      titleKey: "statusDisplay.stt.ready.title",
      descriptionKey: "statusDisplay.stt.ready.description",
    };
  }
  if (status === "failed") {
    return {
      titleKey: "statusDisplay.action.failed.title",
      descriptionKey: "statusDisplay.action.failed.description",
      nextActionKey: "statusDisplay.action.failed.nextAction",
    };
  }
  if (status === "stopped") {
    return {
      titleKey: "statusDisplay.action.ready.title",
      descriptionKey: "statusDisplay.action.ready.description",
    };
  }
  return {
    titleKey: "statusDisplay.stt.ready.title",
    descriptionKey: "statusDisplay.stt.ready.description",
  };
}
