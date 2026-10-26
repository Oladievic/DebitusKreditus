import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { openSqliteDatabase } from '../server/runtime/sqlite';

test('SQLite применяет миграцию один раз и сохраняет внешние ключи', async () => {
  const db = openSqliteDatabase(':memory:');
  try {
    db.migrate(path.resolve('migrations'));
    db.migrate(path.resolve('migrations'));
    const applied = await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM _migrations');
    assert.equal(applied[0].count, 6);
    await assert.rejects(
      db.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [
        'orphan',
        'missing',
        '2027-01-01',
      ]),
    );
  } finally {
    db.close();
  }
});

test('SQLite откатывает весь пакет при ошибке второго изменения', async () => {
  const db = openSqliteDatabase(':memory:');
  try {
    db.migrate(path.resolve('migrations'));
    await assert.rejects(
      db.batch([
        { sql: 'INSERT INTO organizations (id, data) VALUES (?, ?)', params: ['rollback', '{}'] },
        { sql: 'INSERT INTO organizations (id, data) VALUES (?, ?)', params: ['rollback', '{}'] },
      ]),
    );
    assert.deepEqual(await db.query('SELECT id FROM organizations WHERE id = ?', ['rollback']), []);
    assert.deepEqual(
      await db.batch([
        {
          sql: 'INSERT INTO organizations (id, data) VALUES (?, ?)',
          params: ['after-rollback', '{}'],
        },
      ]),
      [{ changes: 1 }],
    );
  } finally {
    db.close();
  }
});
