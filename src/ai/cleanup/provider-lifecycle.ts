import { AiCleanupProviderError } from "./provider.js";
import type { HumanStatusDisplay } from "../../messages/human-status.js";
import type {
  AiCleanupProvider,
  AiCleanupProviderResetReason,
  LegacyAiCleanupProviderResetReason,
  AiCleanupProviderInput,
  AiCleanupProviderOptions,
  AiCleanupProviderResult,
} from "./provider.js";

export type AiProviderReadinessKind =
  | "none"
  | "command"
  | "cli-auth"
  | "api-auth"
  | "http-server"
  | "warm-process";

export type AiProviderCapabilityProfile = {
  supportsWarmSession: boolean;
  supportsStreamingProgress: boolean;
  supportsJsonSchema: boolean;
  supportsStructuredOutput: boolean;
  requiresApiKey: boolean;
  requiresLocalServer: boolean;
  readinessKind: AiProviderReadinessKind;
};

export type AiProviderReadinessStatus =
  | "idle"
  | "preparing"
  | "ready"
  | "login_required"
  | "auth_required"
  | "server_unreachable"
  | "not_installed"
  | "degraded"
  | "failed"
  | "stopped";

/**
 * Runtime-only readiness snapshot for dashboard/status consumers.
 *
 * This is deliberately not a durable source of truth. Job state and accepted
 * drafts stay in SQLite; provider readiness is re-checked after process start
 * or settings changes.
 */
export type AiProviderRuntimeReadinessSnapshot = {
  status: AiProviderReadinessStatus;
  provider: string;
  model: string;
  checkedAt: string | null;
  message: string;
  userAction: string | null;
  technicalDetail: string | null;
  display?: HumanStatusDisplay;
};

export type AiProviderLifecycleCallOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type AiProviderResetReason =
  | AiCleanupProviderResetReason
  | LegacyAiCleanupProviderResetReason;

export interface AiMeetingNotesProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly capabilities: AiProviderCapabilityProfile;

  /**
   * Checks provider readiness without assuming subprocess warm-up.
   *
   * For CLI providers this may check command/login state. For future API
   * providers this is an auth or health check surface, not a warm process.
   * Only `readinessKind: "warm-process"` should imply a warm subprocess.
   */
  prepare(
    options?: AiProviderLifecycleCallOptions,
  ): Promise<AiProviderRuntimeReadinessSnapshot>;
  getReadiness(): AiProviderRuntimeReadinessSnapshot;
  generateMeetingNotes(
    input: AiCleanupProviderInput,
    options: AiCleanupProviderOptions,
    callOptions?: AiProviderLifecycleCallOptions,
  ): Promise<AiCleanupProviderResult>;
  resetAfterRequest(
    reason: AiProviderResetReason,
    options?: AiProviderLifecycleCallOptions,
  ): Promise<void>;
  stop(options?: AiProviderLifecycleCallOptions): Promise<void>;
}

export type AiCleanupProviderLifecycleAdapterOptions = {
  capabilities?: Partial<AiProviderCapabilityProfile>;
};

