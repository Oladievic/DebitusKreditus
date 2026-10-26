import type { D1Database } from '@cloudflare/workers-types';
import type { Database, SqlValue } from '../db';

export function createD1Database(binding: D1Database): Database {
  const prepare = (sql: string, params: SqlValue[] = []) => binding.prepare(sql).bind(...params);
  return {
    async query<T>(sql: string, params: SqlValue[] = []) {
      const result = await prepare(sql, params).all<T>();
      if (!result.success) throw new Error('Запрос к хранилищу не выполнен');
      return result.results;
    },
    async run(sql: string, params: SqlValue[] = []) {
      const result = await prepare(sql, params).run();
      if (!result.success) throw new Error('Изменение хранилища не выполнено');
      return { changes: result.meta.changes };
    },
    async batch(statements) {
      if (statements.length === 0) return [];
      const results = await binding.batch(
        statements.map(({ sql, params }) => prepare(sql, params)),
      );
      if (results.some((result) => !result.success)) throw new Error('Транзакция не выполнена');
      return results.map((result) => ({ changes: result.meta.changes }));
    },
  };
}
