import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFinancingIntent } from '../shared/financing-intent.js';
import type { NavigatorAnalysis, NavigatorDraft } from '../shared/financing-intent.js';
import type { BusinessProfileResponse } from '../shared/types.js';
import { createApp } from '../server/app.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';
import { initializeDatabase } from '../server/seed.js';

test('navigator parses explicit Russian equipment amount and term with matching evidence', () => {
  const result = parseFinancingIntent('Нужно 3 миллиона на трактор на 3 года');
  assert.equal(result.productId, 'equipment');
  assert.equal(result.amount, 3000000);
  assert.equal(result.termMonths, 36);
  assert.equal(result.evidence.amount, '3 миллиона');
  assert.equal(result.evidence.term, '3 года');
  assert.deepEqual(result.evidence.goal, ['трактор']);
  assert.deepEqual(result.questions, []);
  assert.match(result.methodVersion, /rules/);
});

test('navigator resolves supported decimal millions, thousands, whole rubles and month terms exactly', () => {
  for (const [request, amount, term] of [
    ['Нужно 2,5 млн на оборудование на 36 месяцев', 2500000, 36],
    ['Нужно 1.25 миллиона на оборудование на 24 месяца', 1250000, 24],
    ['Нужно 750 тыс. на сырье на 12 мес.', 750000, 12],
    ['Нужно 250 тысяч на закупку товаров на 1 год', 250000, 12],
    ['Нужно 500 000 ₽ на кассовый разрыв на 6 месяцев', 500000, 6],
    ['Нужно 500\u202f000 рублей на сырье на 24 месяца', 500000, 24],
    ['Нужно 3 млн на оборудование на 1,5 года', 3000000, 18],
  ] as const) {
    const result = parseFinancingIntent(request);
    assert.equal(result.amount, amount, request);
    assert.equal(result.termMonths, term, request);
  }
});

test('navigator asks for one amount, supported currency and one purpose without guessing ambiguity away', () => {
  for (const request of [
    'Нужно 2 млн или 3 млн на оборудование',
    'Нужно 2–3 млн на оборудование',
    'Нужно от 2 млн до 3 млн на оборудование',
    'Нужно 3 млн долларов на оборудование',
    'Нужно 3000000 EUR на оборудование',
    'Нужно 3 млн рублей и 200 USD на оборудование',
  ]) {
    const result = parseFinancingIntent(request);
    assert.equal(result.amount, null, request);
    assert.equal(result.evidence.amount, null, request);
    assert.ok(result.questions.length, request);
  }
  for (const request of [
    'Нужно 3 млн на оборудование и товары',
    'Нужно 3 млн на сырье или кассовый разрыв',
    'Нужен кредит 3 млн на развитие',
  ]) {
    const result = parseFinancingIntent(request);
    assert.equal(result.productId, null, request);
    assert.deepEqual(result.evidence.goal, [], request);
    assert.ok(result.questions.length, request);
  }
});

test('navigator respects negated purposes and explains its limited overdraft substitute', () => {
  assert.equal(
    parseFinancingIntent('Нужно 3 млн не на оборудование, а на сырье').productId,
    'working_capital',
  );
  assert.equal(
    parseFinancingIntent('Нужно 3 млн без закупки товаров на оборудование').productId,
    'equipment',
  );
  assert.equal(parseFinancingIntent('Нужно 3 млн не на оборудование').productId, null);
  assert.equal(parseFinancingIntent('Бизнес становится крупнее, нужно 3 млн').productId, null);
  const overdraft = parseFinancingIntent('Нужно 500 тыс на овердрафт');
  assert.equal(overdraft.productId, 'credit_line');
  assert.ok(overdraft.questions.some((question) => /нет настоящего овердрафта/.test(question)));
});