export class AiCleanupProviderLifecycleAdapter implements AiMeetingNotesProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly capabilities: AiProviderCapabilityProfile;

  private runtimeReadiness: AiProviderRuntimeReadinessSnapshot;

  constructor(
    private readonly provider: AiCleanupProvider,
    options?: AiCleanupProviderLifecycleAdapterOptions,
  ) {
    this.providerName = provider.providerName;
    this.modelName = provider.modelName;
    this.capabilities = {
      ...inferLegacyProviderCapabilities(provider),
      ...options?.capabilities,
    };
    this.runtimeReadiness = makeReadinessSnapshot({
      status: "idle",
      provider: this.providerName,
      model: this.modelName,
      checkedAt: null,
      message: "AI 준비 전",
      userAction: null,
      technicalDetail: null,
    });
  }

  async prepare(
    options?: AiProviderLifecycleCallOptions,
  ): Promise<AiProviderRuntimeReadinessSnapshot> {
    this.runtimeReadiness = makeReadinessSnapshot({
      status: "preparing",
      provider: this.providerName,
      model: this.modelName,
      checkedAt: new Date().toISOString(),
      message: "AI 준비 중",
      userAction: null,
      technicalDetail: null,
    });

    try {
      await runWithLifecycleControls(
        async () => {
          await this.provider.preflight?.();
        },
        options,
        "AI provider readiness check timed out.",
      );
      this.runtimeReadiness = makeReadinessSnapshot({
        status: "ready",
        provider: this.providerName,
        model: this.modelName,
        checkedAt: new Date().toISOString(),
        message: "AI 준비 완료",
        userAction: null,
        technicalDetail: null,
      });
    } catch (error) {
      this.runtimeReadiness = readinessFromPrepareFailure(
        this.providerName,
        this.modelName,
        this.capabilities,
        error,
      );
    }

    return this.getReadiness();
  }

  getReadiness(): AiProviderRuntimeReadinessSnapshot {
    return { ...this.runtimeReadiness };
  }

  async generateMeetingNotes(
    input: AiCleanupProviderInput,
    options: AiCleanupProviderOptions,
    callOptions?: AiProviderLifecycleCallOptions,
  ): Promise<AiCleanupProviderResult> {
    return await runWithLifecycleControls(
      () => this.provider.generate(input, options),
      callOptions,
      "AI provider meeting-notes generation timed out.",
    );
  }

  async resetAfterRequest(
    reason: AiProviderResetReason,
    options?: AiProviderLifecycleCallOptions,
  ): Promise<void> {
    await runWithLifecycleControls(
      async () => {
        const normalized = normalizeResetReason(reason);
        if (this.provider.resetSession) {
          await this.provider.resetSession(normalized);
          return;
        }
        await this.provider.resetAfterRequest?.(toLegacyResetReason(normalized));
      },
      options,
      "AI provider request reset timed out.",
    );
  }

  async stop(options?: AiProviderLifecycleCallOptions): Promise<void> {
    await runWithLifecycleControls(
      async () => {
        await this.provider.stop?.();
      },
      options,
      "AI provider stop timed out.",
    );
    this.runtimeReadiness = makeReadinessSnapshot({
      status: "stopped",
      provider: this.providerName,
      model: this.modelName,
      checkedAt: new Date().toISOString(),
      message: "AI 준비 상태 확인 중지됨",
      userAction: null,
      technicalDetail: null,
    });
  }

}

function normalizeResetReason(
  reason: AiProviderResetReason,
): AiCleanupProviderResetReason {
  if (reason === "success") {
    return "request_success";
  }
  if (reason === "failure") {
    return "request_failure";
  }
  if (reason === "timeout") {
    return "request_timeout";
  }
  return reason;
}

export function toLegacyResetReason(
  reason: AiCleanupProviderResetReason,
): LegacyAiCleanupProviderResetReason {
  if (reason === "request_timeout") {
    return "timeout";
  }
  if (reason === "request_success") {
    return "success";
  }
  return "failure";
}

export function wrapAiCleanupProviderWithLifecycle(
  provider: AiCleanupProvider,
  options?: AiCleanupProviderLifecycleAdapterOptions,
): AiMeetingNotesProvider {
  const adapter = new AiCleanupProviderLifecycleAdapter(provider, options);
  // RELY-03: forward `forceKillIfStale` to the underlying provider iff it
  // implements one. Attached as an own-property so the service's runtime
  // narrowing `'forceKillIfStale' in this.provider` succeeds for CLI
  // providers and fails for API providers that lack the safeguard.
  const underlying = provider as {
    forceKillIfStale?: (now?: number) => boolean;
  };
  if (typeof underlying.forceKillIfStale === "function") {
    const forceKillIfStale = underlying.forceKillIfStale.bind(provider);
    (adapter as unknown as {
      forceKillIfStale: (now?: number) => boolean;
    }).forceKillIfStale = (now?: number) => forceKillIfStale(now);
  }
  return adapter;
}

