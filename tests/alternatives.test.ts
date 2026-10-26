import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFinancingAlternatives,
  getFinancingAlternatives,
} from '../server/alternatives.js';
import { assess, maximumPayment, newApplication, PRODUCTS } from '../server/domain.js';
import { DEMO_ORGANIZATIONS, initializeDatabase } from '../server/seed.js';
import { businessProfile } from '../shared/business-profile.js';
import type { AlternativesResponse } from '../shared/alternatives.js';
import type { Application, ApplicationInput, Organization } from '../shared/types.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';
import { createApp } from '../server/app.js';

const at = '2026-10-24T12:00:00.000Z';
const organization = DEMO_ORGANIZATIONS[0];
const documents = [{ category: 'statement' }, { category: 'financials' }];
const financials = {
  monthlyRevenue: 2400000,
  monthlyExpenses: 1650000,
  monthlyDebtPayment: 120000,
};
const input: ApplicationInput = {
  productId: 'working_capital',
  amount: 1200000,
  termMonths: 24,
  purpose: 'Материалы для производства',
  consent: true,
  financials,
};
const draft = (overrides: Partial<ApplicationInput> = {}, org = organization) =>
  newApplication({ ...input, ...overrides }, org, 'alternative-test', at);
const calculate = (
  application = draft(),
  org = organization,
  docs = documents,
  product = PRODUCTS[0],
) => calculateFinancingAlternatives(application, org, docs, product, at);

test('alternatives preserve purpose and exact shared rules, show distinct improvements and bounded search', () => {
  const result = calculate();
  assert.deepEqual(result, calculate());
  assert.equal(result.options.length, 2);
  assert.equal(
    new Set(
      result.options.map((item) => `${item.calculation.amount}:${item.calculation.termMonths}`),
    ).size,
    result.options.length,
  );
  for (const option of result.options) {
    assert.equal(option.draft.consent, false);
    assert.equal(option.draft.productId, input.productId);
    assert.equal(option.draft.purpose, input.purpose);
    assert.deepEqual(option.draft.financials, financials);
    assert.equal(option.maximumPayment, maximumPayment(option.calculation));
    assert.equal(
      option.calculation.totalRepayment,
      option.calculation.schedule.reduce((sum, row) => sum + row.payment, 0),
    );
    assert.deepEqual(
      option.assessment,
      assess(option.draft, organization, documents, 'alternatives-engine', at),
    );
    assert.notDeepEqual(
      [option.calculation.amount, option.calculation.termMonths],
      [input.amount, input.termMonths],
    );
    assert.ok(option.calculation.amount <= input.amount);
    assert.equal(
      option.deltas.maximumPayment,
      option.maximumPayment - result.baseline.maximumPayment,
    );
    assert.equal(
      option.deltas.totalInterest,
      option.calculation.totalInterest - result.baseline.calculation.totalInterest,
    );
  }
  assert.ok(
    result.options.find((item) => item.intent === 'lower_payment')!.deltas.maximumPayment < 0,
  );
  assert.ok(
    result.options.find((item) => item.intent === 'less_interest')!.deltas.totalInterest < 0,
  );
  assert.match(
    result.unavailable.find((item) => item.intent === 'closer_amount')!.reason,
    /уже укладывается/,
  );
  assert.equal(result.search.termsChecked, 31);
  assert.ok(result.search.evaluations <= 80);
});

test('alternatives respect minimum and maximum term and never invent an improvement at the boundary', () => {
  const short = calculate(draft({ termMonths: 6 }));
  assert.ok(short.unavailable.some((item) => item.intent === 'less_interest'));
  const long = calculate(draft({ termMonths: 36 }));
  assert.ok(long.unavailable.some((item) => item.intent === 'lower_payment'));
  for (const result of [short, long])
    for (const option of result.options)
      assert.ok(option.calculation.termMonths >= 6 && option.calculation.termMonths <= 36);
});

