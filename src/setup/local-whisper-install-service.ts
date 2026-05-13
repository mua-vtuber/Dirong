import path from "node:path";
import { redactSensitiveText } from "../errors.js";
import { runChild, type RunChildOptions } from "../process/run-child.js";
import type { DirongUserDataPaths } from "../settings/dirong-user-data.js";
import { DEFAULT_STT_SETTINGS } from "../settings/defaults.js";
import {
  DEFAULT_LOCAL_WHISPER_TOOL_PROFILE,
  resolveLocalWhisperToolProfile,
} from "../settings/tool-profiles.js";

export const LOCAL_WHISPER_INSTALL_MODELS = ["small", "medium"] as const;
export type LocalWhisperInstallModel =
  (typeof LOCAL_WHISPER_INSTALL_MODELS)[number];

export type LocalWhisperInstallStatus = "idle" | "running" | "done" | "failed";

export type LocalWhisperInstallStage =
  | "idle"
  | "checking_python"
  | "installing_package"
  | "checking_package"
  | "downloading_model"
  | "checking_model"
  | "done"
  | "failed";

export type LocalWhisperInstallSnapshot = {
  status: LocalWhisperInstallStatus;
  stage: LocalWhisperInstallStage;
  model: LocalWhisperInstallModel | null;
  message: string;
  detail: string | null;
  lastLog: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
};

export type LocalWhisperInstallStartInput = {
  model: LocalWhisperInstallModel;
  device?: string | null;
  computeType?: string | null;
};

export type LocalWhisperInstallCommandRunner = (
  command: string,
  args: string[],
  options: RunChildOptions,
) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}>;

export type LocalWhisperInstaller = {
  getSnapshot(): LocalWhisperInstallSnapshot;
  start(input: LocalWhisperInstallStartInput): LocalWhisperInstallSnapshot;
};

type LocalWhisperInstallServiceOptions = {
  paths: DirongUserDataPaths;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  commandRunner?: LocalWhisperInstallCommandRunner;
};

const STEP_TIMEOUTS = {
  checking_python: 10000,
  installing_package: 20 * 60 * 1000,
  checking_package: 30000,
  downloading_model: 60 * 60 * 1000,
  checking_model: 5 * 60 * 1000,
} satisfies Record<Exclude<LocalWhisperInstallStage, "idle" | "done" | "failed">, number>;

export class LocalWhisperInstallService implements LocalWhisperInstaller {
  private snapshot: LocalWhisperInstallSnapshot = {
    status: "idle",
    stage: "idle",
    model: null,
    message: "local-whisper install has not started.",
    detail: null,
    lastLog: null,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
  };

  private task: Promise<void> | null = null;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => Date;
  private readonly commandRunner: LocalWhisperInstallCommandRunner;

  constructor(private readonly options: LocalWhisperInstallServiceOptions) {
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
    this.commandRunner = options.commandRunner ?? runChild;
  }

  getSnapshot(): LocalWhisperInstallSnapshot {
    return { ...this.snapshot };
  }

  start(input: LocalWhisperInstallStartInput): LocalWhisperInstallSnapshot {
    if (this.snapshot.status === "running" && this.task) {
      return this.getSnapshot();
    }

    const startedAt = this.nowIso();
    this.snapshot = {
      status: "running",
      stage: "checking_python",
      model: input.model,
      message: "Checking bundled Python.",
      detail: null,
      lastLog: null,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
    };

    this.task = this.run(input)
      .catch((error) => {
        this.fail(error);
      })
      .finally(() => {
        this.task = null;
      });
    void this.task;

    return this.getSnapshot();
  }

