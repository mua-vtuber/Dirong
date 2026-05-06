import { spawn } from "node:child_process";
import {
  ClaudePersistentSmokeSession,
  renderCommandDisplay,
  resolveShellFalseCommand,
  type ClaudePersistentSmokeSpawn,
  type ClaudePersistentSmokeTurnResult,
} from "./claude-persistent-smoke.js";
import {
  AiCleanupProviderError,
  type AiCleanupProvider,
  type AiCleanupProviderInput,
  type AiCleanupProviderOptions,
  type AiCleanupProviderResetReason,
  type AiCleanupProviderResult,
} from "./provider.js";
import { DEFAULT_CLAUDE_CLEANUP_MODEL } from "./claude-models.js";

export type ClaudePersistentCliCleanupProviderOptions = {
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

export class ClaudePersistentCliCleanupProvider implements AiCleanupProvider {
  readonly providerName = "claude-cli";
  readonly modelName: string;
  readonly supportsJsonSchema = true;
  readonly supportsWarmSession = true;

  private readonly command: string;
  private readonly spawnProcess?: ClaudePersistentSmokeSpawn;
  private readonly versionRunner: CommandExitRunner;
  private session: ClaudePersistentSmokeSession | null = null;
  private sessionArgsKey: string | null = null;

  constructor(options: ClaudePersistentCliCleanupProviderOptions = {}) {
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
    const startedAt = Date.now();
    const extraArgs = buildPersistentCleanupExtraArgs(options);
    const argsKey = JSON.stringify(extraArgs);
    if (this.session && this.sessionArgsKey !== argsKey) {
      await this.killSession();
    }
    if (!this.session) {
      this.session = new ClaudePersistentSmokeSession({
        command: this.command,
        extraArgs,
        model: this.modelName,
        spawnProcess: this.spawnProcess,
        timeoutMs: options.timeoutMs,
      });
      this.sessionArgsKey = argsKey;
    }

    const turn = await this.session.request(options.userPrompt, {
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
    });

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
  }

  async resetAfterRequest(
    _reason: AiCleanupProviderResetReason,
  ): Promise<void> {
    await this.killSession();
  }

  async stop(): Promise<void> {
    await this.killSession();
  }

  private async killSession(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.sessionArgsKey = null;
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

async function runCommandForExit(
  command: string,
  args: string[],
  options: { timeoutMs: number },
): Promise<CommandExitResult> {
  const resolved = resolveShellFalseCommand(command, args);
  return await new Promise<CommandExitResult>((resolve, reject) => {
    const child = spawn(resolved.command, resolved.args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        timedOut,
      });
    });
  });
}

function buildStderrText(turn: ClaudePersistentSmokeTurnResult): string {
  const lines = [...turn.stderrLines];
  if (turn.timedOut) {
    lines.push("Claude persistent CLI timed out.");
  }
  if (turn.outputExceeded) {
    lines.push("Claude persistent CLI output exceeded the configured max output bytes.");
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