test('closest affordable amount is the last 1000 ruble step accepted by the canonical policy at the original term', () => {
  const application = draft({ amount: 10000000 });
  const result = calculate(application);
  const closest = result.options.find((item) => item.intent === 'closer_amount')!;
  assert.ok(closest);
  assert.equal(closest.calculation.termMonths, application.termMonths);
  assert.equal(closest.calculation.amount % 1000, 0);
  assert.ok(closest.calculation.amount >= PRODUCTS[0].minAmount);
  assert.ok(closest.calculation.amount < application.amount);
  assert.equal(closest.assessment.decision.outcome, 'approved');
  const next = assess(
    { ...closest.draft, amount: closest.calculation.amount + 1000 },
    organization,
    documents,
    'alternatives-engine',
    at,
  );
  assert.notEqual(next.decision.outcome, 'approved');
  assert.ok(result.search.evaluations <= 80);
});

test('zero cashflow and hard stop factors cannot be repaired by a longer term or a smaller amount', () => {
  const zero = calculate(
    draft({
      financials: { monthlyRevenue: 100000, monthlyExpenses: 100000, monthlyDebtPayment: 0 },
    }),
  );
  assert.deepEqual(zero.options, []);
  assert.ok(zero.blockers.length);
  for (const changes of [{ registered: false }, { overdueDays: 60 }, { monthsActive: 5 }]) {
    const result = calculate(draft(), { ...organization, ...changes });
    assert.deepEqual(result.options, []);
    assert.equal(result.baseline.assessment.decision.outcome, 'declined');
  }
});

test('missing documents, stale financials and intake pause remain visible for every numerical alternative', () => {
  const missing = calculate(draft(), organization, []);
  assert.ok(missing.options.length > 0);
  for (const option of missing.options) {
    assert.equal(option.assessment.decision.outcome, 'needs_info');
    assert.ok(option.blockers.some((item) => /Выписка/.test(item)));
    assert.ok(option.blockers.some((item) => /Баланс/.test(item)));
  }
  const stale: Organization = {
    ...organization,
    profile: { ...businessProfile(organization), financialsAsOf: '2026-01-01' },
  };
  for (const option of calculate(draft(), stale).options) {
    assert.equal(option.assessment.decision.outcome, 'needs_info');
    assert.ok(option.blockers.some((item) => /120 дней/.test(item)));
  }
  const paused = calculate(draft(), organization, documents, {
    ...PRODUCTS[0],
    intake: {
      productId: PRODUCTS[0].id,
      paused: true,
      reason: 'Пересмотр условий',
      version: 2,
      updatedAt: at,
      updatedBy: 'admin',
    },
  });
  assert.equal(paused.product.intakePaused, true);
  assert.ok(paused.blockers.some((item) => /Пересмотр условий/.test(item)));
  for (const option of paused.options)
    assert.ok(option.blockers.some((item) => /Пересмотр условий/.test(item)));
});

test('submitted variants use the fixed organization snapshot and keep the historical decision unchanged', () => {
  const snapshot = { ...organization, profile: { ...businessProfile(organization), version: 3 } };
  const application: Application = {
    ...draft(),
    status: 'submitted',
    submittedAt: at,
    organizationSnapshot: snapshot,
    organizationSnapshotMeta: { source: 'submission', capturedAt: at, profileVersion: 3 },
  };
  const original = structuredClone(application);
  const changed = {
    ...organization,
    overdueDays: 90,
    registered: false,
    profile: { ...businessProfile(organization), version: 9 },
  };
  const result = calculate(application, changed);
  assert.equal(result.source, 'submission_snapshot');
  assert.equal(result.profileVersion, 3);
  assert.equal(result.snapshotCapturedAt, at);
  assert.ok(result.options.length);
  assert.deepEqual(application, original);
  assert.throws(
    () => calculate({ ...application, organizationSnapshot: undefined }),
    /закреплённый снимок/,
  );
});

