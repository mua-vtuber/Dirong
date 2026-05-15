import {
  ClaudePersistentSmokeSession,
  renderCommandDisplay,
  type ClaudePersistentSmokeRequestProgress,
  type ClaudePersistentSmokeSpawn,
  type ClaudePersistentSmokeTurnResult,
} from "./claude-persistent-smoke.js";
import {
  AiCleanupProviderError,
  type AiCleanupProvider,
  type AiCleanupProviderInput,
  type AiCleanupProviderOptions,
  type AiCleanupProviderResetReason,
  type LegacyAiCleanupProviderResetReason,
  type AiCleanupProviderResult,
} from "./provider.js";
import { DEFAULT_CLAUDE_CLEANUP_MODEL } from "./claude-models.js";
import {
  safeEmitAiCleanupProgress,
  type AiCleanupProgressPhase,
} from "./progress.js";
import { runChild } from "../../process/run-child.js";

export type ClaudeStreamJsonCliCleanupProviderOptions = {
  command?: string;
  model?: string | null;
  spawnProcess?: ClaudePersistentSmokeSpawn;
  versionRunner?: CommandExitRunner;
};

export type CommandExitResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export type CommandExitRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number },
) => Promise<CommandExitResult>;

export class ClaudeStreamJsonCliCleanupProvider implements AiCleanupProvider {
  readonly providerName = "claude-cli";
  readonly modelName: string;
  readonly supportsJsonSchema = true;
  readonly supportsWarmSession = false;
  readonly supportsStreamingProgress = true;

  private readonly command: string;
  private readonly spawnProcess?: ClaudePersistentSmokeSpawn;
  private readonly versionRunner: CommandExitRunner;
  private session: ClaudePersistentSmokeSession | null = null;

  constructor(options: ClaudeStreamJsonCliCleanupProviderOptions = {}) {
    this.command = options.command?.trim() || "claude";
    this.modelName =
      options.model?.trim() || DEFAULT_CLAUDE_CLEANUP_MODEL;
    this.spawnProcess = options.spawnProcess;
    this.versionRunner = options.versionRunner ?? runCommandForExit;
  }

  async preflight(): Promise<void> {
    let result: CommandExitResult;
    try {
      result = await this.versionRunner(this.command, ["--version"], {
        timeoutMs: 5000,
      });
    } catch (error) {
      throw new AiCleanupProviderError(
        "provider_not_found",
        `Claude CLI를 찾지 못했습니다. 터미널에서 ${this.command} --version이 실행되는지 확인해 주세요. ${errorMessage(error)}`,
      );
    }

    if (result.timedOut) {
      throw new AiCleanupProviderError(
        "provider_timeout",
        `Claude CLI preflight timed out: ${this.command} --version`,
      );
    }
    if (result.exitCode !== 0) {
      throw new AiCleanupProviderError(
        "provider_not_found",
        `Claude CLI preflight에 실패했습니다. 터미널에서 ${this.command} --version을 확인해 주세요. ${result.stderr || result.stdout}`,
      );
    }
  }

  async generate(
    _input: AiCleanupProviderInput,
    options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    if (options.signal?.aborted) {
      throw new AiCleanupProviderError(
        "provider_timeout",
        "Claude stream-json request was cancelled before it started.",
      );
    }

    const startedAt = Date.now();
    const extraArgs = buildPersistentCleanupExtraArgs(options);

    // RELY-02: register the abort listener BEFORE any await on the session-kill
    // path, so a synchronous abort during that await window kills whatever
    // session ends up assigned to `this.session`. The listener body uses an
    // optional chain so it tolerates being fired against a null session
    // (pre-construction abort window).
    let abortListener: (() => void) | null = null;
    abortListener = () => {
      this.session?.kill();
    };
    options.signal?.addEventListener("abort", abortListener, { once: true });
    if (options.signal?.aborted) {
      // Edge case: abort fired between the entry check and addEventListener.
      // Remove the listener we just installed and throw the same error path.
      options.signal?.removeEventListener("abort", abortListener);
      abortListener = null;
      throw new AiCleanupProviderError(
        "provider_timeout",
        "Claude stream-json request was cancelled before it started.",
      );
    }

    try {
      await this.killSession();
      const session = new ClaudePersistentSmokeSession({
        command: this.command,
        extraArgs,
        model: this.modelName,
        spawnProcess: this.spawnProcess,
        timeoutMs: options.timeoutMs,
      });
      this.session = session;

      if (options.signal?.aborted) {
        throw new AiCleanupProviderError(
          "provider_timeout",
          "Claude stream-json request was cancelled before it started.",
        );
      }

      const turn = await session.request(options.userPrompt, {
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        progress: (progress) => emitClaudeProgress(options, progress),
      });

      if (options.signal?.aborted) {
        throw new AiCleanupProviderError(
          "provider_timeout",
          "Claude stream-json request was cancelled.",
        );
      }

      return {
        provider: this.providerName,
        model: this.modelName,
        commandDisplay: this.renderCommandDisplay(extraArgs),
        rawText: turn.stdoutLines.join("\n"),
        stderrText: buildStderrText(turn),
        exitCode:
          turn.timedOut || turn.outputExceeded
            ? null
            : turn.error
              ? 1
              : turn.exitCode ?? 0,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      if (abortListener) {
        options.signal?.removeEventListener("abort", abortListener);
      }
      await this.killSession();
    }
  }

  async resetSession(
    _reason: AiCleanupProviderResetReason,
  ): Promise<void> {
    await this.killSession();
  }

  async resetAfterRequest(
    _reason: LegacyAiCleanupProviderResetReason,
  ): Promise<void> {
    await this.killSession();
  }

  async stop(): Promise<void> {
    await this.killSession();
  }

  private async killSession(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (!session) {
      return;
    }
    await session.killAndWait();
  }

  private renderCommandDisplay(extraArgs: string[]): string {
    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      ...extraArgs,
    ];
    if (this.modelName !== "default") {
      args.push("--model", this.modelName);
    }
    return renderCommandDisplay(this.command, args.map(redactDisplayArg));
  }
}

