import { redactSensitiveText } from "../../errors.js";
import type {
  AiMeetingNotesProvider,
  AiProviderLifecycleCallOptions,
  AiProviderRuntimeReadinessSnapshot,
} from "./provider-lifecycle.js";

export type AiProviderLifecycleServiceOptions = {
  prepareTimeoutMs: number;
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
    this.snapshot = provider.getReadiness();
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
    this.snapshot = sanitizeSnapshot(this.provider.getReadiness());

    this.preparePromise = prepare
      .then((snapshot) => {
        if (this.stopped) {
          return this.getSnapshot();
        }
        this.snapshot = sanitizeSnapshot(snapshot);
        return this.snapshot;
      })
      .catch((error: unknown) => {
        if (this.stopped) {
          return this.getSnapshot();
        }
        this.snapshot = sanitizeSnapshot({
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

  getSnapshot(): AiProviderRuntimeReadinessSnapshot {
    return { ...this.snapshot };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.prepareAbortController.abort();
    await this.provider.stop({ timeoutMs: this.options.prepareTimeoutMs });
    this.snapshot = sanitizeSnapshot(this.provider.getReadiness());
  }
}

export function formatAiReadinessForStatus(
  snapshot: AiProviderRuntimeReadinessSnapshot,
): string {
  const lines = [
    `AI 상태: ${snapshot.message}`,
    `AI provider: ${snapshot.provider} / ${snapshot.model}`,
  ];
  if (snapshot.userAction) {
    lines.push(`AI 조치: ${snapshot.userAction}`);
  }
  return lines.join("\n");
}

function sanitizeSnapshot(
  snapshot: AiProviderRuntimeReadinessSnapshot,
): AiProviderRuntimeReadinessSnapshot {
  return {
    ...snapshot,
    technicalDetail:
      snapshot.technicalDetail === null
        ? null
        : redactSensitiveText(snapshot.technicalDetail),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
