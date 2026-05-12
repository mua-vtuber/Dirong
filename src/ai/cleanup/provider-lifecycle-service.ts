import { redactSensitiveText } from "../../errors.js";
import {
  buildHumanStatusDisplay,
  formatHumanStatusDisplayForText,
  type HumanStatusDisplayInput,
} from "../../messages/human-status.js";
import {
  resolveAppLocale,
  type AppLocaleResolver,
} from "../../i18n/app-locale.js";
import { t, type LocaleKey } from "../../i18n/catalog.js";
import type { DirongLocale } from "../../settings/local-settings-store.js";
import type {
  AiMeetingNotesProvider,
  AiProviderLifecycleCallOptions,
  AiProviderRuntimeReadinessSnapshot,
} from "./provider-lifecycle.js";

export type AiProviderLifecycleServiceOptions = {
  prepareTimeoutMs: number;
  localeResolver?: AppLocaleResolver;
};

/**
 * In-process AI provider readiness holder.
 *
 * This service owns no DB state. Dashboard and status endpoints read this
 * runtime snapshot; durable AI cleanup truth remains in ai_cleanup_jobs and
 * meeting_notes_drafts.
 *
 * Current timeout/cancel support is a lifecycle call surface. It can stop the
 * app from waiting on prepare, but a provider must still implement hard process
 * cancellation for true subprocess kill semantics.
 */
export class AiProviderLifecycleService {
  private readonly prepareAbortController = new AbortController();
  private preparePromise: Promise<AiProviderRuntimeReadinessSnapshot> | null = null;
  private snapshot: AiProviderRuntimeReadinessSnapshot;
  private stopped = false;

  constructor(
    private readonly provider: AiMeetingNotesProvider,
    private readonly options: AiProviderLifecycleServiceOptions,
  ) {
    this.snapshot = this.sanitizeSnapshot(provider.getReadiness());
  }

  startPrepareInBackground(): Promise<AiProviderRuntimeReadinessSnapshot> {
    if (this.stopped) {
      return Promise.resolve(this.getSnapshot());
    }

    if (this.preparePromise) {
      return this.preparePromise;
    }

    const callOptions: AiProviderLifecycleCallOptions = {
      signal: this.prepareAbortController.signal,
      timeoutMs: this.options.prepareTimeoutMs,
    };

    const prepare = this.provider.prepare(callOptions);
    this.snapshot = this.sanitizeSnapshot(this.provider.getReadiness());

    this.preparePromise = prepare
      .then((snapshot) => {
        if (this.stopped) {
          return this.getSnapshot();
        }
        this.snapshot = this.sanitizeSnapshot(snapshot);
        return this.snapshot;
      })
      .catch((error: unknown) => {
        if (this.stopped) {
          return this.getSnapshot();
        }
        this.snapshot = this.sanitizeSnapshot({
          status: "failed",
          provider: this.provider.providerName,
          model: this.provider.modelName,
          checkedAt: new Date().toISOString(),
          message: "AI 준비 확인 실패. 실패했지만 녹음/STT는 보존됩니다.",
          userAction: "AI 설정과 provider 상태를 확인한 뒤 다시 시도해 주세요.",
          technicalDetail: errorMessage(error),
        });
        return this.snapshot;
      })
      .finally(() => {
        this.preparePromise = null;
      });

    return this.preparePromise;
  }