async function setup() {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
  const call = (
    path: string,
    cookie = '',
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
    extra: Record<string, string> = {},
  ) =>
    app.request(`http://localhost/api${path}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (email: string) => {
    const response = await call('/auth/login', '', { email, password: 'Demo2026!' });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const owner = await login('owner@sever.example.test');
  const terra = await login('owner@terra.example.test');
  const bank = await login('bank@debitus.example.test');
  const admin = await login('admin@debitus.example.test');
  const response = await call('/applications', owner, input);
  assert.equal(response.status, 201);
  const application = (await response.json()).application as Application;
  const snapshot = async () => {
    const names = ['applications', 'business_profiles', 'documents', 'audit', 'statement_reports'];
    return Promise.all(names.map((name) => db.query(`SELECT * FROM ${name} ORDER BY rowid`)));
  };
  return { db, app, call, owner, terra, bank, admin, application, snapshot };
}

test('alternatives HTTP is tenant scoped and read-only; bank cannot inspect a draft and admin cannot inspect a dossier', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const path = `/applications/${s.application.id}/alternatives`;
  assert.equal((await s.call(path)).status, 401);
  assert.equal((await s.call(path, s.terra)).status, 404);
  assert.equal((await s.call(path, s.bank)).status, 404);
  assert.equal((await s.call(path, s.admin)).status, 403);
  const before = await s.snapshot();
  const response = await s.call(
    `${path}?organizationId=org_terra&amount=1&termMonths=999`,
    s.owner,
  );
  assert.equal(response.status, 200);
  const result = (await response.json()) as AlternativesResponse;
  assert.equal(result.applicationId, s.application.id);
  assert.equal(result.baseline.calculation.amount, input.amount);
  assert.equal(result.profileVersion, 1);
  assert.deepEqual(await s.snapshot(), before);
  const user = {
    id: 'user_admin',
    name: 'admin',
    email: 'admin@example.test',
    role: 'admin' as const,
    organizationId: null,
  };
  await assert.rejects(getFinancingAlternatives(s.db, user, s.application.id), /доступа/);
});

test('bank and owner see the same submitted snapshot after the current profile changes', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  for (const category of ['statement', 'financials'])
    assert.equal(
      (await s.call(`/applications/${s.application.id}/documents/sample`, s.owner, { category }))
        .status,
      201,
    );
  const detail = await (await s.call(`/applications/${s.application.id}`, s.owner)).json();
  assert.equal(
    (
      await s.call(`/applications/${s.application.id}/actions/submit`, s.owner, {
        version: detail.application.version,
      })
    ).status,
    200,
  );
  await s.db.run(
    "UPDATE business_profiles SET data=json_set(data,'$.profile.version',7,'$.financials.monthlyRevenue',0) WHERE organization_id=?",
    ['org_sever'],
  );
  const before = await s.snapshot();
  const owner = (await (
    await s.call(`/applications/${s.application.id}/alternatives`, s.owner)
  ).json()) as AlternativesResponse;
  const bankResponse = await s.call(`/applications/${s.application.id}/alternatives`, s.bank);
  assert.equal(bankResponse.status, 200);
  const bank = (await bankResponse.json()) as AlternativesResponse;
  assert.equal(owner.source, 'submission_snapshot');
  assert.equal(bank.profileVersion, 1);
  assert.deepEqual(
    owner.options.map((item) => item.calculation),
    bank.options.map((item) => item.calculation),
  );
  assert.deepEqual(bank.financials, input.financials);
  assert.deepEqual(await s.snapshot(), before);
});

test('read token can read own alternatives, cannot write and is rejected immediately after revocation', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const response = await s.call('/integrations/tokens', s.owner, { name: 'Сравнение вариантов' });
  assert.equal(response.status, 201);
  const token = (await response.json()) as { id: string; token: string };
  const authorization = { authorization: `Bearer ${token.token}` };
  const path = `/applications/${s.application.id}/alternatives`;
  const before = await s.snapshot();
  assert.equal((await s.call(path, '', undefined, 'GET', authorization)).status, 200);
  assert.equal((await s.call(path, '', {}, 'POST', authorization)).status, 403);
  assert.deepEqual(await s.snapshot(), before);
  assert.equal(
    (await s.call(`/integrations/tokens/${token.id}`, s.owner, undefined, 'DELETE')).status,
    200,
  );
  assert.equal((await s.call(path, '', undefined, 'GET', authorization)).status, 401);
});
