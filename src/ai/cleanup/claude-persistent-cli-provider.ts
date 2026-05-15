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
  /**
   * RELY-01 / D-04: invoked from the `stop()`-path orphan reaper when a SIGKILL
   * call against a tracked PID throws. The handler should write a structured
   * `claude_orphan_kill_failed` connection event so operators see a non-zero
   * counter in the dashboard. Not invoked from `reapTrackedPids()` (the sync
   * `process.on('exit')` path is quiet per D-04 — the DB writer may already be
   * torn down).
   */
  onOrphanKillFailed?: (event: { pid: number; errno: string | null }) => void;
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
  // RELY-01 / D-03: tracked PIDs for orphan-reap on stop() and process exit.
  // Add in generate() after `session.start()` (PID becomes non-null), remove
  // in killSession() after the child has exited.
  private readonly trackedPids = new Set<number>();
  private readonly onOrphanKillFailed?: (event: {
    pid: number;
    errno: string | null;
  }) => void;
  // RELY-03: safeguard-interval inputs. Tracked across the in-flight generate()
  // and consulted by `forceKillIfStale(now)` so the AiProviderLifecycleService
  // can SIGKILL a session whose wall-clock duration exceeded `timeoutMs * 2`.
  private generateStartedAt: number | null = null;
  private currentTimeoutMs: number | null = null;

  constructor(options: ClaudeStreamJsonCliCleanupProviderOptions = {}) {
    this.command = options.command?.trim() || "claude";
    this.modelName =
      options.model?.trim() || DEFAULT_CLAUDE_CLEANUP_MODEL;
    this.spawnProcess = options.spawnProcess;
    this.versionRunner = options.versionRunner ?? runCommandForExit;
    this.onOrphanKillFailed = options.onOrphanKillFailed;
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
    // RELY-03: record startedAt + timeoutMs on the provider so the service-owned
    // safeguard interval can detect a stale in-flight generate() via
    // `forceKillIfStale(now)`. Cleared in `finally` after killSession.
    this.generateStartedAt = startedAt;
    this.currentTimeoutMs = options.timeoutMs;
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

      // RELY-01: track PID for orphan-reap (on stop() + on parent exit).
      // `session.start()` is idempotent (see claude-persistent-smoke.ts:204-206:
      // early-return when this.child && this.isAlive()) — calling it here
      // makes `session.pid` non-null synchronously so the safeguard interval
      // and the stop()-path reaper have a deterministic PID to inspect.
      session.start();
      const pid = session.pid;
      if (pid !== null) {
        this.trackedPids.add(pid);
      }

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
      // RELY-03: clear safeguard inputs AFTER killSession so a concurrent
      // `forceKillIfStale` call mid-shutdown still has the data it needs.
      this.generateStartedAt = null;
      this.currentTimeoutMs = null;
    }
  }

  /**
   * RELY-03: safeguard-interval entry point. Returns `true` iff a kill was
   * performed. Idempotent — repeated calls on an already-killed session
   * return `false` because killSession() nulls `this.session`.
   *
   * The service owns the `setInterval` cadence and unref()s it; this method
   * is pure and trivially testable in isolation (no timers, no I/O).
   */
  forceKillIfStale(now: number = Date.now()): boolean {
    const startedAt = this.generateStartedAt;
    const timeoutMs = this.currentTimeoutMs;
    const session = this.session;
    if (startedAt === null || timeoutMs === null || session === null) {
      return false;
    }
    if (now - startedAt <= timeoutMs * 2) {
      return false;
    }
    session.kill("SIGKILL");
    return true;
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
    // RELY-01 / D-04 stop()-path reaper. killSession() already removed the
    // current session's PID; any PIDs STILL in trackedPids indicate a leak.
    // SIGKILL with loud structured logging via onOrphanKillFailed so the
    // operator sees a non-zero counter in the dashboard.
    for (const pid of [...this.trackedPids]) {
      try {
        process.kill(pid, "SIGKILL");
        this.trackedPids.delete(pid);
      } catch (error) {
        const errno = (error as NodeJS.ErrnoException)?.code ?? null;
        this.onOrphanKillFailed?.({ pid, errno });
        // give up; better to leak the Set entry than to re-throw / loop forever
        this.trackedPids.delete(pid);
      }
    }
  }

  /**
   * RELY-01: sync `process.on('exit')` reaper. Iterates `trackedPids`, calls
   * `process.kill(pid, 'SIGKILL')` and clears the set. Quiet on failure per
   * D-04 — `ESRCH` is expected when the child already exited, and the DB
   * writer may already be torn down so we MUST NOT throw or emit events here.
   */
  reapTrackedPids(): void {
    for (const pid of this.trackedPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // quiet — ESRCH expected; exit handler must not throw
      }
    }
    this.trackedPids.clear();
  }

  private async killSession(): Promise<void> {
    const session = this.session;
    // Capture the PID BEFORE clearing this.session — once cleared, the getter
    // returns null and we lose the tracking key.
    const pid = session?.pid ?? null;
    this.session = null;
    if (!session) {
      return;
    }
    await session.killAndWait();
    if (pid !== null) {
      this.trackedPids.delete(pid);
    }
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