  getSnapshot(locale?: DirongLocale): AiProviderRuntimeReadinessSnapshot {
    return {
      ...localizeAiReadinessSnapshot(
        this.snapshot,
        resolveAppLocale({ locale, getLocale: this.options.localeResolver }),
      ),
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.prepareAbortController.abort();
    await this.provider.stop({ timeoutMs: this.options.prepareTimeoutMs });
    this.snapshot = this.sanitizeSnapshot(this.provider.getReadiness());
  }

  private sanitizeSnapshot(
    snapshot: AiProviderRuntimeReadinessSnapshot,
  ): AiProviderRuntimeReadinessSnapshot {
    return sanitizeSnapshot(snapshot, this.resolveLocale());
  }

  private resolveLocale(): DirongLocale {
    return resolveAppLocale({ getLocale: this.options.localeResolver });
  }
}

export function formatAiReadinessForStatus(
  snapshot: AiProviderRuntimeReadinessSnapshot,
  locale?: DirongLocale,
): string {
  const resolvedLocale = resolveAppLocale({ locale });
  const localized = localizeAiReadinessSnapshot(snapshot, resolvedLocale);
  const display = localized.display ?? buildAiReadinessDisplay(resolvedLocale, localized);
  const lines = [
    formatHumanStatusDisplayForText(display, {
      title: "AI 상태",
      description: "설명",
      nextAction: "AI 조치",
    }),
    `AI provider: ${snapshot.provider} / ${snapshot.model}`,
  ];
  return lines.join("\n");
}

function sanitizeSnapshot(
  snapshot: AiProviderRuntimeReadinessSnapshot,
  locale: DirongLocale,
): AiProviderRuntimeReadinessSnapshot {
  const technicalDetail =
    snapshot.technicalDetail === null
      ? null
      : redactSensitiveText(snapshot.technicalDetail);
  return localizeAiReadinessSnapshot({
    ...snapshot,
    technicalDetail,
  }, locale);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildAiReadinessDisplay(
  locale: DirongLocale,
  snapshot: AiProviderRuntimeReadinessSnapshot,
) {
  return buildHumanStatusDisplay(locale, {
    ...aiReadinessDisplayKeys(snapshot.status),
    status: snapshot.status,
    message: snapshot.message,
    userAction: snapshot.userAction,
    technicalDetail: snapshot.technicalDetail,
    details: [
      { label: "provider", value: snapshot.provider },
      { label: "model", value: snapshot.model },
      { label: "checkedAt", value: snapshot.checkedAt },
    ],
  });
}

function localizeAiReadinessSnapshot(
  snapshot: AiProviderRuntimeReadinessSnapshot,
  locale: DirongLocale,
): AiProviderRuntimeReadinessSnapshot {
  const message = t(locale, aiReadinessMessageKey(snapshot.status));
  const userActionKey = aiReadinessUserActionKey(snapshot.status);
  const localized = {
    ...snapshot,
    message,
    userAction: userActionKey ? t(locale, userActionKey) : null,
  };
  return {
    ...localized,
    display: buildAiReadinessDisplay(locale, localized),
  };
}

function aiReadinessMessageKey(
  status: AiProviderRuntimeReadinessSnapshot["status"],
): LocaleKey {
  switch (status) {
    case "idle":
      return "runtimeStatus.aiReadiness.idle.message";
    case "preparing":
      return "runtimeStatus.aiReadiness.preparing.message";
    case "ready":
      return "runtimeStatus.aiReadiness.ready.message";
    case "login_required":
      return "runtimeStatus.aiReadiness.loginRequired.message";
    case "auth_required":
      return "runtimeStatus.aiReadiness.authRequired.message";
    case "server_unreachable":
      return "runtimeStatus.aiReadiness.serverUnreachable.message";
    case "not_installed":
      return "runtimeStatus.aiReadiness.notInstalled.message";
    case "degraded":
      return "runtimeStatus.aiReadiness.degraded.message";
    case "stopped":
      return "runtimeStatus.aiReadiness.stopped.message";
    case "failed":
    default:
      return "runtimeStatus.aiReadiness.failed.message";
  }
}

function aiReadinessUserActionKey(
  status: AiProviderRuntimeReadinessSnapshot["status"],
): LocaleKey | null {
  switch (status) {
    case "login_required":
      return "runtimeStatus.aiReadiness.loginRequired.action";
    case "auth_required":
      return "runtimeStatus.aiReadiness.authRequired.action";
    case "server_unreachable":
      return "runtimeStatus.aiReadiness.serverUnreachable.action";
    case "not_installed":
      return "runtimeStatus.aiReadiness.notInstalled.action";
    case "degraded":
      return "runtimeStatus.aiReadiness.degraded.action";
    case "failed":
      return "runtimeStatus.aiReadiness.failed.action";
    default:
      return null;
  }
}

function aiReadinessDisplayKeys(
  status: AiProviderRuntimeReadinessSnapshot["status"],
): Pick<
  HumanStatusDisplayInput,
  "titleKey" | "descriptionKey" | "nextActionKey"
> {
  if (status === "preparing") {
    return {
      titleKey: "statusDisplay.claude.preparing.title",
      descriptionKey: "statusDisplay.claude.preparing.description",
    };
  }
  if (status === "ready" || status === "idle" || status === "degraded") {
    return {
      titleKey: "statusDisplay.claude.ready.title",
      descriptionKey: "statusDisplay.claude.ready.description",
    };
  }
  if (status === "login_required" || status === "auth_required") {
    return {
      titleKey: "statusDisplay.claude.loginRequired.title",
      descriptionKey: "statusDisplay.claude.loginRequired.description",
      nextActionKey: "statusDisplay.claude.loginRequired.nextAction",
    };
  }
  if (status === "not_installed" || status === "server_unreachable") {
    return {
      titleKey: "statusDisplay.claude.toolMissing.title",
      descriptionKey: "statusDisplay.claude.toolMissing.description",
      nextActionKey: "statusDisplay.claude.toolMissing.nextAction",
    };
  }
  if (status === "stopped") {
    return {
      titleKey: "statusDisplay.claude.stopped.title",
      descriptionKey: "statusDisplay.claude.stopped.description",
    };
  }
  return {
    titleKey: "statusDisplay.claude.failed.title",
    descriptionKey: "statusDisplay.claude.failed.description",
    nextActionKey: "statusDisplay.claude.failed.nextAction",
  };
}