  private async run(input: LocalWhisperInstallStartInput): Promise<void> {
    const python = this.resolvePythonCommand();
    const profile = resolveLocalWhisperToolProfile(
      DEFAULT_LOCAL_WHISPER_TOOL_PROFILE,
    );
    const scriptArgs = profile.args;
    const device = input.device ?? DEFAULT_STT_SETTINGS.localWhisper.device;
    const computeType =
      input.computeType ?? DEFAULT_STT_SETTINGS.localWhisper.computeType;
    const modelPath = path.join(
      this.options.paths.modelsDir,
      `faster-whisper-${input.model}`,
    );

    await this.runStep(
      "checking_python",
      "Checking bundled Python.",
      python,
      ["--version"],
    );
    await this.runStep(
      "installing_package",
      "Installing faster-whisper.",
      python,
      ["-m", "pip", "install", "--upgrade", "faster-whisper"],
    );
    await this.runStep(
      "checking_package",
      "Checking faster-whisper installation.",
      python,
      [...scriptArgs, "--check"],
    );
    await this.runStep(
      "downloading_model",
      `Downloading faster-whisper ${input.model}.`,
      python,
      [
        ...scriptArgs,
        "--download-model",
        "--model",
        input.model,
        "--model-dir",
        this.options.paths.modelsDir,
      ],
    );
    await this.runStep(
      "checking_model",
      "Checking local Whisper model.",
      python,
      [
        ...scriptArgs,
        "--check-model",
        "--model",
        modelPath,
        "--device",
        device,
        "--compute-type",
        computeType,
      ],
    );

    this.update({
      status: "done",
      stage: "done",
      message: "local-whisper is ready.",
      detail: modelPath,
      completedAt: this.nowIso(),
    });
  }

  private async runStep(
    stage: Exclude<LocalWhisperInstallStage, "idle" | "done" | "failed">,
    message: string,
    command: string,
    args: string[],
  ): Promise<void> {
    this.update({ status: "running", stage, message, detail: null });
    const result = await this.commandRunner(command, args, {
      timeoutMs: STEP_TIMEOUTS[stage],
      maxStdoutBytes: 20000,
      maxStderrBytes: 20000,
      killSignal: "SIGKILL",
      redact: redactSensitiveText,
    });
    const lastLog = summarizeProcessOutput(result.stderr || result.stdout);
    this.update({ lastLog });

    if (result.timedOut) {
      throw new Error(`${message} timed out.`);
    }
    if (result.exitCode !== 0) {
      throw new Error(lastLog || `${message} failed with exit ${result.exitCode}.`);
    }
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.update({
      status: "failed",
      stage: "failed",
      message: "local-whisper setup failed.",
      detail: redactSensitiveText(message),
      lastLog: this.snapshot.lastLog ?? redactSensitiveText(message),
      completedAt: this.nowIso(),
    });
  }

  private update(
    patch: Partial<Omit<LocalWhisperInstallSnapshot, "updatedAt">>,
  ): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      updatedAt: this.nowIso(),
    };
  }

  private resolvePythonCommand(): string {
    return (
      cleanPath(this.env.DIRONG_LOCAL_WHISPER_PYTHON) ??
      cleanPath(this.env.DIRONG_PORTABLE_PYTHON) ??
      this.resolvePortableRootPython() ??
      resolveLocalWhisperToolProfile(DEFAULT_LOCAL_WHISPER_TOOL_PROFILE).command
    );
  }

  private resolvePortableRootPython(): string | null {
    const portableRoot = cleanPath(this.env.DIRONG_PORTABLE_ROOT);
    if (!portableRoot) {
      return null;
    }
    const executable = process.platform === "win32" ? "python.exe" : "python";
    return path.join(portableRoot, "python", executable);
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

export function isLocalWhisperInstallModel(
  value: unknown,
): value is LocalWhisperInstallModel {
  return LOCAL_WHISPER_INSTALL_MODELS.includes(
    value as LocalWhisperInstallModel,
  );
}

function cleanPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function summarizeProcessOutput(value: string): string | null {
  const redacted = redactSensitiveText(value).trim();
  if (!redacted) {
    return null;
  }
  return redacted.length <= 2000 ? redacted : `${redacted.slice(0, 2000)}...`;
}
