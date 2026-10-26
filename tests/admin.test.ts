import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';
import { initializeDatabase } from '../server/seed.js';
import { auditStatement } from '../server/repository.js';
import type { Database } from '../server/db.js';
import type {
  AdminOverview,
  AdminProduct,
  AdminRegistryRow,
  AdminUserStatus,
  Application,
  ApplicationDetail,
  AuditRecord,
  User,
} from '../shared/types.js';

async function setup() {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
  const call = (route: string, cookie = '', method = 'GET', body?: unknown) =>
    app.request(`http://localhost/api${route}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (role: 'admin' | 'bank' | 'client') => {
    const response = await call('/auth/login', '', 'POST', {
      email: role === 'client' ? 'owner@sever.example.test' : `${role}@debitus.example.test`,
      password: 'Demo2026!',
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  return { db, app, call, login };
}
async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body as T;
}
const pause = { version: 1, paused: true, reason: 'Проверяем обновлённые условия продукта' };

test('admin is a separate seeded role; client and bank cannot administer or impersonate it', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const admin = await s.login('admin'),
    bank = await s.login('bank'),
    client = await s.login('client');
  const identity = await read<{ user: User }>(await s.call('/auth/me', admin));
  assert.equal(identity.user.role, 'admin');
  assert.equal(identity.user.organizationId, null);
  for (const cookie of [bank, client]) {
    for (const route of [
      '/admin/overview',
      '/admin/users',
      '/admin/products',
      '/admin/registry',
      '/admin/audit',
      '/admin/export?kind=audit',
    ])
      assert.equal((await s.call(route, cookie)).status, 403, route);
    assert.equal(
      (await s.call('/admin/products/working_capital/intake', cookie, 'PATCH', pause)).status,
      403,
    );
  }
  assert.equal((await s.call('/admin/overview')).status, 401);
  for (const route of [
    '/applications/app_sever_expansion',
    '/applications/app_sever_working',
    '/documents',
    '/audit',
    '/search?q=Север',
    '/bank/queue',
    '/export',
    '/integrations/tokens',
  ])
    assert.equal((await s.call(route, admin)).status, 403, route);
  assert.equal(
    (await s.call('/bank/applications/app_sever_expansion/decision', admin, 'POST', { version: 1 }))
      .status,
    403,
  );
  assert.equal(
    (await s.call('/applications/app_sever_working/actions/submit', admin, 'POST', { version: 1 }))
      .status,
    403,
  );
});

test('admin overview and exports omit draft contents, financial details and authentication secrets', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const admin = await s.login('admin');
  await s.login('client');
  const overview = await read<AdminOverview>(await s.call('/admin/overview', admin));
  assert.equal(overview.users, 5);
  assert.equal(overview.activeSessions, 2);
  assert.equal(overview.organizations, 3);
  assert.equal(overview.applicationCounts.find((row) => row.status === 'draft')?.count, 1);
  const accounts = await read<{ users: AdminUserStatus[] }>(await s.call('/admin/users', admin));
  assert.equal(accounts.users.find((user) => user.role === 'admin')?.activeSessions, 1);
  const registry = await read<{ applications: AdminRegistryRow[] }>(
    await s.call('/admin/registry', admin),
  );
  assert.equal(registry.applications.length, 3);
  assert.ok(registry.applications.every((row) => row.status !== 'draft'));
  const events = await read<{ events: AuditRecord[] }>(await s.call('/admin/audit', admin));
  const combined = JSON.stringify({ accounts, registry, events });
  for (const secret of [
    'password_hash',
    'password_salt',
    'financials',
    'monthlyRevenue',
    'app_sever_working',
    'Закупка древесины',
    'dk_session',
  ])
    assert.equal(combined.includes(secret), false, secret);
  const exported = await read<{ rows: AdminRegistryRow[] }>(
    await s.call('/admin/export?kind=registry&format=json', admin),
  );
  assert.deepEqual(exported.rows, registry.applications);
  const auditExport = await read<{ rows: AuditRecord[] }>(
    await s.call('/admin/export?kind=audit&format=json', admin),
  );
  assert.ok(auditExport.rows.some((event) => event.action === 'platform_export'));
});

test('pausing intake blocks only first submission and audits every effective change once', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const admin = await s.login('admin'),
    client = await s.login('client'),
    bank = await s.login('bank');
  const before = await read<ApplicationDetail>(
    await s.call('/applications/app_sever_working', client),
  );
  await read(await s.call('/admin/products/working_capital/intake', admin, 'PATCH', pause));
  const duplicate = await read<{ unchanged: boolean }>(
    await s.call('/admin/products/working_capital/intake', admin, 'PATCH', {
      ...pause,
      version: 2,
    }),
  );
  assert.equal(duplicate.unchanged, true);
  assert.equal(
    (
      await s.call('/applications/app_sever_working/actions/submit', client, 'POST', {
        version: before.application.version,
      })
    ).status,
    409,
  );
  const after = await read<ApplicationDetail>(
    await s.call('/applications/app_sever_working', client),
  );
  assert.deepEqual(after.application, before.application);
  assert.deepEqual(after.timeline, before.timeline);
  const pending = await read<ApplicationDetail>(
    await s.call('/applications/app_sever_expansion', bank),
  );
  const review = await read<ApplicationDetail>(
    await s.call('/bank/applications/app_sever_expansion/review', bank, 'POST', {
      version: pending.application.version,
    }),
  );
  const decision = await read<ApplicationDetail>(
    await s.call('/bank/applications/app_sever_expansion/decision', bank, 'POST', {
      version: review.application.version,
    }),
  );
  assert.equal(decision.application.status, 'counter_offer');
  const terraLogin = await s.call('/auth/login', '', 'POST', {
    email: 'owner@terra.example.test',
    password: 'Demo2026!',
  });
  const terra = terraLogin.headers.get('set-cookie')!.split(';')[0];
  await read(
    await s.call('/applications/app_terra_missing/documents/sample', terra, 'POST', {
      category: 'financials',
    }),
  );
  const incomplete = await read<ApplicationDetail>(
    await s.call('/applications/app_terra_missing', terra),
  );
  const supplemented = await read<ApplicationDetail>(
    await s.call('/applications/app_terra_missing/actions/supplement', terra, 'POST', {
      version: incomplete.application.version,
    }),
  );
  assert.equal(supplemented.application.status, 'submitted');
  assert.equal(
    (
      await s.call('/admin/products/working_capital/intake', admin, 'PATCH', {
        version: 1,
        paused: false,
        reason: 'Старый экран администратора',
      })
    ).status,
    409,
  );
  await read(
    await s.call('/admin/products/working_capital/intake', admin, 'PATCH', {
      version: 2,
      paused: false,
      reason: 'Проверка завершена, приём открыт',
    }),
  );
  const submitted = await read<ApplicationDetail>(
    await s.call('/applications/app_sever_working/actions/submit', client, 'POST', {
      version: after.application.version,
    }),
  );
  assert.equal(submitted.application.status, 'submitted');
  const audit = await s.db.query<{ action: string }>(
    "SELECT action FROM audit WHERE action IN ('intake_paused','intake_resumed')",
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ['intake_paused', 'intake_resumed'],
  );
});

test('intake gate is atomic even when an administrator pauses between request read and write', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const client = await s.login('client');
  const wrapper: Database = {
    query: s.db.query,
    run: s.db.run,
    batch: async (statements) => {
      if (statements[0]?.sql.startsWith('UPDATE applications'))
        await s.db.run(
          "UPDATE product_intake SET paused=1,reason='Пауза в момент отправки',version=version+1 WHERE product_id='working_capital'",
        );
      return s.db.batch(statements);
    },
  };
  const response = await createApp(wrapper).request(
    'http://localhost/api/applications/app_sever_working/actions/submit',
    {
      method: 'POST',
      headers: { cookie: client, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    },
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'INTAKE_PAUSED');
  const unchanged = (
    await s.db.query<{ status: string; version: number }>(
      "SELECT status,version FROM applications WHERE id='app_sever_working'",
    )
  )[0];
  assert.equal(unchanged.status, 'draft');
  assert.equal(unchanged.version, 1);
  assert.equal(
    (
      await s.db.query(
        "SELECT id FROM audit WHERE application_id='app_sever_working' AND action='submitted'",
      )
    ).length,
    0,
  );
});

test('admin intake edits reject malformed input, stale races and CSV formula payloads stay inert', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const admin = await s.login('admin');
  for (const body of [
    [],
    {},
    { ...pause, paused: 'true' },
    { ...pause, reason: 'x' },
    { ...pause, reason: 'x'.repeat(301) },
  ])
    assert.equal(
      (await s.call('/admin/products/working_capital/intake', admin, 'PATCH', body)).status,
      400,
    );
  const results = await Promise.all([
    s.call('/admin/products/working_capital/intake', admin, 'PATCH', pause),
    s.call('/admin/products/working_capital/intake', admin, 'PATCH', pause),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal((await s.db.query("SELECT id FROM audit WHERE action='intake_paused'")).length, 1);
  const user: User = {
    id: 'user_admin',
    email: 'admin@debitus.example.test',
    name: '=HYPERLINK("bad")',
    role: 'admin',
    organizationId: null,
  };
  await s.db.batch([auditStatement(user, null, 'platform_export', '=cmd|inert')]);
  const csv = await (await s.call('/admin/export?kind=audit&format=csv', admin)).text();
  assert.ok(csv.includes('"\'=HYPERLINK'));
  assert.ok(csv.includes('"\'=cmd|inert"'));
});

test('adding admin migration preserves existing users, sessions, preferences and foreign keys', async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'debitus-admin-migration-'));
  const db = openSqliteDatabase(':memory:');
  t.after(() => {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  copyFileSync('migrations/0001_initial.sql', path.join(folder, '0001_initial.sql'));
  db.migrate(folder);
  await db.batch([
    { sql: "INSERT INTO organizations VALUES('legacy-org','{}')" },
    {
      sql: "INSERT INTO users VALUES('legacy','old@example.test','Ранее созданный','client','legacy-org','hash','salt')",
    },
    { sql: "INSERT INTO sessions VALUES('unchanged-session','legacy','2030-01-01')" },
    { sql: `INSERT INTO preferences VALUES('legacy','{"theme":"dark","accent":"violet"}')` },
    {
      sql: "INSERT INTO integration_tokens VALUES('old-token','legacy','name','2026-01-01','2030-01-01',NULL)",
    },
    {
      sql: "INSERT INTO applications VALUES('old-app','legacy-org','draft',1,'{}','2026-01-01','2026-01-01')",
    },
    {
      sql: "INSERT INTO documents VALUES('old-doc','old-app','legacy-org','name','statement','text/plain',4,'sha','test',1,'2026-01-01')",
    },
    {
      sql: "INSERT INTO audit VALUES('old-audit','legacy-org','old-app','legacy','Ранее созданный','created','Сохранить историю','2026-01-01')",
    },
    {
      sql: "INSERT INTO import_previews VALUES('old-preview','legacy-org','legacy','{}','2030-01-01',NULL)",
    },
    { sql: "INSERT INTO action_receipts VALUES('old-app','sign','2026-01-01')" },
  ]);
  db.migrate('migrations');
  await initializeDatabase(db);
  await initializeDatabase(db);
  assert.equal(
    (await db.query("SELECT id FROM users WHERE id='user_admin' AND role='admin'")).length,
    1,
  );
  assert.equal((await db.query("SELECT id FROM sessions WHERE id='unchanged-session'")).length, 1);
  assert.equal(
    (await db.query("SELECT id FROM integration_tokens WHERE id='old-token'")).length,
    1,
  );
  for (const table of ['applications', 'documents', 'audit', 'import_previews', 'action_receipts'])
    assert.ok((await db.query(`SELECT * FROM ${table}`)).length > 0, table);
  assert.equal(
    (await db.query<{ content: string }>("SELECT content FROM documents WHERE id='old-doc'"))[0]
      .content,
    'test',
  );
  assert.deepEqual(await db.query('PRAGMA foreign_key_check'), []);
  const prefs = (
    await db.query<{ data: string }>("SELECT data FROM preferences WHERE user_id='legacy'")
  )[0];
  assert.equal(JSON.parse(prefs.data).accent, 'violet');
  await assert.rejects(db.run("INSERT INTO sessions VALUES('bad','not-a-user','2030-01-01')"));
});

test('products expose persisted intake status and red defaults preserve explicitly chosen accents', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const admin = await s.login('admin'),
    client = await s.login('client');
  assert.equal(
    (await read<{ accent: string }>(await s.call('/preferences', client))).accent,
    'red',
  );
  await read(await s.call('/preferences', client, 'PATCH', { accent: 'violet' }));
  assert.equal(
    (await read<{ accent: string }>(await s.call('/preferences', client))).accent,
    'violet',
  );
  await read(await s.call('/admin/products/working_capital/intake', admin, 'PATCH', pause));
  const products = await read<{ products: AdminProduct[] }>(await s.call('/products', client));
  assert.equal(
    products.products.find((product) => product.id === 'working_capital')?.intake.paused,
    true,
  );
  const all = await s.db.query<{ data: string }>('SELECT data FROM applications');
  assert.equal(
    all
      .map((row) => JSON.parse(row.data) as Application)
      .filter((application) => application.status === 'draft').length,
    1,
  );
});
