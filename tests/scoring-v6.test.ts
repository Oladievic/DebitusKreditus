import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';
import { initializeDatabase, DEMO_ORGANIZATIONS } from '../server/seed.js';
import { createApp } from '../server/app.js';
import { assess, calculateScenario, maximumPayment, newApplication } from '../server/domain.js';
import { businessProfile, documentGuidance } from '../shared/business-profile.js';
import { recommendProducts } from '../server/recommendations.js';
import { validateBusinessProfile } from '../server/profile.js';
import { getOrganization, insertApplicationStatement } from '../server/repository.js';
import type { ApplicationInput, BusinessProfileResponse } from '../shared/types.js';

const at = '2026-10-20T12:00:00.000Z';
const org = DEMO_ORGANIZATIONS[0];
const input: ApplicationInput = {
  productId: 'working_capital',
  amount: 1200000,
  termMonths: 24,
  purpose: 'Закупка материалов',
  consent: true,
  financials: {
    monthlyRevenue: org.monthlyRevenue,
    monthlyExpenses: org.monthlyExpenses,
    monthlyDebtPayment: org.monthlyDebtPayment,
  },
};
const docs = [{ category: 'statement' }, { category: 'financials' }];

test('same facts produce the same score and legal form changes documents rather than risk', () => {
  const p = businessProfile(org);
  const results = ['ip', 'ooo', 'ao', 'other'].map((legalForm) =>
    assess(
      input,
      { ...org, profile: { ...p, legalForm: legalForm as typeof p.legalForm } },
      docs,
      'test',
      at,
    ),
  );
  for (const result of results) assert.deepEqual(result.score, results[0].score);
  assert.deepEqual(results[1], assess(input, org, docs, 'test', at));
  assert.match(documentGuidance({ ...p, legalForm: 'ip', taxSystem: 'patent' })[1].title, /Книга/);
  assert.match(documentGuidance({ ...p, legalForm: 'ooo' })[1].title, /Баланс/);
  assert.ok(
    documentGuidance({ ...p, legalForm: 'ao' }).some(
      (d) => /акционер/.test(d.title) && !d.required,
    ),
  );
});

test('current migration preserves legacy records and first profile edit captures their context atomically', async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'debitus-profile-upgrade-'));
  const db = openSqliteDatabase(':memory:');
  t.after(() => {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  for (const name of ['0001_initial.sql', '0002_administration.sql'])
    copyFileSync(path.join('migrations', name), path.join(folder, name));
  db.migrate(folder);
  await initializeDatabase(db);
  await db.run(
    "UPDATE applications SET data=json_remove(data,'$.organizationSnapshot','$.organizationSnapshotMeta')",
  );
  const approved = newApplication(input, org, 'legacy-approved', at);
  const assessed = assess(input, org, docs, 'legacy-bank', at);
  Object.assign(approved, {
    status: 'approved',
    submittedAt: at,
    score: assessed.score,
    checks: assessed.checks,
    decision: assessed.decision,
  });
  await db.batch([insertApplicationStatement(approved)]);
  const legacyOrganization = (
    await db.query<{ data: string }>('SELECT data FROM organizations WHERE id=?', [org.id])
  )[0].data;
  const documentRows = await db.query('SELECT * FROM documents ORDER BY id');
  db.migrate('migrations');
  const app = createApp(db);
  const login = await app.request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@sever.example.test', password: 'Demo2026!' }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const read = async (route: string) =>
    (await app.request(`http://localhost/api${route}`, { headers: { cookie } })).json();
  const before = await read('/applications/app_sever_expansion');
  const profile = await read('/business-profile');
  const update = (version: number) =>
    app.request('http://localhost/api/business-profile', {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version,
        profile: { ...profile.profile, largestCustomerSharePct: 95, financialsAsOf: '2025-01-01' },
        financials: { ...input.financials, monthlyRevenue: 3000000 },
      }),
    });
  const updates = await Promise.all([update(1), update(1)]);
  assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409]);
  const after = await read('/applications/app_sever_expansion');
  assert.equal(after.application.status, before.application.status);
  assert.equal(after.application.version, before.application.version + 1);
  assert.deepEqual(after.application.financials, before.application.financials);
  assert.equal(after.assessment.score.value, before.assessment.score.value);
  assert.equal(after.assessment.decision.outcome, before.assessment.decision.outcome);
  assert.equal(after.application.organizationSnapshotMeta.source, 'legacy_recovery');
  assert.equal(after.application.organizationSnapshotMeta.profileVersion, 1);
  assert.equal(after.application.organizationSnapshot.profile.largestCustomerSharePct, 25);
  assert.deepEqual(
    (await read('/applications/legacy-approved')).application.decision,
    approved.decision,
  );
  const legacyEvent = (await read('/applications/legacy-approved')).timeline.find(
    (event: { action: string }) => event.action === 'legacy_context_captured',
  );
  assert.deepEqual(legacyEvent.context.assessment.decision, approved.decision);
  assert.deepEqual(legacyEvent.context.input.financials, approved.financials);
  assert.equal(legacyEvent.context.applicationVersion, approved.version + 1);
  assert.equal(legacyEvent.context.input.organizationSnapshotMeta.source, 'legacy_recovery');
  assert.equal(
    after.timeline.find((event: { action: string }) => event.action === 'legacy_context_captured')
      .context.policyVersion,
    undefined,
  );
  assert.equal(
    (await read('/applications/app_sever_working')).application.organizationSnapshot,
    undefined,
  );
  assert.equal(
    (await db.query<{ data: string }>('SELECT data FROM organizations WHERE id=?', [org.id]))[0]
      .data,
    legacyOrganization,
  );
  assert.deepEqual(await db.query('SELECT * FROM documents ORDER BY id'), documentRows);
  assert.equal(
    (
      await db.query<{ count: number }>(
        "SELECT COUNT(*) AS count FROM audit WHERE action='legacy_context_captured'",
      )
    )[0].count,
    2,
  );
  assert.equal((await update(2)).status, 200);
  const repeated = await read('/applications/app_sever_expansion');
  assert.equal(repeated.application.version, after.application.version);
  assert.deepEqual(
    repeated.application.organizationSnapshotMeta,
    after.application.organizationSnapshotMeta,
  );
  assert.deepEqual(await db.query('PRAGMA foreign_key_check'), []);
});

