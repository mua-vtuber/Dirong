import { redactSensitiveText, summarizeSafeError } from "../errors.js";
import {
  buildHumanStatusDisplay,
  formatHumanStatusDisplayForText,
  type HumanStatusDisplay,
  type HumanStatusDisplayInput,
} from "../messages/human-status.js";
import {
  resolveAppLocale,
  type AppLocaleResolver,
} from "../i18n/app-locale.js";
import { t, type LocaleKey } from "../i18n/catalog.js";
import { EnabledPollingLoop } from "../runtime/polling-loop.js";
import type { DirongLocale } from "../settings/local-settings-store.js";
import type { SttProvider } from "./provider.js";
import { runSttBatch, type SttRunResult } from "./runner.js";
import type { SttBatchStore } from "./storage-port.js";

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
  localeResolver?: AppLocaleResolver;
};

export class SttAutomationService {
  private readonly loop: EnabledPollingLoop<SttAutomationSnapshot>;
  private snapshot: SttAutomationSnapshot;

  constructor(
    private readonly store: SttBatchStore,
    private readonly options: SttAutomationServiceOptions,
  ) {
    this.snapshot = this.makeSnapshot({
      enabled: options.enabled,
      status: options.enabled ? "idle" : "disabled",
      provider: options.provider.providerName,
      model: options.provider.modelName,
      checkedAt: null,
      message: options.enabled
        ? this.messageForStatus("idle")
        : this.messageForStatus("disabled"),
      userAction: options.enabled ? null : this.userActionForStatus("disabled"),
      technicalDetail: null,
      lastRun: null,
    });
    this.loop = new EnabledPollingLoop({
      enabled: () => this.options.enabled,
      intervalMs: options.pollIntervalMs,
      runTick: () => this.tick(),
      onScheduledError: (error) => this.handleScheduledError(error),
    });
  }

  start(): void {
    this.loop.start();
  }

  async stop(): Promise<void> {
    await this.loop.stop();
    this.markStopped();
  }

  private handleScheduledError(error: unknown): void {
    this.snapshot = this.makeSnapshot({
      ...this.snapshot,
      status: "failed",
      checkedAt: new Date().toISOString(),
      message: this.messageForStatus("failed"),
      userAction: this.userActionForStatus("failed"),
      technicalDetail: summarizeSafeError(error),
    });
  }

  private markStopped(): void {
    this.snapshot = this.makeSnapshot({
      ...this.snapshot,
      status: "stopped",
      checkedAt: new Date().toISOString(),
      message: this.messageForStatus("stopped"),
      userAction: null,
    });
  }

  getSnapshot(locale?: DirongLocale): SttAutomationSnapshot {
    return cloneSnapshot(localizeSttAutomationSnapshot(
      this.snapshot,
      resolveAppLocale({ locale, getLocale: this.options.localeResolver }),
    ));
  }

  async runOnce(): Promise<SttAutomationSnapshot> {
    if (!this.options.enabled) {
      this.snapshot = this.makeSnapshot({
        ...this.snapshot,
        status: "disabled",
        checkedAt: new Date().toISOString(),
        message: this.messageForStatus("disabled"),
        userAction: this.userActionForStatus("disabled"),
      });
      return this.getSnapshot();
    }

    return await this.loop.runOnce();
  }

