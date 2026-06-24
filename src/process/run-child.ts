import { spawn, spawnSync } from "node:child_process";

export type RunChildOptions = {
  stdin?: string | null;
  timeoutMs: number;
  cwd?: string;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  killSignal?: NodeJS.Signals;
  windowsResolveShellFalse?: boolean;
  redact?: (value: string) => string;
  signal?: AbortSignal;
};

export type RunChildResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export async function runChild(
  command: string,
  args: string[],
  options: RunChildOptions,
): Promise<RunChildResult> {
  const resolved =
    options.windowsResolveShellFalse === false
      ? { command, args }
      : resolveShellFalseCommand(command, args);
  const redact = options.redact ?? ((value: string) => value);

  return await new Promise<RunChildResult>((resolve, reject) => {
    const child = spawn(resolved.command, resolved.args, {
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      shell: false,
      cwd: options.cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let abortListener: (() => void) | null = null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill(options.killSignal ?? "SIGTERM");
    }, options.timeoutMs);
    abortListener = () => {
      timedOut = true;
      child.kill(options.killSignal ?? "SIGTERM");
    };
    options.signal?.addEventListener("abort", abortListener, { once: true });
    if (options.signal?.aborted) {
      abortListener();
    }

    if (!child.stdout || !child.stderr) {
      settled = true;
      clearTimeout(timer);
      if (abortListener) {
        options.signal?.removeEventListener("abort", abortListener);
      }
      reject(new Error("child process stdout/stderr pipes were not available"));
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk.toString("utf8"), options.maxStdoutBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"), options.maxStderrBytes);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (abortListener) {
        options.signal?.removeEventListener("abort", abortListener);
      }
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (abortListener) {
        options.signal?.removeEventListener("abort", abortListener);
      }
      resolve({
        stdout: redact(stdout),
        stderr: redact(stderr),
        exitCode,
        timedOut,
      });
    });

    if (options.stdin !== undefined && child.stdin) {
      child.stdin.end(options.stdin ?? "", "utf8");
    }
  });
}

export function resolveShellFalseCommand(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform !== "win32") {
    return { command, args };
  }

  const lower = command.toLowerCase();
  if (lower.endsWith(".exe") || lower.endsWith(".com")) {
    return { command, args };
  }
  if (lower.endsWith(".ps1")) {
    return {
      command: "pwsh.exe",
      args: ["-NoProfile", "-File", command, ...args],
    };
  }
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return {
      command: "cmd.exe",
      args: ["/C", command, ...args.map(escapeWindowsArg)],
    };
  }

  const resolvedExecutable = resolveWindowsExecutable(command);
  if (resolvedExecutable) {
    return { command: resolvedExecutable, args };
  }

  return { command, args };
}

function resolveWindowsExecutable(command: string): string | null {
  if (/[\\/]/.test(command)) {
    return null;
  }
  const result = spawnSync("where.exe", [command], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  for (const line of result.stdout.split(/\r?\n/)) {
    const candidate = line.trim();
    const lower = candidate.toLowerCase();
    if (lower.endsWith(".exe") || lower.endsWith(".com")) {
      return candidate;
    }
  }
  return null;
}

function appendLimited(
  current: string,
  chunk: string,
  maxBytes: number | undefined,
): string {
  const next = current + chunk;
  if (maxBytes === undefined || Buffer.byteLength(next, "utf8") <= maxBytes) {
    return next;
  }
  return Buffer.from(next, "utf8").subarray(-maxBytes).toString("utf8");
}

function escapeWindowsArg(arg: string): string {
  if (!/[\s"&|<>^()]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '\\"')}"`;
}
