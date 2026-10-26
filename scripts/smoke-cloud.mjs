import assert from 'node:assert/strict';
const url = new URL(process.env.LOCAL_WORKER_URL ?? 'http://127.0.0.1:4173');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Smoke-тест создаёт синтетическую заявку и разрешён только на локальном сервере');
}
const base = url.origin;
const deepRoutes = [
  '/welcome',
  '/bank',
  '/admin',
  '/assistant',
  '/applications/app_sever_working',
  '/products?product=equipment',
];
for (const route of deepRoutes) {
  const response = await fetch(base + route, { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 200, `Прямой клиентский маршрут ${route}`);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(await response.text(), /id=["']root["']/, `HTML приложения для ${route}`);
}
const head = await fetch(base + '/bank', { method: 'HEAD', headers: { Accept: 'text/html' } });
assert.equal(head.status, 200, 'HEAD клиентского маршрута');
assert.match(head.headers.get('content-type') ?? '', /text\/html/i);
assert.equal(await head.text(), '');
const missingAsset = await fetch(base + '/assets/persistence-smoke-missing-never-built.js', {
  headers: { Accept: 'text/html' },
});
assert.equal(
  missingAsset.status,
  404,
  'Отсутствующий JS должен оставаться 404, а не HTML приложения',
);
async function call(path, method = 'GET', body, cookie) {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
  return { result, response };
}
async function login(email) {
  const { response } = await call('/auth/login', 'POST', { email, password: 'Demo2026!' });
  return response.headers.get('set-cookie').split(';')[0];
}
const client = await login('owner@sever.example.test');
const bank = await login('bank@debitus.example.test');
const { result: created } = await call(
  '/applications',
  'POST',
  {
    productId: 'working_capital',
    amount: 1200000,
    termMonths: 24,
    purpose: 'Проверка Worker и D1',
    financials: { monthlyRevenue: 2400000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
    consent: true,
  },
  client,
);
const id = created.application.id;
for (const category of ['statement', 'financials'])
  await call(`/applications/${id}/documents/sample`, 'POST', { category }, client);
let detail = (await call(`/applications/${id}`, 'GET', undefined, client)).result;
const action = async (name, actor = client, route = `/applications/${id}/actions/`) => {
  detail = (
    await call(
      route + name,
      'POST',
      { version: detail.application.version, confirmed: true },
      actor,
    )
  ).result;
};
await action('submit');
await action('review', bank, `/bank/applications/${id}/`);
await action('decision', bank, `/bank/applications/${id}/`);
assert.equal(detail.application.status, 'approved');
await action('accept-offer');
await action('sign');
await action('fund');
assert.equal(detail.application.status, 'funded');
await action('fund');
assert.equal(detail.timeline.filter((entry) => entry.action === 'funded').length, 1);
assert.equal(detail.documents.filter((entry) => entry.category === 'contract').length, 1);
console.log(
  JSON.stringify({
    target: base,
    journey: 'draft -> funded',
    auditEntries: detail.timeline.length,
    contracts: 1,
    idempotentFunding: true,
    deepRoutes,
    missingAssetStatus: missingAsset.status,
  }),
);