  private async tick(): Promise<SttAutomationSnapshot> {
    this.snapshot = this.makeSnapshot({
      ...this.snapshot,
      status: "running",
      checkedAt: new Date().toISOString(),
      message: this.messageForStatus("running"),
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
    this.snapshot = this.makeSnapshot({
      ...this.snapshot,
      status:
        result.examined === 0
          ? "idle"
          : failed > 0 && result.done === 0
            ? "failed"
            : "done",
      checkedAt: new Date().toISOString(),
      message: messageForResult(result, this.resolveLocale()),
      userAction:
        failed > 0
          ? this.userActionForStatus("failed")
          : null,
      technicalDetail:
        failed > 0
          ? summarizeFailedSamples(result)
          : null,
      lastRun: result,
    });

    return this.getSnapshot();
  }

  private makeSnapshot(snapshot: SttAutomationSnapshot): SttAutomationSnapshot {
    return makeSnapshot(snapshot, this.resolveLocale());
  }

  private messageForStatus(status: SttAutomationStatus): string {
    return t(this.resolveLocale(), sttAutomationMessageKey(status));
  }

  private userActionForStatus(status: SttAutomationStatus): string | null {
    const key = sttAutomationUserActionKey(status);
    return key ? t(this.resolveLocale(), key) : null;
  }

  private resolveLocale(): DirongLocale {
    return resolveAppLocale({ getLocale: this.options.localeResolver });
  }
}

export function formatSttAutomationForStatus(
  snapshot: SttAutomationSnapshot,
  locale?: DirongLocale,
): string {
  const resolvedLocale = resolveAppLocale({ locale });
  const localized = localizeSttAutomationSnapshot(snapshot, resolvedLocale);
  const display = localized.display ?? buildSttAutomationDisplay(resolvedLocale, localized);
  const lines = [
    formatHumanStatusDisplayForText(display, {
      title: t(resolvedLocale, "runtimeStatus.sttAutomation.statusText.title"),
      description: t(
        resolvedLocale,
        "runtimeStatus.sttAutomation.statusText.description",
      ),
      nextAction: t(
        resolvedLocale,
        "runtimeStatus.sttAutomation.statusText.nextAction",
      ),
    }),
    `STT provider: ${snapshot.provider} / ${snapshot.model}`,
  ];
  if (snapshot.lastRun) {
    lines.push(
      [
        `${t(resolvedLocale, "runtimeStatus.sttAutomation.statusText.batch")}:`,
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

function messageForResult(result: SttRunResult, locale: DirongLocale): string {
  if (result.examined === 0) {
    return t(locale, "runtimeStatus.sttAutomation.idle.message");
  }
  const failed = result.failed + result.missingAudio;
  if (failed > 0 && result.done === 0) {
    return t(locale, "runtimeStatus.sttAutomation.failed.message");
  }
  if (result.remainingQueuedHint > 0) {
    return t(locale, "runtimeStatus.sttAutomation.doneMore.message");
  }
  return t(locale, "runtimeStatus.sttAutomation.done.message");
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

function makeSnapshot(
  snapshot: SttAutomationSnapshot,
  locale: DirongLocale,
): SttAutomationSnapshot {
  const technicalDetail =
    snapshot.technicalDetail === null
      ? null
      : redactSensitiveText(snapshot.technicalDetail);
  return cloneSnapshot(
    localizeSttAutomationSnapshot({
      ...snapshot,
      technicalDetail,
    }, locale),
  );
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

function buildSttAutomationDisplay(
  locale: DirongLocale,
  snapshot: SttAutomationSnapshot,
): HumanStatusDisplay {
  return buildHumanStatusDisplay(locale, {
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

function localizeSttAutomationSnapshot(
  snapshot: SttAutomationSnapshot,
  locale: DirongLocale,
): SttAutomationSnapshot {
  const message = sttAutomationMessage(locale, snapshot);
  const userAction = sttAutomationUserAction(locale, snapshot);
  const localized = {
    ...snapshot,
    message,
    userAction,
  };
  return {
    ...localized,
    display: buildSttAutomationDisplay(locale, localized),
  };
}

function sttAutomationMessage(
  locale: DirongLocale,
  snapshot: SttAutomationSnapshot,
): string {
  if (snapshot.status === "done" && snapshot.lastRun?.remainingQueuedHint) {
    return t(locale, "runtimeStatus.sttAutomation.doneMore.message");
  }
  return t(locale, sttAutomationMessageKey(snapshot.status));
}

function sttAutomationUserAction(
  locale: DirongLocale,
  snapshot: SttAutomationSnapshot,
): string | null {
  const key = sttAutomationUserActionKey(snapshot.status);
  return key ? t(locale, key) : null;
}

function sttAutomationMessageKey(
  status: SttAutomationStatus,
): LocaleKey {
  if (status === "disabled") {
    return "runtimeStatus.sttAutomation.disabled.message";
  }
  if (status === "running") {
    return "runtimeStatus.sttAutomation.running.message";
  }
  if (status === "done") {
    return "runtimeStatus.sttAutomation.done.message";
  }
  if (status === "failed") {
    return "runtimeStatus.sttAutomation.failed.message";
  }
  if (status === "stopped") {
    return "runtimeStatus.sttAutomation.stopped.message";
  }
  return "runtimeStatus.sttAutomation.idle.message";
}

function sttAutomationUserActionKey(
  status: SttAutomationStatus,
): LocaleKey | null {
  if (status === "disabled") {
    return "runtimeStatus.sttAutomation.disabled.action";
  }
  if (status === "failed") {
    return "runtimeStatus.sttAutomation.failed.action";
  }
  return null;
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
