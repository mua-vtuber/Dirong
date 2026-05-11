import { redactForJson } from "../errors.js";
import type { SqlRunner } from "./sql-runner.js";

export type RepairRepositoryOptions = {
  now(): string;
  toStoredPath(filePath: string | null): string | null;
};

export class RepairRepository {
  constructor(
    private readonly sql: SqlRunner,
    private readonly options: RepairRepositoryOptions,
  ) {}

  recordConnectionEvent(input: {
    sessionId: string | null;
    eventType: string;
    level?: "debug" | "info" | "warn" | "error";
    startedAtMs?: number | null;
    endedAtMs?: number | null;
    details?: unknown;
  }): void {
    this.sql.run(
      `INSERT INTO connection_events (
        session_id, event_type, level, started_at_ms, ended_at_ms,
        details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.sessionId,
      input.eventType,
      input.level ?? "info",
      input.startedAtMs ?? null,
      input.endedAtMs ?? null,
      input.details === undefined
        ? null
        : JSON.stringify(redactForJson(input.details)),
      this.options.now(),
    );
  }

  recordItem(input: {
    type: string;
    status?: "open" | "repaired" | "failed" | "ignored";
    severity?: "info" | "warn" | "error";
    sessionId?: string | null;
    path?: string | null;
    chunkId?: string | null;
    sttJobId?: string | null;
    details?: unknown;
  }): void {
    const now = this.options.now();
    const storedPath = this.options.toStoredPath(input.path ?? null);
    const dedupeKey = makeRepairItemDedupeKey({
      type: input.type,
      sessionId: input.sessionId ?? null,
      path: storedPath,
      chunkId: input.chunkId ?? null,
      sttJobId: input.sttJobId ?? null,
    });

    this.sql.run(
      `INSERT INTO repair_items (
        dedupe_key, session_id, item_type, status, severity, path,
        chunk_id, stt_job_id, details_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        status = excluded.status,
        severity = excluded.severity,
        details_json = excluded.details_json,
        updated_at = excluded.updated_at,
        resolved_at = CASE
          WHEN excluded.status IN ('repaired', 'ignored') THEN excluded.updated_at
          ELSE repair_items.resolved_at
        END`,
      dedupeKey,
      input.sessionId ?? null,
      input.type,
      input.status ?? "open",
      input.severity ?? "warn",
      storedPath,
      input.chunkId ?? null,
      input.sttJobId ?? null,
      input.details === undefined
        ? null
        : JSON.stringify(redactForJson(input.details)),
      now,
      now,
    );
  }

  normalizeDedupeKeys(): void {
    const repairItems = this.sql.all<{
      row_id: number;
      dedupe_key: string;
      item_type: string;
      session_id: string | null;
      path: string | null;
      chunk_id: string | null;
      stt_job_id: string | null;
    }>(
      `SELECT rowid AS row_id, dedupe_key, item_type, session_id, path, chunk_id, stt_job_id
       FROM repair_items`,
    );

    for (const item of repairItems) {
      const dedupeKey = makeRepairItemDedupeKey({
        type: item.item_type,
        sessionId: item.session_id,
        path: item.path,
        chunkId: item.chunk_id,
        sttJobId: item.stt_job_id,
      });
      if (dedupeKey === item.dedupe_key) {
        continue;
      }
      this.sql.run(
        "UPDATE OR IGNORE repair_items SET dedupe_key = ? WHERE rowid = ?",
        dedupeKey,
        item.row_id,
      );
    }
  }
}

export function makeRepairItemDedupeKey(input: {
  type: string;
  sessionId: string | null;
  path: string | null;
  chunkId: string | null;
  sttJobId: string | null;
}): string {
  return [
    input.type,
    input.sessionId ?? "",
    input.path ?? "",
    input.chunkId ?? "",
    input.sttJobId ?? "",
  ].join(":");
}
