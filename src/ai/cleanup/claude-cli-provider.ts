import { spawn } from "node:child_process";
import { AiCleanupProviderError } from "./provider.js";
import type {
  AiCleanupProvider,
  AiCleanupProviderInput,
  AiCleanupProviderOptions,
  AiCleanupProviderResult,
} from "./provider.js";

export const DEFAULT_CLAUDE_CLEANUP_MODEL = "haiku";

export type CommandRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  outputExceeded: boolean;
  durationMs: number;
};

export type CommandRunner = (
  command: string,
  args: string[],
  input: string | null,
  options: {
    timeoutMs: number;
    maxOutputBytes: number;
  },
) => Promise<CommandRunResult>;

export class ClaudeCliCleanupProvider implements AiCleanupProvider {
  readonly providerName = "claude-cli";
  readonly modelName: string;
  readonly supportsJsonSchema = true;

  private readonly command: string;
  private readonly runner: CommandRunner;

  constructor(options?: {
    command?: string;
    model?: string | null;
    runner?: CommandRunner;
  }) {
    this.command = options?.command?.trim() || "claude";
    this.modelName = options?.model?.trim() || DEFAULT_CLAUDE_CLEANUP_MODEL;
    this.runner = options?.runner ?? runCommand;
  }

  async preflight(): Promise<void> {
    let result: CommandRunResult;
    try {
      result = await this.runner(this.command, ["--help"], null, {
        timeoutMs: 5000,
        maxOutputBytes: 20000,
      });
    } catch (error) {
      throw new AiCleanupProviderError(
        "provider_not_found",
        `Claude CLI를 찾지 못했습니다. 터미널에서 ${this.command} --help가 실행되는지 확인해 주세요. ${errorMessage(error)}`,
      );
    }

    if (result.exitCode !== 0) {
      throw new AiCleanupProviderError(
        "provider_not_found",
        `Claude CLI preflight에 실패했습니다. 터미널에서 ${this.command} --help를 확인해 주세요. ${result.stderr || result.stdout}`,
      );
    }
  }

  async generate(
    _input: AiCleanupProviderInput,
    options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    const args = this.buildArgs(options);
    const result = await this.runner(this.command, args, options.userPrompt, {
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
    });

    return {
      provider: this.providerName,
      model: this.modelName,
      commandDisplay: renderCommandDisplay(this.command, args),
      rawText: result.stdout,
      stderrText: result.stderr,
      exitCode: result.timedOut || result.outputExceeded ? null : result.exitCode,
      durationMs: result.durationMs,
    };
  }

  private buildArgs(options: AiCleanupProviderOptions): string[] {
    const args = [
      "--print",
      "--output-format",
      "json",
      "--no-session-persistence",
      "--tools",
      "",
      "--system-prompt",
      options.systemPrompt,
      "--json-schema",
      JSON.stringify(options.jsonSchema),
    ];

    if (this.modelName !== "default") {
      args.push("--model", this.modelName);
    }

    return args;
  }
}

async function runCommand(
  command: string,
  args: string[],
  input: string | null,
  options: {
    timeoutMs: number;
    maxOutputBytes: number;
  },
): Promise<CommandRunResult> {
  const startedAt = Date.now();

  return await new Promise<CommandRunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputExceeded = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        outputExceeded = true;
        child.kill();
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        outputExceeded = true;
        child.kill();
        return;
      }
      stderr.push(chunk);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: appendSyntheticStderr(
          Buffer.concat(stderr).toString("utf8"),
          timedOut,
          outputExceeded,
        ),
        exitCode,
        timedOut,
        outputExceeded,
        durationMs: Date.now() - startedAt,
      });
    });

    if (input) {
      child.stdin.end(input, "utf8");
    } else {
      child.stdin.end();
    }
  });
}

function appendSyntheticStderr(
  stderr: string,
  timedOut: boolean,
  outputExceeded: boolean,
): string {
  const lines = [stderr.trim()].filter((line) => line.length > 0);
  if (timedOut) {
    lines.push("Claude CLI timed out.");
  }
  if (outputExceeded) {
    lines.push("Claude CLI output exceeded the configured max output bytes.");
  }
  return lines.join("\n");
}

function renderCommandDisplay(command: string, args: string[]): string {
  return [command, ...args.map(redactDisplayArg)].join(" ");
}

function redactDisplayArg(arg: string): string {
  if (arg.length === 0) {
    return '""';
  }
  if (arg.startsWith("{") || arg.includes("\n") || arg.length > 80) {
    return "[redacted-long-arg]";
  }
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