export {
  ClaudeStreamJsonCliCleanupProvider as ClaudePersistentCliCleanupProvider,
};

export function buildPersistentCleanupExtraArgs(
  options: AiCleanupProviderOptions,
): string[] {
  return [
    "--tools",
    "",
    "--system-prompt",
    options.systemPrompt,
    "--json-schema",
    JSON.stringify(options.jsonSchema),
  ];
}

function emitClaudeProgress(
  options: AiCleanupProviderOptions,
  progress: ClaudePersistentSmokeRequestProgress,
): void {
  if (!options.progress || !options.progressContext) {
    return;
  }
  const diagnostics = progress.diagnostics;
  safeEmitAiCleanupProgress(options.progress, options.progressContext, {
    phase: phaseForClaudeProgress(progress.kind),
    message: messageForClaudeProgress(progress.kind),
    processPid: progress.pid,
    streamLineCount: diagnostics.stdoutLineCount,
    stdoutBytes: diagnostics.stdoutBytes,
    stderrLineCount: diagnostics.stderrLineCount,
    lastEventType: diagnostics.lastEventType,
    resultReceived: diagnostics.resultReceived,
    warning: progress.warning,
  });
}

function phaseForClaudeProgress(
  kind: ClaudePersistentSmokeRequestProgress["kind"],
): AiCleanupProgressPhase {
  if (kind === "started") {
    return "starting_claude";
  }
  if (kind === "waiting_for_first_stream_event") {
    return "waiting_for_first_stream_event";
  }
  if (kind === "result_boundary_received") {
    return "result_boundary_received";
  }
  if (kind === "failed") {
    return "failed";
  }
  return "receiving_stream";
}

function messageForClaudeProgress(
  kind: ClaudePersistentSmokeRequestProgress["kind"],
): string {
  if (kind === "started") {
    return "Claude stream-json process 시작";
  }
  if (kind === "waiting_for_first_stream_event") {
    return "Claude 첫 stream 이벤트 대기 중";
  }
  if (kind === "result_boundary_received") {
    return "Claude result boundary 수신";
  }
  if (kind === "failed") {
    return "Claude stream-json protocol 실패";
  }
  return "Claude stream-json 응답 수신 중";
}

async function runCommandForExit(
  command: string,
  args: string[],
  options: { timeoutMs: number },
): Promise<CommandExitResult> {
  return await runChild(command, args, {
    timeoutMs: options.timeoutMs,
  });
}

function buildStderrText(turn: ClaudePersistentSmokeTurnResult): string {
  const lines = [...turn.stderrLines];
  if (turn.timedOut) {
    lines.push("Claude stream-json CLI timed out.");
  }
  if (turn.outputExceeded) {
    lines.push("Claude stream-json CLI output exceeded the configured max output bytes.");
  }
  if (turn.error) {
    lines.push(turn.error);
  }
  return lines.join("\n");
}

function redactDisplayArg(arg: string): string {
  if (arg.length === 0) {
    return arg;
  }
  if (arg.startsWith("{") || arg.includes("\n") || arg.length > 80) {
    return "[redacted-long-arg]";
  }
  return arg;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
