import {
  appendFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import type { Phase0Config, SttSafeFormat } from "./config.js";
import type { Phase0HealthReport } from "./health.js";
import { redactForJson } from "./errors.js";

export type Phase0Result = "pass" | "fail" | "inconclusive";

export type ChunkRecord = {
  chunkId: string;
  userId: string;
  displayNameSnapshot: string;
  startedAtMs: number;
  endedAtMs: number;
  rawAudioPath: string;
  rawAudioFormat: "ogg-opus";
  sttAudioPath: string | null;
  sttAudioFormat: SttSafeFormat | null;
  byteSize: number;
  sttByteSize: number;
  durationMs: number;
  sha256: string | null;
  playbackChecked: boolean;
  transcodeStatus: "done" | "failed" | "skipped";
  transcodeError: string | null;
  finalizedReason: string;
};

export type Phase0SessionJson = {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  guildId: string;
  voiceChannelId: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  discordJsVersion: string | null;
  discordJsVoiceVersion: string | null;
  opusLibrary: string | null;
  ffmpegPath: string | null;
  daveProtocolVersion: string | number | null;
  daveEvidence: unknown[];
  result: Phase0Result;
  resultReason: string;
  limitations: string[];
  chunks: ChunkRecord[];
};

export type SessionEvent = {
  at: string;
  msSinceStart: number;
  type: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  details?: unknown;
};

export class Phase0SessionWriter {
  readonly sessionId: string;
  readonly sessionDir: string;
  readonly chunksDir: string;
  readonly sttSafeDir: string;

  private readonly startedAtMs = Date.now();
  private readonly sessionPath: string;
  private readonly eventsPath: string;
  private readonly healthPath: string;
  private session: Phase0SessionJson;

  constructor(
    config: Phase0Config,
    health: Phase0HealthReport,
  ) {
    this.sessionId = timestampForFolder(new Date());
    this.sessionDir = path.join(config.dataDir, this.sessionId);
    this.chunksDir = path.join(this.sessionDir, "chunks");
    this.sttSafeDir = path.join(this.sessionDir, "stt-safe");
    this.sessionPath = path.join(this.sessionDir, "session.json");
    this.eventsPath = path.join(this.sessionDir, "events.jsonl");
    this.healthPath = path.join(this.sessionDir, "health.json");

    mkdirSync(this.chunksDir, { recursive: true });
    mkdirSync(this.sttSafeDir, { recursive: true });

    this.session = {
      sessionId: this.sessionId,
      startedAt: new Date(this.startedAtMs).toISOString(),
      endedAt: null,
      guildId: config.guildId,
      voiceChannelId: config.voiceChannelId,
      nodeVersion: process.version,
      platform: process.platform,
      discordJsVersion: health.packageVersions["discord.js"] ?? null,
      discordJsVoiceVersion: health.packageVersions["@discordjs/voice"] ?? null,
      opusLibrary: health.opusLibrary,
      ffmpegPath: health.ffmpeg.path,
      daveProtocolVersion: null,
      daveEvidence: [],
      result: "inconclusive",
      resultReason: "세션 진행 중입니다.",
      limitations: [
        "@discordjs/voice receive는 Discord에서 공식 문서화한 안정 API가 아니므로 실제 음성 채널에서 재생 가능한 파일로 검증해야 합니다.",
        "@discordjs/voice가 DAVE protocolVersion/session transition을 직접 노출하지 않으면 voice debug/state evidence만 기록합니다.",
      ],
      chunks: [],
    };

    this.writeHealth(health);
    this.writeSession();
  }

  get startedMs(): number {
    return this.startedAtMs;
  }

  get json(): Phase0SessionJson {
    return this.session;
  }

  event(
    type: string,
    message: string,
    details?: unknown,
    level: SessionEvent["level"] = "info",
  ): void {
    const event: SessionEvent = {
      at: new Date().toISOString(),
      msSinceStart: Date.now() - this.startedAtMs,
      type,
      level,
      message,
      details: details === undefined ? undefined : redactForJson(details),
    };
    appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, "utf8");
  }

  addChunk(chunk: ChunkRecord): void {
    this.session.chunks.push(chunk);
    this.writeSession();
  }

  addLimitation(message: string): void {
    if (!this.session.limitations.includes(message)) {
      this.session.limitations.push(message);
      this.writeSession();
    }
  }

  addDaveEvidence(evidence: unknown): void {
    const redacted = redactForJson(evidence);
    this.session.daveEvidence.push(redacted);

    const protocolVersion = findProtocolVersion(redacted);
    if (protocolVersion !== null) {
      this.session.daveProtocolVersion = protocolVersion;
    }

    this.writeSession();
  }

  finalize(result: Phase0Result, reason: string): void {
    this.session.endedAt = new Date().toISOString();
    this.session.result = result;
    this.session.resultReason = reason;
    this.writeSession();
  }

  toRelative(filePath: string | null): string | null {
    if (!filePath) {
      return null;
    }
    return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  }

  private writeHealth(health: Phase0HealthReport): void {
    writeFileSync(
      this.healthPath,
      `${JSON.stringify(redactForJson(health), null, 2)}\n`,
      "utf8",
    );
  }

  private writeSession(): void {
    writeFileSync(
      this.sessionPath,
      `${JSON.stringify(redactForJson(this.session), null, 2)}\n`,
      "utf8",
    );
  }
}

function timestampForFolder(date: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function findProtocolVersion(value: unknown): string | number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProtocolVersion(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (/protocolVersion|daveProtocolVersion/i.test(key)) {
      if (typeof entry === "string" || typeof entry === "number") {
        return entry;
      }
    }
    const found = findProtocolVersion(entry);
    if (found !== null) {
      return found;
    }
  }

  return null;
}
