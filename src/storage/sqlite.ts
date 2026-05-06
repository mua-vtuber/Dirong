import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema.js";

export type SqlValue = null | number | bigint | string | NodeJS.ArrayBufferView;

export class DirongDatabase {
  readonly db: DatabaseSync;

  constructor(
    readonly dbPath: string,
    busyTimeoutMs: number,
    options?: { readOnly?: boolean },
  ) {
    if (!options?.readOnly) {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath, { readOnly: options?.readOnly ?? false });
    if (!options?.readOnly) {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.db.exec(`PRAGMA busy_timeout = ${Math.trunc(busyTimeoutMs)};`);
    this.db.exec("PRAGMA foreign_keys = ON;");
    if (!options?.readOnly) {
      this.db.exec(SCHEMA_SQL);
      applySchemaMigrations(this.db);
    }
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

function applySchemaMigrations(db: DatabaseSync): void {
  const transcriptColumns = db.prepare(
    "PRAGMA table_info(transcript_segments);",
  ).all() as Array<{ name: string }>;
  const transcriptColumnNames = new Set(
    transcriptColumns.map((column) => column.name),
  );

  if (
    transcriptColumns.length > 0 &&
    !transcriptColumnNames.has("speech_status")
  ) {
    db.exec(
      "ALTER TABLE transcript_segments ADD COLUMN speech_status TEXT NOT NULL DEFAULT 'speech';",
    );
  }

  db.exec(
    `UPDATE transcript_segments
     SET speech_status = CASE
       WHEN length(trim(text)) = 0 THEN 'no_speech'
       WHEN speech_status IS NULL OR trim(speech_status) = '' THEN 'speech'
       ELSE speech_status
     END;`,
  );
}
