import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = new URL(process.env.SERVICING_SMOKE_URL ?? 'http://127.0.0.1:3000');
assert.ok(
  url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
  'Проверка создаёт синтетическую заявку только на локальном HTTP-сервере.',
);
const base = url.origin;
const verifySaved = process.argv.includes('--verify-saved');
assert.ok(
  process.argv.slice(2).every((arg) => arg === '--verify-saved'),
  'Неизвестный параметр.',
);
const fixturePath = process.env.SERVICING_SMOKE_FIXTURE
  ? path.resolve(process.env.SERVICING_SMOKE_FIXTURE)
  : null;
if (fixturePath)
  assert.ok(
    ['.cache', 'output'].some((folder) => {
      const relative = path.relative(path.join(root, folder), fixturePath);
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    }),
    'Fixture должен находиться в ignored .cache/ или output/ проекта.',
  );
assert.ok(!verifySaved || fixturePath, 'Для --verify-saved нужен SERVICING_SMOKE_FIXTURE.');

let client, bank, other, tokenId;
const financials = {
  monthlyRevenue: 2400000,
  monthlyExpenses: 1650000,
  monthlyDebtPayment: 120000,
};
const auth = (cookie) => (cookie ? { Cookie: cookie } : {});
async function request(route, method = 'GET', body, headers = {}, expected = 200) {
  const response = await fetch(`${base}/api${route}`, {
    method,
    headers: { Origin: base, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: HTTP ${response.status}`);
  return { response, result };
}
async function call(route, method = 'GET', body, cookie = client, expected = 200) {
  return (await request(route, method, body, auth(cookie), expected)).result;
}
async function login(email) {
  const { response } = await request('/auth/login', 'POST', { email, password: 'Demo2026!' });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('dk_session='), 'Не удалось создать сессию проверки.');
  return cookie;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['generatedAt', 'evaluatedAt', 'decidedAt', 'checkedAt'].includes(key))
      .map(([key, item]) => [key, stable(item)]),
  );
}
async function snapshot(id) {
  const detail = await call(`/applications/${id}`);
  return stable({
    application: detail.application,
    documents: detail.documents,
    timeline: detail.timeline,
    portfolio: await call('/applications'),
    profile: await call('/business-profile'),
  });
}
async function verifyFixture() {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.target, base);
  assert.match(fixture.marker, /^servicing-smoke-[0-9a-f-]{36}$/);
  assert.match(fixture.appId, /^app_[0-9a-f]{20}$/);
  const endpoint = `/applications/${fixture.appId}/servicing`;
  const detail = await call(`/applications/${fixture.appId}`);
  assert.ok(detail.application.purpose.includes(fixture.marker));
  assert.deepEqual(detail.application, fixture.application);
  const before = await snapshot(fixture.appId);
  assert.deepEqual(await call(endpoint), fixture.closed);
  for (const saved of fixture.operations) {
    assert.deepEqual(await call(endpoint + saved.route, 'POST', saved.body), saved.response);
  }
  assert.deepEqual(await call(endpoint), fixture.closed);
  assert.deepEqual(await snapshot(fixture.appId), before, 'Повтор операции создал новое событие.');
  return { target: base, mode: 'verify-saved', passed: true, applicationId: fixture.appId };
}
async function exercise() {
  const marker = `servicing-smoke-${randomUUID()}`;
  let detail = await call(
    '/applications',
    'POST',
    {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      purpose: `Материалы для синтетической проверки ${marker}`,
      financials,
      consent: false,
    },
    client,
    201,
  );
  const id = detail.application.id;
  const app = `/applications/${id}`;
  const endpoint = app + '/servicing';
  const beforePlan = await snapshot(id);
  const initialPlan = await call(app + '/action-plan');
  assert.equal(initialPlan.applicationVersion, detail.application.version);
  assert.ok(initialPlan.items.some((item) => item.id === 'consent'));
  assert.ok(initialPlan.items.some((item) => item.id === 'missing-documents'));
  for (const item of initialPlan.items) {
    assert.ok(item.why && item.href && item.sources.length, 'План не объясняет действие.');
    for (const source of item.sources) assert.ok(source.at && source.href && source.label);
  }
  const alternatives = await call(app + '/alternatives?organizationId=org_terra&amount=1');
  assert.equal(alternatives.applicationId, id);
  assert.equal(alternatives.baseline.calculation.amount, 1200000);
  assert.ok(alternatives.options.length > 0);
  for (const option of alternatives.options) {
    assert.equal(option.draft.consent, false);
    assert.equal(option.draft.purpose, detail.application.purpose);
    assert.equal(option.draft.productId, detail.application.productId);
    assert.equal(
      option.calculation.totalRepayment,
      option.calculation.schedule.reduce((sum, row) => sum + row.payment, 0),
    );
    assert.ok(option.explanation && option.assessment && Array.isArray(option.blockers));
  }
  assert.deepEqual(await snapshot(id), beforePlan, 'План или варианты изменили заявку.');
  await call(app + '/action-plan', 'GET', undefined, bank, 404);
  await call(app + '/alternatives', 'GET', undefined, other, 404);
  await call(endpoint, 'GET', undefined, client, 409);
  await call(app, 'PATCH', { version: detail.application.version, consent: true });
  for (const category of ['statement', 'financials'])
    await call(app + '/documents/sample', 'POST', { category }, client, 201);
  const readyPlan = await call(app + '/action-plan');
  assert.ok(!readyPlan.items.some((item) => ['consent', 'missing-documents'].includes(item.id)));
  const action = async (name, actor = client, extra = {}) => {
    detail = await call(app);
    const route = actor === bank ? `/bank/applications/${id}/${name}` : `${app}/actions/${name}`;
    detail = await call(route, 'POST', { version: detail.application.version, ...extra }, actor);
    return detail;
  };
  await action('submit');
  await action('review', bank);
  await action('decision', bank, {
    outcome: 'needs_info',
    requestedDocuments: ['other'],
    reason: 'Приложите подтверждение нового синтетического контракта.',
  });
  assert.equal(detail.application.status, 'needs_info');
  const baselineVersion = detail.application.version;
  const needsInfo = await call(app + '/action-plan');
  assert.ok(needsInfo.items.some((item) => item.id === 'missing-documents'));
  assert.ok(needsInfo.items.some((item) => item.id === 'supplement'));
  await call(app + '/documents/sample', 'POST', { category: 'other' }, client, 201);
  detail = await call(app);
  await call(app, 'PATCH', {
    version: detail.application.version,
    financials: { ...financials, monthlyRevenue: 3200000 },
  });
  await action('supplement');
  assert.equal(detail.application.status, 'submitted');
  const beforeChanges = await snapshot(id);
  const changesRoute = `/bank/applications/${id}/changes`;
  const changes = await call(changesRoute, 'GET', undefined, bank);
  assert.equal(changes.baseline.kind, 'information_request');
  assert.equal(changes.baseline.version, baselineVersion);
  assert.deepEqual(
    changes.fields.find((item) => item.key === 'monthlyRevenue'),
    {
      key: 'monthlyRevenue',
      label: 'Выручка в месяц, ₽',
      before: 2400000,
      after: 3200000,
    },
  );
  assert.ok(changes.hasChanges);
  assert.ok(
    [...changes.documents.added, ...changes.documents.uncertain].some(
      (document) => document.category === 'other',
    ),
  );
  assert.deepEqual(await snapshot(id), beforeChanges, 'Сравнение банка изменило пакет.');
  await call(changesRoute, 'GET', undefined, client, 403);
  await action('review', bank);
  await action('decision', bank);
  assert.equal(detail.application.status, 'approved');
  for (const name of ['accept-offer', 'sign', 'fund'])
    await action(name, client, { confirmed: true });
  assert.equal(detail.application.status, 'funded');
  const fundedApplication = structuredClone(detail.application);
  await action('fund', client, { confirmed: true });
  assert.equal(detail.timeline.filter((event) => event.action === 'funded').length, 1);
  assert.equal(detail.documents.filter((document) => document.category === 'contract').length, 1);

  const beforeService = await snapshot(id);
  const initial = await call(endpoint);
  assert.equal(initial.servicing.version, 0);
  assert.equal(initial.servicing.balance, fundedApplication.amount);
  assert.equal(initial.servicing.simulated, true);
  assert.equal(initial.servicing.history.length, 0);
  assert.deepEqual(await call(endpoint, 'GET', undefined, bank), initial);
  assert.deepEqual(await snapshot(id), beforeService, 'Чтение создало сопровождение или аудит.');
  await call(endpoint, 'GET', undefined, other, 404);
  const operations = [];
  const save = async (route, body) => {
    const response = await call(endpoint + route, 'POST', body, client, 201);
    const beforeRetry = await snapshot(id);
    assert.deepEqual(await call(endpoint + route, 'POST', body), response);
    assert.deepEqual(await snapshot(id), beforeRetry, 'Повтор создал новое событие.');
    operations.push({ route, body, response });
    return response.servicing;
  };
  let state = await save('/payment', {
    version: 0,
    idempotencyKey: `payment-${randomUUID()}`,
    confirmed: true,
  });
  assert.equal(state.version, 1);
  assert.equal(state.history.length, 1);
  assert.ok(state.balance < fundedApplication.amount);
  assert.equal(state.prepaymentAvailable, true);
  const beforePreview = await snapshot(id);
  const previews = {};
  for (const mode of ['reduce_payment', 'reduce_term']) {
    previews[mode] = (
      await call(endpoint + '/prepayment/preview', 'POST', {
        version: state.version,
        amount: 300000,
        mode,
      })
    ).preview;
    assert.equal(previews[mode].balance, state.balance - 300000);
    assert.ok(previews[mode].interestSaved > 0);
  }
  assert.ok(previews.reduce_payment.nextPayment < previews.reduce_payment.previousPayment);
  assert.ok(previews.reduce_term.remainingTermMonths < previews.reduce_term.previousTermMonths);
  assert.deepEqual((await call(endpoint)).servicing, state);
  assert.deepEqual(await snapshot(id), beforePreview, 'Предпросмотр создал событие.');
  state = await save('/prepayment', {
    version: state.version,
    amount: 300000,
    mode: 'reduce_term',
    idempotencyKey: `prepayment-${randomUUID()}`,
    confirmed: true,
  });
  assert.equal(state.version, 2);
  assert.deepEqual(state.schedule, previews.reduce_term.schedule);
  assert.equal(state.prepaymentAvailable, false);
  state = await save('/payment', {
    version: state.version,
    idempotencyKey: `payment-${randomUUID()}`,
    confirmed: true,
  });
  assert.equal(state.version, 3);
  assert.equal(state.prepaymentAvailable, true);
  const fullPreview = (
    await call(endpoint + '/prepayment/preview', 'POST', {
      version: state.version,
      amount: state.balance,
      mode: 'reduce_term',
    })
  ).preview;
  assert.equal(fullPreview.balance, 0);
  state = await save('/prepayment', {
    version: state.version,
    amount: state.balance,
    mode: 'reduce_term',
    idempotencyKey: `full-${randomUUID()}`,
    confirmed: true,
  });
  assert.equal(state.version, 4);
  assert.equal(state.status, 'closed');
  assert.equal(state.balance, 0);
  assert.equal(state.paidPrincipal, fundedApplication.amount);
  assert.equal(state.nextPayment, null);
  assert.equal(state.schedule.length, 0);
  assert.equal(state.history.length, 4);
  assert.equal(state.totalRecorded, state.paidPrincipal + state.paidInterest);
  const closed = { servicing: state };
  assert.deepEqual(await call(endpoint), closed);
  assert.deepEqual(await call(endpoint, 'GET', undefined, bank), closed);
  assert.deepEqual(
    (await call(app)).application,
    fundedApplication,
    'Сопровождение переписало исторические условия или статус заявки.',
  );
  await call(
    endpoint + '/payment',
    'POST',
    {
      version: state.version,
      idempotencyKey: `after-close-${randomUUID()}`,
      confirmed: true,
    },
    client,
    409,
  );
  await call(
    endpoint + '/payment',
    'POST',
    {
      version: state.version,
      idempotencyKey: `bank-denied-${randomUUID()}`,
      confirmed: true,
    },
    bank,
    403,
  );
  await call(
    endpoint + '/payment',
    'POST',
    {
      version: state.version,
      idempotencyKey: `other-denied-${randomUUID()}`,
      confirmed: true,
    },
    other,
    404,
  );

  const token = await call(
    '/integrations/tokens',
    'POST',
    {
      name: `Синтетическая проверка ${marker}`,
    },
    client,
    201,
  );
  tokenId = token.id;
  const authorization = { Authorization: `Bearer ${token.token}` };
  let rpcId = 0;
  const rpcFor = (headers) => async (method, params) => {
    const { result } = await request(
      '/mcp',
      'POST',
      {
        jsonrpc: '2.0',
        id: ++rpcId,
        method,
        params,
      },
      {
        ...headers,
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
    );
    assert.equal(result.error, undefined, `MCP ${method} отклонён.`);
    return result.result;
  };
  const checkTools = async (headers, cases) => {
    const rpc = rpcFor(headers);
    await rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'debitus-offline-servicing-smoke', version: '1' },
    });
    const tools = (await rpc('tools/list', {})).tools;
    assert.equal(tools.length, 11);
    for (const [name, route] of cases) {
      assert.equal(tools.find((tool) => tool.name === name)?.annotations.readOnlyHint, true);
      const tool = await rpc('tools/call', { name, arguments: { applicationId: id } });
      assert.equal(tool.isError, false, `MCP ${name} вернул ошибку.`);
      const http = (await request(route, 'GET', undefined, headers)).result;
      assert.deepEqual(stable(tool.structuredContent), stable(http));
    }
  };
  const beforeMcp = await snapshot(id);
  await checkTools(authorization, [
    ['get_application_action_plan', app + '/action-plan'],
    ['get_financing_alternatives', app + '/alternatives'],
    ['get_loan_servicing', endpoint],
  ]);
  await checkTools(auth(bank), [['get_application_changes', changesRoute]]);
  for (const route of ['/payment', '/prepayment', '/prepayment/preview'])
    await request(
      endpoint + route,
      'POST',
      {
        version: 4,
        amount: 1,
        mode: 'reduce_term',
        idempotencyKey: `token-denied-${randomUUID()}`,
        confirmed: true,
      },
      authorization,
      403,
    );
  assert.deepEqual(await snapshot(id), beforeMcp, 'MCP или токен изменил данные.');
  assert.deepEqual(await call(endpoint), closed);
  await call(`/integrations/tokens/${tokenId}`, 'DELETE');
  tokenId = null;
  await request(endpoint, 'GET', undefined, authorization, 401);
  await request(app + '/action-plan', 'GET', undefined, authorization, 401);
  if (fixturePath) {
    await mkdir(path.dirname(fixturePath), { recursive: true });
    await writeFile(
      fixturePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          target: base,
          marker,
          appId: id,
          application: fundedApplication,
          closed,
          operations,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
  }
  return {
    target: base,
    mode: 'servicing',
    passed: true,
    applicationId: id,
    actionPlan: true,
    alternativesReadOnly: true,
    bankComparison: true,
    servicingEvents: 4,
    closed: true,
    idempotentOperations: 4,
    mcpTools: 4,
  };
}

let summary;
try {
  client = await login('owner@sever.example.test');
  if (!verifySaved) {
    bank = await login('bank@debitus.example.test');
    other = await login('owner@terra.example.test');
  }
  summary = await (verifySaved ? verifyFixture() : exercise());
} finally {
  if (tokenId) await call(`/integrations/tokens/${tokenId}`, 'DELETE');
  for (const cookie of [other, bank, client].filter(Boolean))
    await call('/auth/logout', 'POST', {}, cookie);
}
console.log(JSON.stringify(summary));