test('navigator rejects unsupported amounts and never parses a positive tail from malformed numeric syntax', () => {
  for (const request of [
    'Нужно 1,5 руб на оборудование',
    'Нужно 0.001 руб на оборудование',
    'Нужно -3 млн на оборудование',
    'Нужно −3 млн на оборудование',
    'Нужно 1,2,3 млн на оборудование',
    'Нужно 31 млн на оборудование',
    'Нужно 1 млрд на оборудование',
    'Нужно 0 млн на оборудование',
    'Нужно 3e6 рублей на оборудование',
  ]) {
    const result = parseFinancingIntent(request);
    assert.equal(result.amount, null, request);
    assert.equal(result.evidence.amount, null, request);
    assert.ok(result.questions.length, request);
  }
  for (const request of [
    'Нужно 3 млн на оборудование на 1,5 месяца',
    'Нужно 3 млн на оборудование на -3 года',
    'Нужно 3 млн на оборудование на 12 или 24 месяца',
    'Нужно 3 млн на оборудование на 61 месяц',
  ])
    assert.equal(parseFinancingIntent(request).termMonths, null, request);
  for (const value of ['', 'а', 'x'.repeat(501), 'кредит\0на станок'])
    assert.throws(() => parseFinancingIntent(value), /от 3 до 500/);
});