function inferLegacyProviderCapabilities(
  provider: AiCleanupProvider,
): AiProviderCapabilityProfile {
  const readinessKind = inferReadinessKind(provider.providerName);
  return {
    supportsWarmSession: provider.supportsWarmSession ?? false,
    supportsStreamingProgress: provider.supportsStreamingProgress ?? false,
    supportsJsonSchema: provider.supportsJsonSchema,
    supportsStructuredOutput: provider.supportsJsonSchema,
    requiresApiKey: false,
    requiresLocalServer: false,
    readinessKind,
  };
}

function inferReadinessKind(providerName: string): AiProviderReadinessKind {
  if (providerName === "fake") {
    return "none";
  }
  if (providerName.endsWith("-cli") || providerName.includes("cli")) {
    return "cli-auth";
  }
  return "command";
}

function readinessFromPrepareFailure(
  provider: string,
  model: string,
  capabilities: AiProviderCapabilityProfile,
  error: unknown,
): AiProviderRuntimeReadinessSnapshot {
  const technicalDetail = errorMessage(error);
  if (error instanceof AiCleanupProviderError) {
    if (error.failureKind === "provider_not_found") {
      return makeReadinessSnapshot({
        status:
          capabilities.readinessKind === "http-server"
            ? "server_unreachable"
            : "not_installed",
        provider,
        model,
        checkedAt: new Date().toISOString(),
        message:
          capabilities.readinessKind === "http-server"
            ? "로컬 AI 서버가 꺼져 있음"
            : "AI 도구를 찾지 못함",
        userAction:
          capabilities.readinessKind === "http-server"
            ? "로컬 AI 서버를 켠 뒤 다시 확인해 주세요."
            : "선택한 AI CLI가 설치되어 있고 터미널에서 실행되는지 확인해 주세요.",
        technicalDetail,
      });
    }

    if (error.failureKind === "provider_auth_required") {
      const isCliAuth = capabilities.readinessKind === "cli-auth";
      return makeReadinessSnapshot({
        status: isCliAuth ? "login_required" : "auth_required",
        provider,
        model,
        checkedAt: new Date().toISOString(),
        message: isCliAuth ? "AI 로그인 필요" : "AI API 키 필요",
        userAction: isCliAuth
          ? "터미널에서 AI CLI 로그인을 완료한 뒤 다시 확인해 주세요."
          : "설정의 AI API key를 확인해 주세요.",
        technicalDetail,
      });
    }
  }

  return makeReadinessSnapshot({
    status: "failed",
    provider,
    model,
    checkedAt: new Date().toISOString(),
    message: "AI 준비 확인 실패. 실패했지만 녹음/STT는 보존됩니다.",
    userAction: "AI 설정과 provider 상태를 확인한 뒤 다시 시도해 주세요.",
    technicalDetail,
  });
}

function makeReadinessSnapshot(
  snapshot: AiProviderRuntimeReadinessSnapshot,
): AiProviderRuntimeReadinessSnapshot {
  return { ...snapshot };
}

async function runWithLifecycleControls<T>(
  operation: () => Promise<T>,
  options: AiProviderLifecycleCallOptions | undefined,
  timeoutMessage: string,
): Promise<T> {
  if (options?.signal?.aborted) {
    throw new AiCleanupProviderError(
      "provider_timeout",
      "AI provider lifecycle call was cancelled before it started.",
    );
  }

  if (!options?.timeoutMs && !options?.signal) {
    return await operation();
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      options?.signal?.removeEventListener("abort", onAbort);
    };

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const onAbort = (): void => {
      finish(() =>
        reject(
          new AiCleanupProviderError(
            "provider_timeout",
            "AI provider lifecycle call was cancelled.",
          ),
        ),
      );
    };

    if (options?.timeoutMs) {
      timer = setTimeout(() => {
        finish(() =>
          reject(new AiCleanupProviderError("provider_timeout", timeoutMessage)),
        );
      }, options.timeoutMs);
    }

    options?.signal?.addEventListener("abort", onAbort, { once: true });

    operation()
      .then((value) => finish(() => resolve(value)))
      .catch((error: unknown) => finish(() => reject(error)));
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
