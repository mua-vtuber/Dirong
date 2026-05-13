import { createHash } from "node:crypto";
import { SqlRunner } from "../storage/sql-runner.js";
import { DEFAULT_PROJECT_ID } from "../projects/project-types.js";

export type NotionWriteStatus =
  | "queued"
  | "processing"
  | "creating_page"
  | "appending_blocks"
  | "retry_wait"
  | "done"
  | "failed"
  | "blocked";

export type NotionBlockStatus = "pending" | "appended" | "failed";

export type NotionWriteRow = {
  id: string;
  project_id: string | null;
  session_id: string;
  draft_id: string;
  target_type: "data_source";
  target_id: string;
  target_url: string;
  notion_page_id: string | null;
  notion_page_url: string | null;
  content_hash: string;
  status: NotionWriteStatus;
  status_message: string | null;
  last_successful_block_index: number;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  locked_until: string | null;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type NotionBlockRow = {
  notion_write_id: string;
  block_index: number;
  content_hash: string;
  notion_block_id: string | null;
  status: NotionBlockStatus;
  appended_at: string | null;
  last_error: string | null;
};

export type CreateNotionWriteInput = {
  id?: string;
  projectId?: string;
  sessionId: string;
  draftId: string;
  targetType: "data_source";
  targetId: string;
  targetUrl: string;
  contentHash: string;
  maxAttempts: number;
  nowIso: string;
};

export type SavePageCreatedInput = {
  id: string;
  pageId: string;
  pageUrl: string;
  nowIso: string;
};

export type SaveBlockAppendedInput = {
  writeId: string;
  blockIndex: number;
  contentHash: string;
  blockId: string | null;
  nowIso: string;
};

export type SaveRecoveredBlocksInput = {
  writeId: string;
  blocks: Array<{
    blockIndex: number;
    contentHash: string;
    blockId: string | null;
  }>;
  nowIso: string;
};

export type MarkRetryWaitInput = {
  id: string;
  nextAttemptAt: string;
  statusMessage: string;
  lastError: string | null;
  nowIso: string;
};

export type MarkTerminalInput = {
  id: string;
  statusMessage: string;
  lastError?: string | null;
  nowIso: string;
};

export class NotionWriteStore {
  constructor(private readonly runner: SqlRunner) {}

  createOrGetWrite(input: CreateNotionWriteInput): NotionWriteRow {
    const projectId = cleanRequiredString(
      input.projectId ?? DEFAULT_PROJECT_ID,
      "projectId",
    );
    const id = input.id ?? buildWriteId(input.draftId, projectId, input.targetId);
    this.runner.run(
      `INSERT OR IGNORE INTO notion_writes (
         id, project_id, session_id, draft_id, target_type, target_id, target_url,
         content_hash, status, status_message, max_attempts, next_attempt_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
      id,
      projectId,
      input.sessionId,
      input.draftId,
      input.targetType,
      input.targetId,
      input.targetUrl,
      input.contentHash,
      "Notion upload queued",
      input.maxAttempts,
      input.nowIso,
      input.nowIso,
      input.nowIso,
    );

    const row = this.getWriteByDraftTarget(
      input.draftId,
      input.targetId,
      projectId,
    );
    if (!row) {
      throw new Error("Notion write row를 생성하지 못했습니다.");
    }
    return row;
  }

  getWriteByDraftTarget(
    draftId: string,
    targetId: string,
    projectId = DEFAULT_PROJECT_ID,
  ): NotionWriteRow | null {
    return this.runner.get<NotionWriteRow>(
      `SELECT *
       FROM notion_writes
       WHERE draft_id = ?
         AND project_id = ?
         AND target_type = 'data_source'
         AND target_id = ?`,
      draftId,
      cleanRequiredString(projectId, "projectId"),
      targetId,
    );
  }

  getWrite(id: string): NotionWriteRow | null {
    return this.runner.get<NotionWriteRow>(
      "SELECT * FROM notion_writes WHERE id = ?",
      id,
    );
  }

  getLatestWriteForSession(sessionId: string): NotionWriteRow | null {
    return this.runner.get<NotionWriteRow>(
      `SELECT *
       FROM notion_writes
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      sessionId,
    );
  }

  listDueWrites(nowIso: string, limit: number): NotionWriteRow[] {
    return this.runner.all<NotionWriteRow>(
      `SELECT *
       FROM notion_writes
       WHERE
         project_id IS NOT NULL
         AND
         locked_by IS NULL
         AND status IN ('queued', 'retry_wait')
         AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT ?`,
      nowIso,
      limit,
    );
  }

  claimWrite(
    id: string,
    workerId: string,
    leaseMs: number,
    options: { force?: boolean } = {},
  ): NotionWriteRow | null {
    let claimed: NotionWriteRow | null = null;
    const nowIso = new Date().toISOString();
    const lockedUntil = new Date(Date.now() + leaseMs).toISOString();

    this.runner.transaction(() => {
      const row = this.getWrite(id);
      if (!row || !canClaim(row, nowIso, options.force === true)) {
        return;
      }

      if (row.attempts >= row.max_attempts) {
        this.runner.run(
          `UPDATE notion_writes
           SET status = 'failed',
               status_message = ?,
               last_error = ?,
               locked_by = NULL,
               locked_until = NULL,
               updated_at = ?
           WHERE id = ?`,
          "Notion upload attempts exhausted",
          "max attempts reached before claim",
          nowIso,
          id,
        );
        return;
      }

      this.runner.run(
        `UPDATE notion_writes
         SET status = 'processing',
             attempts = attempts + 1,
             locked_by = ?,
             locked_until = ?,
             updated_at = ?
         WHERE id = ?`,
        workerId,
        lockedUntil,
        nowIso,
        id,
      );
      claimed = this.getWrite(id);
    });

    return claimed;
  }

  savePageCreated(input: SavePageCreatedInput): void {
    this.runner.transaction(() => {
      this.runner.run(
        `UPDATE notion_writes
         SET notion_page_id = ?,
             notion_page_url = ?,
             status = 'appending_blocks',
             status_message = ?,
             updated_at = ?
         WHERE id = ?`,
        input.pageId,
        input.pageUrl,
        "Notion page created",
        input.nowIso,
        input.id,
      );
    });
  }

  saveBlockAppended(input: SaveBlockAppendedInput): void {
    this.saveRecoveredBlocks({
      writeId: input.writeId,
      blocks: [
        {
          blockIndex: input.blockIndex,
          contentHash: input.contentHash,
          blockId: input.blockId,
        },
      ],
      nowIso: input.nowIso,
    });
  }

  saveRecoveredBlocks(input: SaveRecoveredBlocksInput): void {
    this.runner.transaction(() => {
      for (const block of input.blocks) {
        this.runner.run(
          `INSERT INTO notion_blocks (
             notion_write_id, block_index, content_hash, notion_block_id,
             status, appended_at, last_error
           ) VALUES (?, ?, ?, ?, 'appended', ?, NULL)
           ON CONFLICT(notion_write_id, block_index) DO UPDATE SET
             content_hash = excluded.content_hash,
             notion_block_id = excluded.notion_block_id,
             status = 'appended',
             appended_at = excluded.appended_at,
             last_error = NULL`,
          input.writeId,
          block.blockIndex,
          block.contentHash,
          block.blockId,
          input.nowIso,
        );
      }

      const maxIndex =
        input.blocks.length === 0
          ? -1
          : Math.max(...input.blocks.map((block) => block.blockIndex));
      if (maxIndex >= 0) {
        this.runner.run(
          `UPDATE notion_writes
           SET last_successful_block_index =
                 max(last_successful_block_index, ?),
               status = 'appending_blocks',
               updated_at = ?
           WHERE id = ?`,
          maxIndex,
          input.nowIso,
          input.writeId,
        );
      }
    });
  }

  markRetryWait(input: MarkRetryWaitInput): void {
    this.runner.run(
      `UPDATE notion_writes
       SET status = 'retry_wait',
           status_message = ?,
           last_error = ?,
           next_attempt_at = ?,
           locked_by = NULL,
           locked_until = NULL,
           updated_at = ?
       WHERE id = ?`,
      input.statusMessage,
      input.lastError,
      input.nextAttemptAt,
      input.nowIso,
      input.id,
    );
  }

  markDone(input: MarkTerminalInput): void {
    this.markTerminal("done", input);
  }

  markFailed(input: MarkTerminalInput): void {
    this.markTerminal("failed", input);
  }

  markBlocked(input: MarkTerminalInput): void {
    this.markTerminal("blocked", input);
  }

  releaseExpiredLeases(nowIso: string): number {
    let released = 0;
    this.runner.transaction(() => {
      const rows = this.runner.all<NotionWriteRow>(
        `SELECT *
         FROM notion_writes
         WHERE locked_by IS NOT NULL
           AND locked_until IS NOT NULL
           AND locked_until <= ?
           AND status IN ('processing', 'creating_page', 'appending_blocks')`,
        nowIso,
      );

      for (const row of rows) {
        const exhausted = row.attempts >= row.max_attempts;
        this.runner.run(
          `UPDATE notion_writes
           SET status = ?,
               status_message = ?,
               last_error = ?,
               locked_by = NULL,
               locked_until = NULL,
               next_attempt_at = ?,
               updated_at = ?
           WHERE id = ?`,
          exhausted ? "failed" : "retry_wait",
          exhausted
            ? "Notion upload attempts exhausted after expired lease"
            : "Notion upload lease expired; retrying",
          "expired Notion write lease",
          nowIso,
          nowIso,
          row.id,
        );
        released += 1;
      }
    });
    return released;
  }

  listBlocks(writeId: string): NotionBlockRow[] {
    return this.runner.all<NotionBlockRow>(
      `SELECT *
       FROM notion_blocks
       WHERE notion_write_id = ?
       ORDER BY block_index ASC`,
      writeId,
    );
  }

  private markTerminal(
    status: Extract<NotionWriteStatus, "done" | "failed" | "blocked">,
    input: MarkTerminalInput,
  ): void {
    this.runner.run(
      `UPDATE notion_writes
       SET status = ?,
           status_message = ?,
           last_error = ?,
           locked_by = NULL,
           locked_until = NULL,
           updated_at = ?
       WHERE id = ?`,
      status,
      input.statusMessage,
      input.lastError ?? null,
      input.nowIso,
      input.id,
    );
  }
}

function canClaim(
  row: NotionWriteRow,
  nowIso: string,
  force: boolean,
): boolean {
  if (row.project_id === null) {
    return false;
  }
  if (row.locked_by !== null) {
    return false;
  }
  if (force && (row.status === "blocked" || row.status === "failed")) {
    return true;
  }
  if (force && row.status === "retry_wait") {
    return true;
  }
  return (
    row.status === "queued" ||
    (row.status === "retry_wait" && row.next_attempt_at <= nowIso)
  );
}

function buildWriteId(
  draftId: string,
  projectId: string,
  targetId: string,
): string {
  const hash = createHash("sha256")
    .update(`${draftId}\u0000${projectId}\u0000${targetId}`)
    .digest("hex")
    .slice(0, 16);
  return `notion_write_${hash}`;
}

function cleanRequiredString(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error(`${label} must not be empty.`);
  }
  return cleaned;
}
