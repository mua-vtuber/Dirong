import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AiCleanupProviderError,
  type AiCleanupProvider,
  type AiCleanupProviderInput,
  type AiCleanupProviderOptions,
  type AiCleanupProviderResult,
} from "./provider.js";
import { DEFAULT_AI_CLEANUP_SETTINGS } from "../../settings/defaults.js";
import { formatLocaleText } from "../../i18n/catalog.js";
import { runChild, type RunChildResult } from "../../process/run-child.js";

export type TerminalCliCleanupProviderName = "codex-cli" | "gemini-cli";
export type TerminalCliCleanupProviderKind = "codex" | "gemini";

export type TerminalCliCleanupProviderOptions = {
  kind: TerminalCliCleanupProviderKind;
  command?: string;
  model?: string | null;
  runner?: TerminalCliRunner;
  tempRoot?: string;
};

export type TerminalCliRunner = (
  command: string,
  args: string[],
  options: {
    stdin: string;
    timeoutMs: number;
    maxStdoutBytes: number;
    maxStderrBytes: number;
    cwd?: string;
    signal?: AbortSignal;
  },
) => Promise<RunChildResult>;

const TERMINAL_PROVIDER_DEFAULTS = {
  codex: {
    providerName: "codex-cli",
    command: "codex",
    modelName: "default",
  },
  gemini: {
    providerName: "gemini-cli",
    command: "gemini",
    modelName: "default",
  },
} as const satisfies Record<
  TerminalCliCleanupProviderKind,
  {
    providerName: TerminalCliCleanupProviderName;
    command: string;
    modelName: string;
  }
>;

export class TerminalCliCleanupProvider implements AiCleanupProvider {
  readonly providerName: TerminalCliCleanupProviderName;
  readonly modelName: string;
  readonly supportsJsonSchema: boolean;
  readonly supportsWarmSession = false;
  readonly supportsStreamingProgress = false;

  private readonly kind: TerminalCliCleanupProviderKind;
  private readonly command: string;
  private readonly runner: TerminalCliRunner;
  private readonly tempRoot: string;

  constructor(options: TerminalCliCleanupProviderOptions) {
    const defaults = TERMINAL_PROVIDER_DEFAULTS[options.kind];
    this.kind = options.kind;
    this.providerName = defaults.providerName;
    this.command = options.command?.trim() || defaults.command;
    this.modelName = normalizeModelName(options.model, defaults.modelName);
    this.supportsJsonSchema = options.kind === "codex";
    this.runner = options.runner ?? runTerminalCommand;
    this.tempRoot = options.tempRoot ?? os.tmpdir();
  }

  async preflight(): Promise<void> {
    let result: RunChildResult;
    try {
      result = await this.runner(this.command, ["--version"], {
        stdin: "",
        timeoutMs: DEFAULT_AI_CLEANUP_SETTINGS.prepareTimeoutMs,
        maxStdoutBytes: 2000,
        maxStderrBytes: 2000,
      });
    } catch (error) {
      throw new AiCleanupProviderError(
        "provider_not_found",
        formatLocaleText("ko", "runtimeCli.aiProvider.terminalCliMissing", {
          provider: this.providerName,
          command: this.command,
          error: errorMessage(error),
        }),
      );
    }

    if (result.timedOut) {
      throw new AiCleanupProviderError(
        "provider_timeout",
        `${this.providerName} preflight timed out: ${this.command} --version`,
      );
    }
    if (result.exitCode !== 0) {
      throw new AiCleanupProviderError(
        "provider_not_found",
        formatLocaleText("ko", "runtimeCli.aiProvider.terminalPreflightFailed", {
          provider: this.providerName,
          command: this.command,
          detail: result.stderr || result.stdout,
        }),
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
        `${this.providerName} request was cancelled before it started.`,
      );
    }

    const startedAt = Date.now();
    const prompt = buildTerminalPrompt(options);
    const invocation = this.kind === "codex"
      ? this.buildCodexInvocation(options)
      : this.buildGeminiInvocation();

    let result: RunChildResult;
    let rawText = "";
    try {
      result = await this.runner(this.command, invocation.args, {
        stdin: prompt,
        timeoutMs: options.timeoutMs,
        maxStdoutBytes: options.maxOutputBytes,
        maxStderrBytes: options.maxOutputBytes,
        cwd: invocation.cwd,
        signal: options.signal,
      });
      rawText =
        invocation.readLastMessage?.() ??
        (this.kind === "gemini"
          ? extractGeminiResponseText(result.stdout)
          : result.stdout);
    } finally {
      invocation.cleanup();
    }

    return {
      provider: this.providerName,
      model: this.modelName,
      commandDisplay: renderCommandDisplay(this.command, invocation.args),
      rawText,
      stderrText: buildTerminalStderrText(this.providerName, result),
      exitCode: result.timedOut ? null : result.exitCode,
      durationMs: Date.now() - startedAt,
    };
  }

