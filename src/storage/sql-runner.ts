import { type DirongDatabase, type SqlValue } from "./sqlite.js";

export class SqlRunner {
  constructor(private readonly database: DirongDatabase) {}

  transaction<T>(fn: () => T): T {
    return this.database.transaction(fn);
  }

  run(sql: string, ...params: SqlValue[]): void {
    this.database.db.prepare(sql).run(...params);
  }

  get<T>(sql: string, ...params: SqlValue[]): T | null {
    const row = this.database.db.prepare(sql).get(...params);
    return row === undefined ? null : (row as T);
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[] {
    return this.database.db.prepare(sql).all(...params) as T[];
  }
}