test('worsening overdue, margin, concentration or debt cannot improve score', () => {
  const base = assess(input, org, docs, 'test', at).score.value;
  for (const modified of [
    { organization: { ...org, overdueDays: 15 }, application: input },
    {
      organization: org,
      application: { ...input, financials: { ...input.financials, monthlyExpenses: 2200000 } },
    },
    {
      organization: { ...org, profile: { ...businessProfile(org), largestCustomerSharePct: 95 } },
      application: input,
    },
    {
      organization: org,
      application: { ...input, financials: { ...input.financials, monthlyDebtPayment: 400000 } },
    },
  ])
    assert.ok(
      assess(modified.application, modified.organization, docs, 'test', at).score.value <= base,
    );
  assert.equal(
    assess(input, { ...org, overdueDays: 60 }, docs, 'test', at).decision.outcome,
    'declined',
  );
  assert.equal(
    assess(input, { ...org, monthsActive: 5 }, docs, 'test', at).decision.outcome,
    'declined',
  );
});

test('counteroffer respects every rounded payment including the final one', () => {
  for (const termMonths of [6, 12, 24, 36]) {
    const assessed = assess({ ...input, amount: 10000000, termMonths }, org, docs, 'test', at);
    const offer = assessed.decision.offer;
    assert.ok(offer);
    const result = calculateScenario(
      offer.amount,
      offer.termMonths,
      offer.rateBps,
      input.financials,
      at.slice(0, 10),
    );
    assert.ok(maximumPayment(result) <= assessed.score.paymentLimit!);
  }
  assert.throws(() => calculateScenario(100000, 6, 0, input.financials, '2026-02-30'));
});

