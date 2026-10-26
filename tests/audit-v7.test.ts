import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';
import { initializeDatabase } from '../server/seed.js';
import { assess } from '../server/domain.js';
import { getApplication, getOrganization, saveApplication } from '../server/repository.js';
import type { ApplicationDetail, AuditRecord, User } from '../shared/types.js';

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
  const login = async (email: string) => {
    const response = await call('/auth/login', '', 'POST', { email, password: 'Demo2026!' });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  return { db, call, login };
}
async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body as T;
}

test('audit upgrade preserves old events without invented context and rejects mutation or replacement', async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'debitus-audit-upgrade-'));
  const db = openSqliteDatabase(':memory:');
  t.after(() => {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  for (const name of ['0001_initial.sql', '0002_administration.sql', '0003_business_profiles.sql'])
    copyFileSync(path.join('migrations', name), path.join(folder, name));
  db.migrate(folder);
  await initializeDatabase(db);
  const previous = (await db.query('SELECT * FROM audit ORDER BY id')).map((event) => ({
    ...event,
  }));
  assert.ok(previous.length > 0);
  db.migrate('migrations');
  db.migrate('migrations');
  const rows = await db.query<{ id: string; context: string | null }>(
    'SELECT * FROM audit ORDER BY id',
  );
  assert.deepEqual(
    rows.map(({ context, ...event }) => {
      assert.equal(context, null);
      return event;
    }),
    previous,
  );
  const eventId = rows[0].id;
  await assert.rejects(
    db.run('UPDATE audit SET detail=? WHERE id=?', ['Изменено', eventId]),
    /AUDIT_APPEND_ONLY/,
  );
  await assert.rejects(db.run('DELETE FROM audit WHERE id=?', [eventId]), /AUDIT_APPEND_ONLY/);
  await assert.rejects(
    db.run('INSERT OR REPLACE INTO audit SELECT * FROM audit WHERE id=?', [eventId]),
    /AUDIT_APPEND_ONLY/,
  );
  const [stored] = await db.query<{ rowid: number }>('SELECT rowid FROM audit WHERE id=?', [
    eventId,
  ]);
  await assert.rejects(
    db.run(
      `INSERT OR REPLACE INTO audit(rowid,id,actor_id,actor_name,action,detail,created_at) VALUES(?,'new-id','actor','Имя','created','Подмена','2026-10-23')`,
      [stored.rowid],
    ),
    /AUDIT_APPEND_ONLY/,
  );
  await db.run(
    `INSERT INTO audit(id,actor_id,actor_name,action,detail,created_at) VALUES('appended','actor','Имя','created','Новая запись','2026-10-23')`,
  );
  assert.equal((await db.query('SELECT id FROM audit')).length, previous.length + 1);
  assert.deepEqual(await db.query('PRAGMA foreign_key_check'), []);
});

test('bank history keeps exact saved assessment and input after supplementation replaces the current decision', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const client = await s.login('owner@sever.example.test');
  const bank = await s.login('bank@debitus.example.test');
  const id = 'app_sever_expansion';
  const initial = await read<ApplicationDetail>(await s.call(`/applications/${id}`, client));
  assert.ok(initial.timeline.every((event) => event.context === undefined));
  const reviewed = await read<ApplicationDetail>(
    await s.call(`/bank/applications/${id}/review`, bank, 'POST', {
      version: initial.application.version,
    }),
  );
  const reviewEvent = reviewed.timeline.find((event) => event.action === 'review_started')!;
  assert.deepEqual(reviewEvent.context?.assessment, {
    score: reviewed.application.score,
    decision: null,
    checks: reviewed.application.checks,
  });
  assert.equal(reviewEvent.context?.policyVersion, undefined);
  const decided = await read<ApplicationDetail>(
    await s.call(`/bank/applications/${id}/decision`, bank, 'POST', {
      version: reviewed.application.version,
      outcome: 'needs_info',
      requestedDocuments: ['financials'],
      reason: 'Уточните сезонную выручку в финансовых сведениях.',
    }),
  );
  const event = decided.timeline.find((item) => item.action === 'needs_info')!;
  const savedContext = structuredClone(event.context!);
  assert.equal(savedContext.applicationVersion, decided.application.version);
  assert.equal(
    savedContext.profileVersion,
    decided.application.organizationSnapshot?.profile?.version,
  );
  assert.equal(savedContext.scoringVersion, decided.application.score?.modelVersion);
  assert.equal(savedContext.policyVersion, decided.application.decision?.ruleVersion);
  assert.deepEqual(savedContext.input?.financials, decided.application.financials);
  assert.deepEqual(
    savedContext.input?.organizationSnapshot,
    decided.application.organizationSnapshot,
  );
  assert.equal(savedContext.input?.productSnapshot?.id, decided.application.productId);
  assert.deepEqual(savedContext.assessment, {
    score: decided.application.score,
    decision: decided.application.decision,
    checks: decided.application.checks,
  });
  const edited = await read<ApplicationDetail>(
    await s.call(`/applications/${id}`, client, 'PATCH', {
      ...decided.application,
      financials: { ...decided.application.financials, monthlyRevenue: 2600000 },
    }),
  );
  await read(await s.call(`/applications/${id}/documents/sample`, client, 'POST', { category: 'financials' }));
  const ready = await read<ApplicationDetail>(await s.call(`/applications/${id}`, client));
  assert.equal(ready.application.financials.monthlyRevenue, edited.application.financials.monthlyRevenue);
  const supplemented = await read<ApplicationDetail>(
    await s.call(`/applications/${id}/actions/supplement`, client, 'POST', {
      version: ready.application.version,
    }),
  );
  assert.equal(supplemented.application.status, 'submitted');
  assert.equal(supplemented.application.score, null);
  assert.equal(supplemented.application.decision, null);
  assert.deepEqual(
    supplemented.timeline.find((item) => item.id === event.id)?.context,
    savedContext,
  );
  const supplementEvent = supplemented.timeline.find((item) => item.action === 'supplemented')!;
  assert.equal(supplementEvent.context?.input?.financials.monthlyRevenue, 2600000);
  assert.equal(supplementEvent.context?.assessment, undefined);
  const bankCopy = await read<ApplicationDetail>(await s.call(`/applications/${id}`, bank));
  assert.deepEqual(bankCopy.timeline, supplemented.timeline);
});

