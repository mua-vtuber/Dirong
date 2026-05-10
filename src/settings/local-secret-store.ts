import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { registerSensitiveValue } from "../errors.js";

export const DEFAULT_SECRET_REFS = {
  discordBotToken: "discord.bot_token",
  openAiApiKey: "stt.openai_api_key",
  claudeApiKey: "ai.claude_api_key",
  notionToken: "notion.internal_connection_token",
} as const;

export type SecretPresenceSnapshot = {
  configured: boolean;
  displayValue: "[REDACTED]" | "[MISSING]";
};

type LocalSecretFile = {
  schemaVersion: 1;
  secrets: Record<string, LocalSecretRecord>;
};

type LocalSecretRecord = {
  value: string;
  createdAt: string;
  updatedAt: string;
};

export class LocalSecretStore {
  constructor(readonly filePath: string) {}

  get(ref: string | undefined): string | null {
    const normalizedRef = normalizeSecretRef(ref);
    if (!normalizedRef) {
      return null;
    }
    const secret = this.readFile().secrets[normalizedRef]?.value ?? null;
    if (secret) {
      registerSensitiveValue(secret);
    }
    return secret;
  }

  has(ref: string | undefined): boolean {
    return Boolean(this.get(ref));
  }

  snapshot(ref: string | undefined): SecretPresenceSnapshot {
    const configured = this.has(ref);
    return {
      configured,
      displayValue: configured ? "[REDACTED]" : "[MISSING]",
    };
  }

  listRefs(): string[] {
    return Object.keys(this.readFile().secrets).sort();
  }

  set(ref: string, value: string, nowIso = new Date().toISOString()): void {
    const normalizedRef = requireSecretRef(ref);
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      throw new Error("secret value는 비워 둘 수 없습니다.");
    }

    const file = this.readFile();
    const current = file.secrets[normalizedRef];
    file.secrets[normalizedRef] = {
      value: trimmedValue,
      createdAt: current?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    this.writeFile(file);
    registerSensitiveValue(trimmedValue);
  }

  delete(ref: string): void {
    const normalizedRef = requireSecretRef(ref);
    const file = this.readFile();
    delete file.secrets[normalizedRef];
    this.writeFile(file);
  }

  private readFile(): LocalSecretFile {
    if (!existsSync(this.filePath)) {
      return { schemaVersion: 1, secrets: {} };
    }

    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
    const file = normalizeSecretFile(parsed);
    for (const secret of Object.values(file.secrets)) {
      registerSensitiveValue(secret.value);
    }
    return file;
  }

  private writeFile(file: LocalSecretFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // Windows may ignore POSIX permission bits; the local file remains private to the user profile.
    }
    renameSync(tmpPath, this.filePath);
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // Best effort only on platforms that support chmod semantics.
    }
  }
}

function normalizeSecretFile(value: unknown): LocalSecretFile {
  const record = isRecord(value) ? value : {};
  const rawSecrets = isRecord(record.secrets) ? record.secrets : {};
  const secrets: Record<string, LocalSecretRecord> = {};

  for (const [ref, entry] of Object.entries(rawSecrets)) {
    const normalizedRef = normalizeSecretRef(ref);
    if (!normalizedRef || !isRecord(entry)) {
      continue;
    }
    const secret = readString(entry.value);
    if (!secret) {
      continue;
    }
    secrets[normalizedRef] = {
      value: secret,
      createdAt: readString(entry.createdAt) ?? new Date(0).toISOString(),
      updatedAt: readString(entry.updatedAt) ?? new Date(0).toISOString(),
    };
  }

  return { schemaVersion: 1, secrets };
}

function requireSecretRef(ref: string): string {
  const normalizedRef = normalizeSecretRef(ref);
  if (!normalizedRef) {
    throw new Error("secret ref는 영문, 숫자, 점, 밑줄, 콜론, 하이픈만 사용할 수 있습니다.");
  }
  return normalizedRef;
}

function normalizeSecretRef(ref: string | undefined): string | null {
  const trimmed = ref?.trim();
  if (!trimmed || !/^[a-z0-9._:-]{1,120}$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