test('purpose, intake pause, stale information and seasonality affect recommendations transparently', () => {
  const p = businessProfile(org);
  const working = recommendProducts(
    { ...org, profile: { ...p, financingGoal: 'working_capital', preferredTermMonths: 24 } },
    undefined,
    at,
  );
  assert.equal(working.recommendations[0].product.id, 'working_capital');
  const equipment = recommendProducts(org, undefined, at);
  assert.equal(equipment.recommendations[0].product.id, 'equipment');
  assert.equal(equipment.market.keyRateAsOf, '2026-10-20');
  const smallNeed = recommendProducts(
    { ...org, profile: { ...p, requestedAmount: 100000 } },
    undefined,
    at,
  );
  assert.equal(
    smallNeed.recommendations.find((r) => r.product.id === 'equipment')!.eligible,
    false,
  );
  assert.notEqual(smallNeed.recommendations[0].product.id, 'equipment');
  const pausedProducts = working.recommendations.map(({ product }) => ({
    ...product,
    intake: {
      productId: product.id,
      paused: product.id === 'working_capital',
      reason: 'Пересмотр условий',
      version: 1,
      updatedAt: at,
      updatedBy: null,
    },
  }));
  const paused = recommendProducts(
    { ...org, profile: { ...p, financingGoal: 'working_capital' } },
    pausedProducts,
    at,
  );
  assert.notEqual(paused.recommendations[0].product.id, 'working_capital');
  assert.equal(
    paused.recommendations.find((r) => r.product.id === 'working_capital')!.eligible,
    false,
  );
  const staleOrg = { ...org, profile: { ...p, financialsAsOf: '2026-01-01' } };
  assert.ok(recommendProducts(staleOrg, undefined, at).recommendations.every((r) => !r.eligible));
  assert.equal(assess(input, staleOrg, docs, 'test', at).decision.outcome, 'needs_info');
  const stressed = recommendProducts(
    { ...org, profile: { ...p, lowSeasonRevenueDropPct: 80 } },
    undefined,
    at,
  );
  assert.ok(
    stressed.recommendations.every(
      (r) => r.stressRemainingCash! < 0 && r.cautions.some((s) => s.includes('80%')),
    ),
  );
});

test('profile rejects illegal combinations, future or impossible dates and noninteger money', () => {
  const p = businessProfile(org);
  for (const changed of [
    { legalForm: 'ooo', taxSystem: 'patent' },
    { legalForm: 'ao', taxSystem: 'npd' },
    { financialsAsOf: '2026-02-30' },
    { financialsAsOf: '2026-10-21' },
    { requestedAmount: 100000.1 },
    { lowSeasonRevenueDropPct: -1 },
    { largestCustomerSharePct: 101 },
  ])
    assert.throws(() => validateBusinessProfile({ ...p, ...changed }, p, at));
  assert.equal(
    validateBusinessProfile({ ...p, legalForm: 'ip', taxSystem: 'patent' }, p, at).version,
    2,
  );
});

test('profile API isolates organizations, rejects stale writes and preserves submitted snapshot', async (t) => {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  t.after(() => db.close());
  const app = createApp(db);
  const request = (path: string, cookie = '', method = 'GET', body?: unknown) =>
    app.request(`http://localhost/api${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const login = async (email: string) =>
    (await request('/auth/login', '', 'POST', { email, password: 'Demo2026!' })).headers
      .get('set-cookie')!
      .split(';')[0];
  const client = await login('owner@sever.example.test');
  const other = await login('owner@terra.example.test');
  const bank = await login('bank@debitus.example.test');
  assert.equal((await request('/business-profile')).status, 401);
  assert.equal((await request('/business-profile', bank)).status, 403);
  const current: BusinessProfileResponse = await (
    await request('/business-profile', client)
  ).json();
  const submission = await request(
    '/applications/app_sever_working/actions/submit',
    client,
    'POST',
    { version: 1 },
  );
  assert.equal(submission.status, 200);
  const submitted = (await submission.json()).application;
  assert.equal(submitted.organizationSnapshot.profile.version, 1);
  const body = {
    organizationId: 'org_terra',
    version: 1,
    profile: { ...current.profile, cashReserve: 9876543 },
    financials: { ...input.financials, monthlyRevenue: 3000000 },
  };
  const updates = await Promise.all([
    request('/business-profile', client, 'PUT', body),
    request('/business-profile', client, 'PUT', body),
  ]);
  assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409]);
  const saved = await getOrganization(db, org.id);
  assert.equal(saved.profile!.version, 2);
  assert.equal(saved.monthlyRevenue, 3000000);
  const otherProfile: BusinessProfileResponse = await (
    await request('/business-profile', other)
  ).json();
  assert.equal(otherProfile.organization.id, 'org_terra');
  assert.equal(otherProfile.profile.version, 1);
  const audit = await db.query<{ count: number }>(
    "SELECT COUNT(*) AS count FROM audit WHERE action='business_profile_updated'",
  );
  assert.equal(audit[0].count, 1);
  const unchanged = (await (await request('/applications/app_sever_working', client)).json())
    .application;
  assert.deepEqual(unchanged.organizationSnapshot, submitted.organizationSnapshot);
  assert.deepEqual(
    assess(submitted, saved, docs, 'test', at).score,
    assess(submitted, submitted.organizationSnapshot, docs, 'test', at).score,
  );
});
