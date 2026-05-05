import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { redactSensitiveText } from "./errors.js";
import type { SttSafeFormat } from "./config.js";

const require = createRequire(import.meta.url);

export type ProcessResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type TranscodeResult = {
  outputPath: string;
  format: SttSafeFormat;
  byteSize: number;
  playbackChecked: boolean;
  error?: string;
};

export async function resolveFfmpegPath(): Promise<{
  path: string | null;
  source: "ffmpeg-static" | "system" | "missing";
  version?: string;
  error?: string;
}> {
  const staticPath = safeRequireString("ffmpeg-static");
  if (staticPath && existsSync(staticPath)) {
    const versionResult = await runProcess(staticPath, ["-version"], 5000);
    return {
      path: staticPath,
      source: "ffmpeg-static",
      version: firstLine(versionResult.stdout),
      error: versionResult.ok ? undefined : versionResult.stderr,
    };
  }

  const systemResult = await runProcess("ffmpeg", ["-version"], 5000);
  if (systemResult.ok) {
    return {
      path: "ffmpeg",
      source: "system",
      version: firstLine(systemResult.stdout),
    };
  }

  return {
    path: null,
    source: "missing",
    error: systemResult.stderr || "ffmpeg 실행 파일을 찾지 못했습니다.",
  };
}

export async function transcodeToSttSafe(
  inputPath: string,
  outputDir: string,
  baseName: string,
  preferredFormat: SttSafeFormat,
  ffmpegPath: string,
): Promise<TranscodeResult> {
  const first = await tryTranscode(
    inputPath,
    outputDir,
    baseName,
    preferredFormat,
    ffmpegPath,
  );
  if (first.playbackChecked) {
    return first;
  }

  const fallbackFormat: SttSafeFormat = preferredFormat === "webm" ? "wav" : "webm";
  const fallback = await tryTranscode(
    inputPath,
    outputDir,
    baseName,
    fallbackFormat,
    ffmpegPath,
  );

  if (fallback.playbackChecked) {
    return {
      ...fallback,
      error: `기본 ${preferredFormat} 변환 실패 후 ${fallbackFormat}로 대체했습니다. 원인: ${first.error ?? "알 수 없음"}`,
    };
  }

  return {
    ...first,
    error: `STT-safe 변환 실패: ${first.error ?? "기본 포맷 실패"} / fallback: ${fallback.error ?? "fallback 실패"}`,
  };
}

export async function validatePlayable(
  filePath: string,
  ffmpegPath: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!existsSync(filePath)) {
    return { ok: false, error: "파일이 없습니다." };
  }

  const fileStat = await stat(filePath);
  if (fileStat.size === 0) {
    return { ok: false, error: "파일 크기가 0바이트입니다." };
  }

  const result = await runProcess(
    ffmpegPath,
    ["-hide_banner", "-v", "error", "-i", filePath, "-f", "null", "-"],
    30000,
  );

  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr || `ffmpeg 검증 실패(exit=${result.exitCode})`,
    };
  }

  return { ok: true };
}

export async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ProcessResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = limitText(stdout + chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = limitText(stderr + chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        stdout: redactSensitiveText(stdout),
        stderr: redactSensitiveText(error.message),
        timedOut,
      });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        stdout: redactSensitiveText(stdout),
        stderr: redactSensitiveText(stderr),
        timedOut,
      });
    });
  });
}

async function tryTranscode(
  inputPath: string,
  outputDir: string,
  baseName: string,
  format: SttSafeFormat,
  ffmpegPath: string,
): Promise<TranscodeResult> {
  const outputPath = path.join(outputDir, `${baseName}.${format}`);
  const args =
    format === "webm"
      ? [
          "-hide_banner",
          "-nostdin",
          "-y",
          "-i",
          inputPath,
          "-vn",
          "-c:a",
          "libopus",
          "-b:a",
          "32k",
          outputPath,
        ]
      : [
          "-hide_banner",
          "-nostdin",
          "-y",
          "-i",
          inputPath,
          "-vn",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          outputPath,
        ];

  const result = await runProcess(ffmpegPath, args, 60000);
  if (!result.ok) {
    return {
      outputPath,
      format,
      byteSize: 0,
      playbackChecked: false,
      error: result.stderr || `ffmpeg exit=${result.exitCode}`,
    };
  }

  const playback = await validatePlayable(outputPath, ffmpegPath);
  const outputStat = existsSync(outputPath) ? await stat(outputPath) : { size: 0 };

  return {
    outputPath,
    format,
    byteSize: outputStat.size,
    playbackChecked: playback.ok,
    error: playback.error,
  };
}

function safeRequireString(packageName: string): string | null {
  try {
    const value = require(packageName) as unknown;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
}

function limitText(value: string): string {
  return value.length > 20000 ? value.slice(-20000) : value;
}
