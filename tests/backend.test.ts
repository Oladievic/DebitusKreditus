import test from 'node:test';
import assert from 'node:assert/strict';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';
import { initializeDatabase, DEMO_ORGANIZATIONS, DEMO_ACCOUNTS } from '../server/seed.js';
import { createApp } from '../server/app.js';
import {
  assess,
  calculateBudgetScenario,
  calculateScenario,
  newApplication,
  PRODUCTS,
  validateInput,
} from '../server/domain.js';
import { insertApplicationStatement, saveApplication } from '../server/repository.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Application, ApplicationDetail, ApplicationInput, User } from '../shared/types.js';

async function setup() {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
  const call = (
    path: string,
    method = 'GET',
    body?: unknown,
    cookie?: string,
    headers: Record<string, string> = {},
  ) =>
    app.request(`http://localhost/api${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
    });
  const login = async (company = 'sever') => {
    const email =
      company === 'bank' ? 'bank@debitus.example.test' : `owner@${company}.example.test`;
    const response = await call('/auth/login', 'POST', { email, password: 'Demo2026!' });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  return { db, app, call, login };
}
const sample: ApplicationInput = {
  productId: 'working_capital',
  amount: 1200000,
  termMonths: 24,
  purpose: 'Закупка материалов',
  financials: { monthlyRevenue: 2400000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
  consent: true,
};
const read = async <T>(response: Response) => {
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body as T;
};

test('BigInt schedule is deterministic, closes principal and preserves totals', () => {
  const a = calculateScenario(1200000, 24, 2450, sample.financials);
  const b = calculateScenario(1200000, 24, 2450, sample.financials);
  assert.deepEqual(a, b);
  assert.equal(
    a.schedule.reduce((s, r) => s + r.principal, 0),
    1200000,
  );
  assert.equal(a.schedule.at(-1)!.balance, 0);
  assert.equal(
    a.totalRepayment,
    a.schedule.reduce((s, r) => s + r.payment, 0),
  );
  assert.equal(a.totalInterest, a.totalRepayment - 1200000);
  assert.ok(a.schedule.every((r) => Number.isSafeInteger(r.payment)));
  const zero = calculateScenario(100001, 7, 0, sample.financials, '2024-01-31');
  assert.equal(zero.totalInterest, 0);
  assert.equal(zero.schedule[0].dueDate, '2024-02-29');
  assert.equal(zero.schedule[1].dueDate, '2024-03-31');
  assert.throws(() => calculateScenario(Number.NaN, 12, 2450, sample.financials));
  assert.throws(() => validateInput({ ...sample, amount: 100000.01 }));
});

test('reverse annuity selects the largest whole-thousand amount whose every payment fits', () => {
  for (const product of PRODUCTS)
    for (const termMonths of [product.minTerm, product.maxTerm]) {
      for (const comfortablePayment of [7500, 30000, 100000, 500000, 1000000]) {
        const input = {
          productId: product.id,
          termMonths,
          comfortablePayment,
          monthlyReserve: 1000000,
          financials: {
            monthlyRevenue: 9000000,
            monthlyExpenses: 2000000,
            monthlyDebtPayment: 500000,
          },
        };
        const result = calculateBudgetScenario(input);
        assert.deepEqual(result, calculateBudgetScenario(input));
        assert.equal(result.effectivePaymentLimit, comfortablePayment);
        if (!result.suggestion) {
          assert.ok(result.minimumProductPayment > result.effectivePaymentLimit);
          continue;
        }
        const suggestion = result.suggestion;
        assert.equal(suggestion.amount % 1000, 0);
        assert.ok(suggestion.amount >= product.minAmount && suggestion.amount <= product.maxAmount);
        assert.ok(suggestion.schedule.every((row) => row.payment <= comfortablePayment));
        assert.ok(result.minimumRemainingCash >= input.monthlyReserve);
        assert.equal(suggestion.schedule.at(-1)!.balance, 0);
        if (suggestion.amount < product.maxAmount) {
          const next = calculateScenario(
            suggestion.amount + 1000,
            termMonths,
            product.rateBps,
            input.financials,
          );
          assert.ok(next.schedule.some((row) => row.payment > comfortablePayment));
        }
      }
    }
});

test('comfortable payment respects reserve, policy and product caps and rejects malformed money', () => {
  const input = {
    productId: 'working_capital',
    termMonths: 24,
    comfortablePayment: 500000,
    monthlyReserve: 500000,
    financials: sample.financials,
  };
  const reserve = calculateBudgetScenario(input);
  assert.equal(reserve.availableCash, 630000);
  assert.equal(reserve.effectivePaymentLimit, 130000);
  assert.deepEqual(reserve.bindingLimits, ['monthly_reserve']);
  assert.ok(reserve.minimumRemainingCash >= 500000);
  const policy = calculateBudgetScenario({ ...input, monthlyReserve: 0 });
  assert.equal(policy.effectivePaymentLimit, 409500);
  assert.ok(policy.bindingLimits.includes('policy'));
  assert.equal(calculateBudgetScenario({ ...input, monthlyReserve: 630000 }).suggestion, null);
  assert.equal(calculateBudgetScenario({ ...input, comfortablePayment: 0 }).suggestion, null);
  const negative = calculateBudgetScenario({
    ...input,
    financials: { ...sample.financials, monthlyRevenue: 100000 },
  });
  assert.equal(negative.suggestion, null);
  assert.equal(negative.effectivePaymentLimit, 0);
  const maximum = calculateBudgetScenario({
    ...input,
    comfortablePayment: 1000000000,
    monthlyReserve: 0,
    financials: { monthlyRevenue: 1000000000, monthlyExpenses: 0, monthlyDebtPayment: 0 },
  });
  assert.equal(maximum.suggestion!.amount, 10000000);
  assert.ok(maximum.bindingLimits.includes('product_maximum'));
  for (const invalid of [
    null,
    { ...input, comfortablePayment: 1.5 },
    { ...input, monthlyReserve: -1 },
    { ...input, termMonths: 60 },
    { ...input, financials: {} },
    { ...input, comfortablePayment: 1000000001 },
  ]) {
    assert.throws(() => calculateBudgetScenario(invalid));
  }
});

test('budget scenario API requires a session, returns the exact domain result and creates no application', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const body = {
    productId: 'equipment',
    termMonths: 36,
    comfortablePayment: 120000,
    monthlyReserve: 300000,
    financials: sample.financials,
  };
  assert.equal((await s.call('/scenario/affordability', 'POST', body)).status, 401);
  const cookie = await s.login();
  const before = await s.db.query('SELECT id FROM applications');
  const response = await read(await s.call('/scenario/affordability', 'POST', body, cookie));
  assert.deepEqual(response, calculateBudgetScenario(body));
  assert.deepEqual(await s.db.query('SELECT id FROM applications'), before);
  assert.equal(
    (await s.call('/scenario/affordability', 'POST', { ...body, monthlyReserve: '1000' }, cookie))
      .status,
    400,
  );
});

test('credit policy produces four outcomes separately from score', () => {
  const docs = [{ category: 'statement' }, { category: 'financials' }];
  const at = '2026-10-19T09:00:00Z';
  const approved = assess(sample, DEMO_ORGANIZATIONS[0], docs, 'test', at);
  assert.equal(approved.decision.outcome, 'approved');
  assert.deepEqual(approved, assess(sample, DEMO_ORGANIZATIONS[0], docs, 'test', at));
  const counter = assess(
    { ...sample, amount: 8000000, termMonths: 12 },
    DEMO_ORGANIZATIONS[0],
    docs,
    'test',
    at,
  );
  assert.equal(counter.decision.outcome, 'counter_offer');
  assert.ok(counter.decision.offer!.amount < 8000000);
  const missing = assess(sample, DEMO_ORGANIZATIONS[0], [], 'test', at);
  assert.equal(missing.decision.outcome, 'needs_info');
  assert.equal(missing.score.value, approved.score.value);
  const rejected = assess(sample, DEMO_ORGANIZATIONS[2], docs, 'test', at);
  assert.equal(rejected.decision.outcome, 'declined');
  assert.match(rejected.decision.reasons[0], /Просрочка/);
});

test('tenant boundaries cover detail, document, search, export, audit and bank operations', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cookie = await s.login('terra');
  assert.equal(
    (await s.call('/applications/app_sever_working', 'GET', undefined, cookie)).status,
    404,
  );
  assert.equal(
    (await s.call('/documents/doc_app_sever_working_statement/download', 'GET', undefined, cookie))
      .status,
    404,
  );
  assert.equal((await s.call('/bank/queue', 'GET', undefined, cookie)).status, 403);
  assert.equal(
    (await s.call('/bank/applications/app_terra_missing/decision', 'POST', { version: 1 }, cookie))
      .status,
    403,
  );
  const apps = await read<{ applications: Application[] }>(
    await s.call('/applications', 'GET', undefined, cookie),
  );
  assert.ok(apps.applications.every((a) => a.organizationId === 'org_terra'));
  const search = await read<{ results: unknown[] }>(
    await s.call('/search?q=' + encodeURIComponent('Северная'), 'GET', undefined, cookie),
  );
  assert.equal(search.results.length, 0);
  const exp = await read<{ applications: Application[] }>(
    await s.call('/export?format=json', 'GET', undefined, cookie),
  );
  assert.ok(exp.applications.every((a) => a.organizationId === 'org_terra'));
  const audit = await read<{ events: { organizationId: string }[] }>(
    await s.call('/audit', 'GET', undefined, cookie),
  );
  assert.ok(audit.events.every((a) => a.organizationId === 'org_terra'));
});

test('drafts and their documents stay private until the client submits them', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const client = await s.login(),
    bank = await s.login('bank');
  const created = await read<{ application: Application }>(
    await s.call(
      '/applications',
      'POST',
      { ...sample, purpose: 'ЗакрытыйЧерновикБраузера' },
      client,
    ),
  );
  const id = created.application.id;
  const doc = await read<{ document: { id: string } }>(
    await s.call(`/applications/${id}/documents/sample`, 'POST', { category: 'statement' }, client),
  );
  for (const draft of ['app_sever_working', id])
    assert.equal((await s.call(`/applications/${draft}`, 'GET', undefined, bank)).status, 404);
  assert.equal(
    (await s.call(`/documents/${doc.document.id}/download`, 'GET', undefined, bank)).status,
    404,
  );
  assert.equal(
    (await s.call(`/bank/applications/${id}/review`, 'POST', { version: 2 }, bank)).status,
    404,
  );
  for (const endpoint of ['/applications', '/bank/queue', '/dashboard']) {
    const data = await read<{ applications: Application[] }>(
      await s.call(endpoint, 'GET', undefined, bank),
    );
    assert.ok(data.applications.every((a) => a.status !== 'draft'));
  }
  const docs = await read<{ documents: { applicationId: string }[] }>(
    await s.call('/documents', 'GET', undefined, bank),
  );
  assert.ok(docs.documents.every((d) => ![id, 'app_sever_working'].includes(d.applicationId)));
  const search = await read<{ results: unknown[] }>(
    await s.call(
      '/search?q=' + encodeURIComponent('ЗакрытыйЧерновикБраузера'),
      'GET',
      undefined,
      bank,
    ),
  );
  assert.deepEqual(search.results, []);
  const audit = await read<{ events: { applicationId: string }[] }>(
    await s.call('/audit', 'GET', undefined, bank),
  );
  assert.ok(audit.events.every((e) => ![id, 'app_sever_working'].includes(e.applicationId)));
  assert.equal((await s.call('/export?format=json', 'GET', undefined, bank)).status, 403);
  assert.equal((await s.call(`/applications/${id}`, 'GET', undefined, client)).status, 200);
  await read(await s.call(`/applications/${id}/actions/submit`, 'POST', { version: 2 }, client));
  assert.equal((await s.call(`/applications/${id}`, 'GET', undefined, bank)).status, 200);
  assert.equal(
    (await s.call(`/documents/${doc.document.id}/download`, 'GET', undefined, bank)).status,
    200,
  );
});

test('full approval → acceptance → simulated signature → funding is persisted and idempotent', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const client = await s.login(),
    bank = await s.login('bank');
  const id = 'app_sever_working';
  assert.equal(
    (
      await s.call(
        `/applications/${id}/actions/sign`,
        'POST',
        { version: 1, confirmed: true },
        client,
      )
    ).status,
    409,
  );
  let d = await read<ApplicationDetail>(
    await s.call(`/applications/${id}/actions/submit`, 'POST', { version: 1 }, client),
  );
  assert.equal(d.application.status, 'submitted');
  assert.equal(
    (
      await s.call(
        `/applications/${id}`,
        'PATCH',
        { version: 2, purpose: 'Нельзя менять после отправки' },
        client,
      )
    ).status,
    409,
  );
  d = await read<ApplicationDetail>(
    await s.call(
      `/bank/applications/${id}/review`,
      'POST',
      { version: d.application.version },
      bank,
    ),
  );
  assert.equal(d.application.status, 'in_review');
  d = await read<ApplicationDetail>(
    await s.call(
      `/bank/applications/${id}/decision`,
      'POST',
      { version: d.application.version, reason: 'Комплект проверен, параметры подтверждены.' },
      bank,
    ),
  );
  assert.equal(d.application.status, 'approved');
  assert.ok(d.application.decision!.reasons.some((r) => r.includes('Комплект проверен')));
  d = await read<ApplicationDetail>(
    await s.call(
      `/applications/${id}/actions/accept-offer`,
      'POST',
      { version: d.application.version },
      client,
    ),
  );
  assert.ok(d.documents.some((x) => x.category === 'contract'));
  assert.equal(
    (
      await s.call(
        `/applications/${id}/actions/sign`,
        'POST',
        { version: d.application.version },
        client,
      )
    ).status,
    400,
  );
  const signVersion = d.application.version;
  d = await read<ApplicationDetail>(
    await s.call(
      `/applications/${id}/actions/sign`,
      'POST',
      { version: signVersion, confirmed: true },
      client,
    ),
  );
  const repeated = await read<ApplicationDetail>(
    await s.call(
      `/applications/${id}/actions/sign`,
      'POST',
      { version: signVersion, confirmed: true },
      client,
    ),
  );
  assert.equal(repeated.application.version, d.application.version);
  const fundVersion = d.application.version;
  d = await read<ApplicationDetail>(
    await s.call(
      `/applications/${id}/actions/fund`,
      'POST',
      { version: fundVersion, confirmed: true },
      client,
    ),
  );
  assert.equal(d.application.status, 'funded');
  const funded = await read<ApplicationDetail>(
    await s.call(
      `/applications/${id}/actions/fund`,
      'POST',
      { version: fundVersion, confirmed: true },
      client,
    ),
  );
  assert.equal(funded.application.version, d.application.version);
  const receipts = await s.db.query<{ action: string }>(
    'SELECT action FROM action_receipts WHERE application_id=?',
    [id],
  );
  assert.deepEqual(receipts.map((r) => r.action).sort(), ['fund', 'sign']);
  assert.equal(funded.timeline.filter((e) => e.action === 'funded').length, 1);
  const freshApp = createApp(s.db);
  const persisted = await freshApp.request(`/api/applications/${id}`, {
    headers: { cookie: client },
  });
  assert.equal((await persisted.json()).application.status, 'funded');
});

test('document supplement preserves the application and returns to review', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cookie = await s.login('terra');
  const id = 'app_terra_missing';
  assert.equal(
    (await s.call(`/applications/${id}/actions/supplement`, 'POST', { version: 1 }, cookie)).status,
    400,
  );
  const document = await read<{ document: { id: string } }>(
    await s.call(
      `/applications/${id}/documents/sample`,
      'POST',
      { category: 'financials' },
      cookie,
    ),
  );
  const download = await s.call(
    `/documents/${document.document.id}/download`,
    'GET',
    undefined,
    cookie,
  );
  assert.equal(download.status, 200);
  assert.match(await download.text(), /СИНТЕТИЧЕСКИЙ/);
  const d = await read<ApplicationDetail>(
    await s.call(`/applications/${id}`, 'GET', undefined, cookie),
  );
  assert.equal(d.application.version, 2);
  const result = await read<ApplicationDetail>(
    await s.call(`/applications/${id}/actions/supplement`, 'POST', { version: 2 }, cookie),
  );
  assert.equal(result.application.status, 'submitted');
  assert.equal(result.application.decision, null);
});

test('optimistic race produces one update, one audit and no orphan side effects', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cookie = await s.login();
  const id = 'app_sever_working';
  const before = await s.db.query<{ n: number }>(
    'SELECT count(*) AS n FROM audit WHERE application_id=?',
    [id],
  );
  const results = await Promise.all([
    s.call(`/applications/${id}`, 'PATCH', { version: 1, purpose: 'Первое обновление' }, cookie),
    s.call(`/applications/${id}`, 'PATCH', { version: 1, purpose: 'Второе обновление' }, cookie),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const after = await s.db.query<{ n: number }>(
    'SELECT count(*) AS n FROM audit WHERE application_id=?',
    [id],
  );
  assert.equal(after[0].n - before[0].n, 1);
  const stale = newApplication(sample, DEMO_ORGANIZATIONS[0], id);
  const actor: User = {
    id: 'user_sever',
    email: '',
    name: 'Test',
    role: 'client',
    organizationId: 'org_sever',
  };
  await assert.rejects(
    saveApplication(s.db, stale, { ...stale, status: 'signed' }, actor, 'signed', 'stale', [
      {
        sql: 'INSERT INTO action_receipts(application_id,action,created_at) SELECT ?,?,? WHERE changes()=1',
        params: [id, 'sign', '2026-10-19'],
      },
    ]),
  );
  assert.equal(
    (await s.db.query('SELECT * FROM action_receipts WHERE application_id=?', [id])).length,
    0,
  );
});

test('imports are previewed, organization-bound and idempotent', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const owner = await s.login(),
    stranger = await s.login('terra');
  const preview = await read<{ previewId: string; valid: boolean }>(
    await s.call(
      '/import/validate',
      'POST',
      { applications: [sample, { ...sample, purpose: 'Второй черновик' }] },
      owner,
    ),
  );
  assert.equal(preview.valid, true);
  assert.equal(
    (await s.call('/import/apply', 'POST', { previewId: preview.previewId }, stranger)).status,
    404,
  );
  const first = await read<{ applications: Application[]; alreadyApplied: boolean }>(
    await s.call('/import/apply', 'POST', { previewId: preview.previewId }, owner),
  );
  assert.equal(first.applications.length, 2);
  assert.equal(first.alreadyApplied, false);
  const second = await read<{ applications: Application[]; alreadyApplied: boolean }>(
    await s.call('/import/apply', 'POST', { previewId: preview.previewId }, owner),
  );
  assert.equal(second.alreadyApplied, true);
  assert.deepEqual(
    second.applications.map((a) => a.id).sort(),
    first.applications.map((a) => a.id).sort(),
  );
  const invalid = await read<{ valid: boolean; errors: unknown[] }>(
    await s.call('/import/validate', 'POST', { applications: [{ ...sample, amount: -1 }] }, owner),
  );
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.length, 1);
});

test('injection inputs stay data; CSRF and unsafe upload are rejected', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cookie = await s.login();
  assert.equal(
    (await s.call('/auth/login', 'POST', { email: "' OR 1=1 --", password: 'bad' })).status,
    401,
  );
  assert.equal(
    (await s.call('/applications', 'POST', sample, cookie, { origin: 'https://attacker.example' }))
      .status,
    403,
  );
  const created = await read<{ application: Application }>(
    await s.call(
      '/applications',
      'POST',
      { ...sample, purpose: '=HYPERLINK("https://example.test")' },
      cookie,
    ),
  );
  const csv = await s.call('/export?format=csv', 'GET', undefined, cookie);
  assert.match(await csv.text(), /"'=HYPERLINK/);
  const form = new FormData();
  form.append('category', 'statement');
  form.append(
    'file',
    new File(['<script>alert(1)</script>'], 'fake.pdf', { type: 'application/pdf' }),
  );
  assert.equal(
    (await s.call(`/applications/${created.application.id}/documents`, 'POST', form, cookie))
      .status,
    400,
  );
  const valid = new FormData();
  valid.append('category', 'statement');
  valid.append('file', new File(['Пример данных'], 'statement.txt', { type: 'text/plain' }));
  assert.equal(
    (await s.call(`/applications/${created.application.id}/documents`, 'POST', valid, cookie))
      .status,
    201,
  );
  assert.equal((await s.db.query('SELECT * FROM users')).length, DEMO_ACCOUNTS.length);
});

test('development proxy uses an explicit origin allowlist without trusting forwarded headers', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const dev = createApp(s.db, { allowedOrigins: ['http://127.0.0.1:5273'] });
  const request = (origin: string, forwarded?: string) =>
    dev.request('http://127.0.0.1:8887/api/auth/login', {
      method: 'POST',
      headers: {
        origin,
        'Content-Type': 'application/json',
        ...(forwarded ? { 'x-forwarded-host': forwarded } : {}),
      },
      body: JSON.stringify({ email: 'owner@sever.example.test', password: 'Demo2026!' }),
    });
  assert.equal((await request('http://127.0.0.1:5273')).status, 200);
  assert.equal((await request('https://attacker.example', 'attacker.example')).status, 403);
  assert.equal((await request('http://127.0.0.1:5273.evil.example')).status, 403);
});

test('integration token cannot mutate or cross tenant and revokes immediately', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cookie = await s.login();
  const token = await read<{ token: string; id: string }>(
    await s.call('/integrations/tokens', 'POST', { name: 'Тестовый агент' }, cookie),
  );
  const auth = { authorization: `Bearer ${token.token}` };
  assert.equal((await s.call('/applications', 'GET', undefined, undefined, auth)).status, 200);
  assert.equal(
    (await s.call('/applications/app_terra_missing', 'GET', undefined, undefined, auth)).status,
    404,
  );
  assert.equal((await s.call('/applications', 'POST', sample, undefined, auth)).status, 403);
  assert.equal((await s.call('/scenario', 'POST', sample, undefined, auth)).status, 200);
  const rpc = await read<{ result: { tools: unknown[] } }>(
    await s.call('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, undefined, auth),
  );
  assert.equal(rpc.result.tools.length, 11);
  await s.call(`/integrations/tokens/${token.id}`, 'DELETE', undefined, cookie);
  assert.equal((await s.call('/applications', 'GET', undefined, undefined, auth)).status, 401);
});

test('preferences personalize feed and remain per user', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cookie = await s.login('terra'),
    other = await s.login('sever');
  const initial = await read<{ items: { id: string }[] }>(
    await s.call('/feed', 'GET', undefined, cookie),
  );
  assert.ok(initial.items.some((i) => i.id === 'cash-buffer'));
  await s.call('/preferences', 'PATCH', { interests: [], theme: 'dark' }, cookie);
  const changed = await read<{ items: { id: string }[] }>(
    await s.call('/feed', 'GET', undefined, cookie),
  );
  assert.ok(!changed.items.some((i) => i.id === 'cash-buffer'));
  assert.ok(changed.items.some((i) => i.id === 'seasonal-guide'));
  await s.call('/preferences', 'PATCH', { interests: ['risk'], widgets: ['simulator'] }, cookie);
  const risks = await read<{ items: { id: string }[] }>(
    await s.call('/feed', 'GET', undefined, cookie),
  );
  assert.ok(risks.items.some((i) => i.id === 'risk-checklist'));
  const otherPrefs = await read<{ theme: string }>(
    await s.call('/preferences', 'GET', undefined, other),
  );
  assert.equal(otherPrefs.theme, 'light');
});

test('a delayed preferences write cannot change a different signed-in user', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cookie = await s.login('terra');
  assert.equal(
    (await s.call('/preferences', 'PATCH', { expectedUserId: 'user_sever', theme: 'dark' }, cookie))
      .status,
    403,
  );
  const unchanged = await read<{ theme: string }>(
    await s.call('/preferences', 'GET', undefined, cookie),
  );
  assert.equal(unchanged.theme, 'light');
  const saved = await read<{ theme: string }>(
    await s.call('/preferences', 'PATCH', { expectedUserId: 'user_terra', theme: 'dark' }, cookie),
  );
  assert.equal(saved.theme, 'dark');
});

test('bank feed contains only actions available to a bank employee', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cookie = await s.login('bank');
  const data = await read<{ items: { href: string; actionLabel: string }[] }>(
    await s.call('/feed', 'GET', undefined, cookie),
  );
  assert.ok(data.items.length >= 2);
  assert.ok(data.items.every((item) => !['/simulator', '/applications/new'].includes(item.href)));
  assert.ok(data.items.every((item) => item.actionLabel !== 'Дополнить заявку'));
  for (const item of data.items.filter((item) => item.href.startsWith('/applications/')))
    assert.equal((await s.call(item.href, 'GET', undefined, cookie)).status, 200);
});

test('bank notifications contain only applications waiting for bank action', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cookie = await s.login('bank');
  const first = await read<{ actions: { title: string; href: string }[] }>(
    await s.call('/dashboard', 'GET', undefined, cookie),
  );
  assert.deepEqual(first.actions.map((action) => action.href).sort(), [
    '/applications/app_sever_expansion',
    '/applications/app_vector_review',
  ]);
  assert.ok(first.actions.every((action) => action.title === 'Проверьте новую заявку'));
  const application = await read<ApplicationDetail>(
    await s.call('/applications/app_sever_expansion', 'GET', undefined, cookie),
  );
  await read<ApplicationDetail>(
    await s.call(
      '/bank/applications/app_sever_expansion/review',
      'POST',
      {
        version: application.application.version,
      },
      cookie,
    ),
  );
  const reviewed = await read<{ actions: { title: string; href: string }[] }>(
    await s.call('/dashboard', 'GET', undefined, cookie),
  );
  assert.equal(
    reviewed.actions.find((action) => action.href.endsWith('app_sever_expansion'))?.title,
    'Примите решение по заявке',
  );
});

test('Russian document categories are searchable without leaking other organizations', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const sever = await s.login(),
    terra = await s.login('terra');
  const search = async (query: string, cookie: string) =>
    read<{ results: { id: string; type: string }[] }>(
      await s.call('/search?q=' + encodeURIComponent(query), 'GET', undefined, cookie),
    );
  const statements = await search('выписка', sever);
  assert.ok(statements.results.some((r) => r.id === 'doc_app_sever_working_statement'));
  const financials = await search('отчетность', sever);
  assert.ok(financials.results.some((r) => r.type === 'document'));
  assert.deepEqual(financials, await search('отчётность', sever));
  const other = await search('выписка', terra);
  assert.ok(other.results.every((r) => !r.id.includes('sever')));
});

test('exports and dashboard never silently truncate after 200 applications', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cookie = await s.login();
  const extra = Array.from({ length: 205 }, (_, i) =>
    newApplication(sample, DEMO_ORGANIZATIONS[0], `bulk_${i}`),
  );
  await s.db.batch(extra.map(insertApplicationStatement));
  const exported = await read<{ applications: Application[] }>(
    await s.call('/export?format=json', 'GET', undefined, cookie),
  );
  assert.equal(exported.applications.length, 207);
  const dashboard = await read<{ stats: { activeApplications: number; requestedAmount: number } }>(
    await s.call('/dashboard', 'GET', undefined, cookie),
  );
  assert.equal(dashboard.stats.activeApplications, 207);
  assert.equal(dashboard.stats.requestedAmount, 205 * sample.amount + 1200000 + 8000000);
});

test('concurrent import confirmation creates each draft once; malformed objects are rejected', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cookie = await s.login();
  const preview = await read<{ previewId: string }>(
    await s.call('/import/validate', 'POST', { applications: [sample, sample] }, cookie),
  );
  const responses = await Promise.all([
    s.call('/import/apply', 'POST', { previewId: preview.previewId }, cookie),
    s.call('/import/apply', 'POST', { previewId: preview.previewId }, cookie),
  ]);
  assert.ok(responses.every((r) => r.ok));
  const inserted = await s.db.query('SELECT id FROM applications WHERE id LIKE ?', [
    `${preview.previewId}%`,
  ]);
  assert.equal(inserted.length, 2);
  const body = await s.app.request('http://localhost/api/scenario', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: 'null',
  });
  assert.equal(body.status, 400);
  const max = await s.call(
    '/import/validate',
    'POST',
    { applications: Array.from({ length: 21 }, () => sample) },
    cookie,
  );
  assert.equal(max.status, 400);
});

test('SQLite file survives close/reopen without reseeding over user changes', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'debitus-test-'));
  const filename = path.join(dir, 'state.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let db = openSqliteDatabase(filename);
  db.migrate('migrations');
  await initializeDatabase(db);
  await db.run('INSERT INTO preferences(user_id,data) VALUES(?,?)', [
    'user_sever',
    JSON.stringify({ theme: 'dark' }),
  ]);
  db.close();
  db = openSqliteDatabase(filename);
  try {
    db.migrate('migrations');
    await initializeDatabase(db);
    const rows = await db.query<{ data: string }>('SELECT data FROM preferences WHERE user_id=?', [
      'user_sever',
    ]);
    assert.equal(JSON.parse(rows[0].data).theme, 'dark');
    assert.equal((await db.query('SELECT id FROM applications')).length, 4);
  } finally {
    db.close();
  }
});

test('bank custom request preserves required categories even when policy already needs information', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const client = await s.login('terra'),
    bank = await s.login('bank');
  const created = await read<{ application: Application }>(
    await s.call('/applications', 'POST', sample, client),
  );
  const id = created.application.id;
  let d = await read<ApplicationDetail>(
    await s.call(`/applications/${id}/actions/submit`, 'POST', { version: 1 }, client),
  );
  d = await read<ApplicationDetail>(
    await s.call(
      `/bank/applications/${id}/review`,
      'POST',
      { version: d.application.version },
      bank,
    ),
  );
  assert.equal(d.assessment.decision.outcome, 'needs_info');
  d = await read<ApplicationDetail>(
    await s.call(
      `/bank/applications/${id}/decision`,
      'POST',
      {
        version: d.application.version,
        outcome: 'needs_info',
        reason: 'Добавьте пояснение к сезонным расходам.',
        requestedDocuments: ['other'],
      },
      bank,
    ),
  );
  assert.equal(d.application.status, 'needs_info');
  assert.deepEqual(d.application.decision!.requestedDocuments.sort(), [
    'financials',
    'other',
    'statement',
  ]);
  assert.equal(d.application.decision!.reasons[0], 'Добавьте пояснение к сезонным расходам.');
});