  private buildCodexInvocation(options: AiCleanupProviderOptions): {
    args: string[];
    cwd: string;
    cleanup: () => void;
    readLastMessage: () => string | null;
  } {
    const tempDir = mkdtempSync(path.join(this.tempRoot, "dirong-codex-"));
    const schemaPath = path.join(tempDir, "output-schema.json");
    const outputPath = path.join(tempDir, "last-message.txt");
    writeFileSync(schemaPath, JSON.stringify(options.jsonSchema), "utf8");

    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--cd",
      tempDir,
      "--sandbox",
      "read-only",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
    ];
    if (this.modelName !== "default") {
      args.push("--model", this.modelName);
    }
    args.push("-");

    return {
      args,
      cwd: tempDir,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
      readLastMessage: () => readOptionalText(outputPath),
    };
  }

  private buildGeminiInvocation(): {
    args: string[];
    cwd: string;
    cleanup: () => void;
    readLastMessage?: () => string | null;
  } {
    const tempDir = mkdtempSync(path.join(this.tempRoot, "dirong-gemini-"));
    const args = [
      "--prompt",
      "Create the meeting-notes draft from the instructions and transcript provided on stdin.",
      "--output-format",
      "json",
      "--approval-mode",
      "plan",
    ];
    if (this.modelName !== "default") {
      args.push("--model", this.modelName);
    }
    return {
      args,
      cwd: tempDir,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    };
  }
}

export function extractGeminiResponseText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return stdout;
  }
  const parsed = parseJson(trimmed);
  if (parsed === null) {
    return stdout;
  }
  if (looksLikeMeetingDraft(parsed)) {
    return JSON.stringify(parsed);
  }
  const extracted = findTextPayload(parsed);
  return extracted ?? stdout;
}

function buildTerminalPrompt(options: AiCleanupProviderOptions): string {
  return [
    options.systemPrompt,
    "",
    "The response must be only the final meeting-notes JSON object.",
    "Do not run shell commands, read files, edit files, or call tools.",
    "",
    options.userPrompt,
  ].join("\n");
}

function buildTerminalStderrText(
  providerName: TerminalCliCleanupProviderName,
  result: RunChildResult,
): string {
  const lines = result.stderr ? [result.stderr] : [];
  if (result.timedOut) {
    lines.push(`${providerName} CLI timed out.`);
  }
  return lines.join("\n");
}

function normalizeModelName(
  model: string | null | undefined,
  fallback: string,
): string {
  const trimmed = model?.trim();
  return !trimmed || trimmed === "default" ? fallback : trimmed;
}

function renderCommandDisplay(command: string, args: readonly string[]): string {
  return [command, ...args.map(redactDisplayArg)].join(" ");
}

function redactDisplayArg(arg: string): string {
  if (arg.length > 120 || arg.includes("\n")) {
    return "[redacted-long-arg]";
  }
  return arg;
}

function readOptionalText(filePath: string): string | null {
  try {
    const text = readFileSync(filePath, "utf8");
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function looksLikeMeetingDraft(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).schemaVersion ===
      "dirong.meeting_notes_draft.v1"
  );
}

function findTextPayload(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findTextPayload(entry);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["response", "text", "content", "message", "result", "output"]) {
    const found = findTextPayload(record[key]);
    if (found) {
      return found;
    }
  }
  return null;
}

async function runTerminalCommand(
  command: string,
  args: string[],
  options: {
    stdin: string;
    timeoutMs: number;
    maxStdoutBytes: number;
    maxStderrBytes: number;
    cwd?: string;
    signal?: AbortSignal;
  },
): Promise<RunChildResult> {
  return await runChild(command, args, {
    stdin: options.stdin,
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
    maxStdoutBytes: options.maxStdoutBytes,
    maxStderrBytes: options.maxStderrBytes,
    signal: options.signal,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