async function setup() {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
  const call = (
    route: string,
    cookie = '',
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ) =>
    app.request(`http://localhost/api${route}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (role: 'client' | 'terra' | 'bank' | 'admin') => {
    const response = await call('/auth/login', '', {
      email:
        role === 'client'
          ? 'owner@sever.example.test'
          : role === 'terra'
            ? 'owner@terra.example.test'
            : `${role}@debitus.example.test`,
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
const draftInput = {
  productId: 'equipment',
  amount: 3000000,
  termMonths: 36,
  purpose: 'Покупка трактора',
  expectedProfileVersion: 1,
};

test('navigator API uses the authenticated business profile and preparing a draft writes no business data', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const client = await s.login('client');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Навигатор не должен обращаться к сети или LLM');
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  assert.equal((await s.db.query('SELECT name FROM _migrations')).length, 6);
  const profile = await read<BusinessProfileResponse>(await s.call('/business-profile', client));
  const snapshot = async () => ({
    organizations: await s.db.query('SELECT * FROM organizations ORDER BY id'),
    profiles: await s.db.query('SELECT * FROM business_profiles ORDER BY organization_id'),
    applications: await s.db.query('SELECT * FROM applications ORDER BY id'),
    documents: await s.db.query('SELECT * FROM documents ORDER BY id'),
    audit: await s.db.query('SELECT * FROM audit ORDER BY id'),
  });
  const before = await snapshot();
  const financials = {
    monthlyRevenue: profile.organization.monthlyRevenue,
    monthlyExpenses: profile.organization.monthlyExpenses,
    monthlyDebtPayment: profile.organization.monthlyDebtPayment,
  };
  const analysis = await read<NavigatorAnalysis>(
    await s.call('/navigator/analyze', client, {
      request: 'Нужно 3 миллиона на трактор на 3 года',
      organizationId: 'org_terra',
      financials: { monthlyRevenue: 999999999, monthlyExpenses: 0, monthlyDebtPayment: 0 },
      profile: { version: 999, financialsAsOf: '2099-01-01' },
    }),
  );
  assert.equal(analysis.profileVersion, profile.profile.version);
  assert.equal(analysis.financialsAsOf, profile.profile.financialsAsOf);
  assert.equal(analysis.recommendation?.product.id, 'equipment');
  assert.equal(
    analysis.recommendation?.calculation?.availableCash,
    financials.monthlyRevenue - financials.monthlyExpenses - financials.monthlyDebtPayment,
  );
  const prepared = await read<NavigatorDraft>(
    await s.call('/navigator/prepare', client, {
      ...draftInput,
      expectedProfileVersion: profile.profile.version,
      organizationId: 'org_terra',
      organization: { id: 'org_terra' },
      financials: { monthlyRevenue: 999999999, monthlyExpenses: 0, monthlyDebtPayment: 0 },
      consent: true,
    }),
  );
  assert.deepEqual(prepared.draft.financials, financials);
  assert.equal(prepared.draft.consent, false);
  assert.equal(prepared.draft.amount, 3000000);
  assert.equal(prepared.draft.termMonths, 36);
  assert.equal(prepared.profileVersion, profile.profile.version);
  assert.equal(prepared.calculation.schedule.length, 36);
  assert.equal(
    prepared.calculation.totalRepayment,
    prepared.calculation.schedule.reduce((sum, payment) => sum + payment.payment, 0),
  );
  assert.equal('organizationId' in prepared.draft, false);
  assert.deepEqual(await snapshot(), before);

  const terra = await s.login('terra');
  const terraProfile = await read<BusinessProfileResponse>(
    await s.call('/business-profile', terra),
  );
  const ownDraft = await read<NavigatorDraft>(
    await s.call('/navigator/prepare', terra, {
      ...draftInput,
      expectedProfileVersion: terraProfile.profile.version,
      organizationId: profile.organization.id,
    }),
  );
  assert.equal(ownDraft.draft.financials.monthlyRevenue, terraProfile.organization.monthlyRevenue);
  assert.notEqual(ownDraft.draft.financials.monthlyRevenue, financials.monthlyRevenue);
});

test('navigator preparation enforces catalog bounds, whole numeric values and profile freshness', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const client = await s.login('client');
  for (const changes of [
    { amount: 499999 },
    { amount: 30000001 },
    { amount: 3000000.5 },
    { amount: '3000000' },
    { termMonths: 11 },
    { termMonths: 61 },
    { termMonths: 36.5 },
    { termMonths: '36' },
    { productId: 'working_capital', amount: 10000001 },
    { productId: 'working_capital', termMonths: 37 },
    { productId: 'credit_line', amount: 5000001 },
    { productId: 'credit_line', termMonths: 25 },
    { productId: 'not-a-product' },
    { purpose: 'x' },
  ]) {
    const response = await s.call('/navigator/prepare', client, { ...draftInput, ...changes });
    assert.equal(response.status, 400, JSON.stringify(changes));
  }
  for (const amount of [500000, 30000000]) {
    const result = await read<NavigatorDraft>(
      await s.call('/navigator/prepare', client, { ...draftInput, amount }),
    );
    assert.equal(result.draft.amount, amount);
  }
  const profile = await read<BusinessProfileResponse>(await s.call('/business-profile', client));
  const updated = await s.call(
    '/business-profile',
    client,
    {
      version: profile.profile.version,
      profile: { ...profile.profile, cashReserve: profile.profile.cashReserve + 1000 },
      financials: {
        monthlyRevenue: profile.organization.monthlyRevenue,
        monthlyExpenses: profile.organization.monthlyExpenses,
        monthlyDebtPayment: profile.organization.monthlyDebtPayment,
      },
    },
    'PUT',
  );
  assert.equal(updated.status, 200);
  const stale = await s.call('/navigator/prepare', client, draftInput);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, 'PROFILE_VERSION_CONFLICT');
  const fresh = await read<NavigatorDraft>(
    await s.call('/navigator/prepare', client, {
      ...draftInput,
      expectedProfileVersion: profile.profile.version + 1,
    }),
  );
  assert.equal(fresh.profileVersion, profile.profile.version + 1);
});

test('navigator rechecks paused products and rejects non-client roles before business access', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const client = await s.login('client'),
    admin = await s.login('admin'),
    bank = await s.login('bank');
  for (const cookie of [admin, bank]) {
    assert.equal(
      (await s.call('/navigator/analyze', cookie, { request: 'Нужно 3 млн на оборудование' }))
        .status,
      403,
    );
    assert.equal((await s.call('/navigator/prepare', cookie, draftInput)).status, 403);
  }
  assert.equal(
    (await s.call('/navigator/analyze', '', { request: 'Нужно 3 млн на оборудование' })).status,
    401,
  );
  assert.equal((await s.call('/navigator/prepare', '', draftInput)).status, 401);
  const paused = await s.call(
    '/admin/products/equipment/intake',
    admin,
    {
      version: 1,
      paused: true,
      reason: 'Обновление условий оборудования',
    },
    'PATCH',
  );
  assert.equal(paused.status, 200);
  const analysis = await read<NavigatorAnalysis>(
    await s.call('/navigator/analyze', client, {
      request: 'Нужно 3 млн на оборудование на 3 года',
    }),
  );
  assert.equal(analysis.recommendation?.product.intake?.paused, true);
  assert.equal(analysis.recommendation?.eligible, false);
  const prepared = await s.call('/navigator/prepare', client, draftInput);
  assert.equal(prepared.status, 409);
  assert.equal((await prepared.json()).error.code, 'PRODUCT_PAUSED');
  for (const body of [{}, { request: 3 }, { request: '' }, { request: ['кредит'] }])
    assert.equal((await s.call('/navigator/analyze', client, body)).status, 400);
  for (const body of [null, []])
    assert.equal((await s.call('/navigator/prepare', client, body)).status, 400);
  for (const body of [{}, { ...draftInput, expectedProfileVersion: '1' }])
    assert.equal((await s.call('/navigator/prepare', client, body)).status, 409);
});