test('audit contexts follow dossier access while platform audit and export expose versions only', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const client = await s.login('owner@sever.example.test');
  const bank = await s.login('bank@debitus.example.test');
  const other = await s.login('owner@terra.example.test');
  const admin = await s.login('admin@debitus.example.test');
  const reviewed = await read<ApplicationDetail>(
    await s.call('/bank/applications/app_sever_expansion/review', bank, 'POST', { version: 1 }),
  );
  const decided = await read<ApplicationDetail>(
    await s.call('/bank/applications/app_sever_expansion/decision', bank, 'POST', {
      version: reviewed.application.version,
    }),
  );
  const ownerEvents = await read<{ events: AuditRecord[] }>(await s.call('/audit', client));
  const decisionEvent = ownerEvents.events.find(
    (event) => event.action === decided.application.status,
  )!;
  assert.ok(decisionEvent.context?.input?.financials);
  assert.deepEqual(decisionEvent.context?.assessment?.decision, decided.application.decision);
  const otherEvents = await read<{ events: AuditRecord[] }>(await s.call('/audit', other));
  assert.equal(
    otherEvents.events.some((event) => event.applicationId === 'app_sever_expansion'),
    false,
  );
  assert.equal((await s.call('/applications/app_sever_expansion', other)).status, 404);
  assert.equal((await s.call('/applications/app_sever_expansion', admin)).status, 403);
  assert.equal((await s.call('/audit', admin)).status, 403);
  for (const route of ['/admin/audit', '/admin/export?kind=audit&format=json']) {
    const response = await read<{ events?: AuditRecord[]; rows?: AuditRecord[] }>(
      await s.call(route, admin),
    );
    const events = response.events ?? response.rows!;
    const platformEvent = events.find((event) => event.id === decisionEvent.id)!;
    assert.deepEqual(platformEvent.context, {
      schemaVersion: 1,
      applicationVersion: decided.application.version,
      profileVersion: decided.application.organizationSnapshot?.profile?.version,
      scoringVersion: decided.application.score?.modelVersion,
      policyVersion: decided.application.decision?.ruleVersion,
    });
    const serialized = JSON.stringify(response);
    for (const forbidden of [
      'financials',
      'monthlyRevenue',
      'assessment',
      'organizationSnapshot',
      'reasons',
      'paymentLimit',
      'productSnapshot',
    ])
      assert.equal(serialized.includes(forbidden), false, `${route}: ${forbidden}`);
  }
  for (const cookie of [other, bank, client])
    assert.equal((await s.call('/admin/audit', cookie)).status, 403);
});

test('application and audit context roll back together and stale saves append no event', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const user: User = {
    id: 'user_bank',
    name: 'Елена Орлова',
    email: 'bank@debitus.example.test',
    role: 'bank',
    organizationId: null,
  };
  const previous = await getApplication(s.db, 'app_sever_expansion', user);
  const evaluation = assess(
    previous,
    await getOrganization(s.db, previous.organizationId),
    [{ category: 'statement' }, { category: 'financials' }],
    user.id,
  );
  const next = {
    ...previous,
    score: evaluation.score,
    decision: evaluation.decision,
    checks: evaluation.checks,
    status: evaluation.decision.outcome,
  };
  const beforeEvents = await s.db.query('SELECT * FROM audit ORDER BY id');
  await assert.rejects(
    saveApplication(s.db, previous, { ...next }, user, next.status, 'Результат проверки', [
      { sql: 'INSERT INTO missing_audit_atomicity_table VALUES(1)' },
    ]),
  );
  assert.deepEqual(await getApplication(s.db, previous.id, user), previous);
  assert.deepEqual(await s.db.query('SELECT * FROM audit ORDER BY id'), beforeEvents);
  await saveApplication(s.db, previous, { ...next }, user, next.status, 'Результат проверки');
  const afterEvents = await s.db.query('SELECT * FROM audit ORDER BY id');
  await assert.rejects(
    saveApplication(s.db, previous, { ...next }, user, next.status, 'Повтор старого экрана'),
    /Заявка уже изменилась/,
  );
  assert.deepEqual(await s.db.query('SELECT * FROM audit ORDER BY id'), afterEvents);
});
