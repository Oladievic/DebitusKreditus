import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Database, SqlStatement, SqlValue } from '../db';

export interface LocalDatabase extends Database {
  migrate(directory: string): void;
  close(): void;
}

export function openSqliteDatabase(filename: string): LocalDatabase {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

  const run = (sql: string, params: SqlValue[] = []) => {
    const result = sqlite.prepare(sql).run(...params);
    return { changes: Number(result.changes) };
  };

  return {
    async query<T>(sql: string, params: SqlValue[] = []) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: SqlValue[] = []) {
      return run(sql, params);
    },
    async batch(statements: SqlStatement[]) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(({ sql, params }) => run(sql, params));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    migrate(directory: string) {
      sqlite.exec(
        'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)',
      );
      const files = readdirSync(directory)
        .filter((name) => /^\d+_[\w-]+\.sql$/.test(name))
        .sort();
      for (const name of files) {
        const sql = readFileSync(path.join(directory, name), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const applied = sqlite.prepare('SELECT checksum FROM _migrations WHERE name = ?').get(name);
        if (applied) {
          if (applied.checksum !== checksum)
            throw new Error(`Применённая миграция изменена: ${name}`);
          continue;
        }
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          sqlite.exec(sql);
          run('INSERT INTO _migrations (name, checksum, applied_at) VALUES (?, ?, ?)', [
            name,
            checksum,
            new Date().toISOString(),
          ]);
          sqlite.exec('COMMIT');
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      }
    },
    close() {
      sqlite.close();
    },
  };
}
