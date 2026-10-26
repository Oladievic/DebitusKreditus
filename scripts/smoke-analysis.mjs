import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url = new URL(process.env.ANALYSIS_SMOKE_URL ?? 'http://127.0.0.1:3000');
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
const fixturePath = process.env.ANALYSIS_SMOKE_FIXTURE
  ? path.resolve(process.env.ANALYSIS_SMOKE_FIXTURE)
  : null;
if (fixturePath)
  assert.ok(
    ['.cache', 'output'].some((folder) => {
      const relative = path.relative(path.resolve(folder), fixturePath);
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    }),
    'Fixture должен находиться в ignored .cache/ или output/ текущего проекта.',
  );
assert.ok(!verifySaved || fixturePath, 'Для --verify-saved нужен ANALYSIS_SMOKE_FIXTURE.');

const csv =
  '\uFEFF' +
  [
    'date;direction;amount;counterparty_id;counterparty;kind;reference',
    '2026-08-05;in;1200000;buyer-a;Синтетический покупатель А;revenue;A-001',
    '2026-08-12;in;1200000;buyer-b;Синтетический покупатель Б;revenue;B-001',
    '2026-08-20;out;1650000;supplier;Синтетический поставщик;expense;S-001',
    '2026-08-25;out;120000;lender;Синтетический кредитор;debt;D-001',
    '2026-09-05;in;1300000;buyer-a;Синтетический покупатель А;revenue;A-002',
    '2026-09-12;in;1100000;buyer-b;Синтетический покупатель Б;revenue;B-002',
    '2026-09-20;out;1650000;supplier;Синтетический поставщик;expense;S-002',
    '2026-09-25;out;120000;lender;Синтетический кредитор;debt;D-002',
    '2026-08-05;in;1200000;buyer-a;Синтетический покупатель А;revenue;A-001',
    '2026-08-06;in;500000;own;Синтетический собственный счёт;transfer;T-001',
    '2026-08-07;in;900000;lender;Синтетический кредитор;loan;L-001',
    '2026-08-08;out;30000;buyer-a;Синтетический покупатель А;refund;R-001',
    '',
  ].join('\r\n');
const originalBytes = Buffer.from(csv, 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceSha256 = sha256(originalBytes);
const period = { from: '2026-08-01', to: '2026-09-30' };
const declaredFinancials = {
  monthlyRevenue: 2200000,
  monthlyExpenses: 1500000,
  monthlyDebtPayment: 100000,
};
let client, bank, tokenId, summary;
const headersFor = (cookie) => (cookie ? { Cookie: cookie } : {});
async function request(route, method = 'GET', body, headers = {}, expected = 200) {
  const response = await fetch(`${base}/api${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: HTTP ${response.status}`);
  return { response, result };
}
async function call(route, method = 'GET', body, cookie = client, expected = 200) {
  return (await request(route, method, body, headersFor(cookie), expected)).result;
}
async function login(email) {
  const { response } = await request('/auth/login', 'POST', { email, password: 'Demo2026!' });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('dk_session='), 'Не удалось создать сессию проверки.');
  return cookie;
}
async function download(documentId, cookie = client) {
  const response = await fetch(`${base}/api/documents/${documentId}/download`, {
    headers: headersFor(cookie),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  assert.equal(response.status, 200, 'Исходный CSV недоступен.');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes, originalBytes, 'Исходные байты CSV, включая BOM/CRLF, изменились.');
  assert.equal(sha256(bytes), sourceSha256);
  return bytes;
}
function withoutCalculationTimes(value) {
  if (Array.isArray(value)) return value.map(withoutCalculationTimes);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['generatedAt', 'evaluatedAt', 'checkedAt'].includes(key))
      .map(([key, item]) => [key, withoutCalculationTimes(item)]),
  );
}
async function snapshot(id) {
  const detail = await call(`/applications/${id}`);
  return withoutCalculationTimes({
    application: detail.application,
    documents: detail.documents,
    timeline: detail.timeline,
    profile: await call('/business-profile'),
    portfolio: await call('/applications'),
    statement: await call(`/applications/${id}/statement`),
  });
}
async function verifyFixture() {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.target, base);
  assert.match(fixture.marker, /^analysis-smoke-[0-9a-f-]{36}$/);
  assert.match(fixture.appId, /^app_[0-9a-f]{20}$/);
  const detail = await call(`/applications/${fixture.appId}`);
  assert.ok(detail.application.purpose.includes(fixture.marker));
  assert.deepEqual(detail.application, fixture.application);
  const saved = await call(`/applications/${fixture.appId}/statement`);
  assert.deepEqual(saved.report, fixture.report);
  const document = detail.documents.find((item) => item.id === fixture.report.documentId);
  assert.ok(document);
  assert.equal(document.sha256, fixture.documentSha256);
  assert.equal(document.size, originalBytes.length);
  await download(document.id);
  return { target: base, mode: 'verify-saved', passed: true, applicationId: fixture.appId };
}
async function analyze() {
  const marker = `analysis-smoke-${randomUUID()}`;
  const { application } = await call(
    '/applications',
    'POST',
    {
      productId: 'equipment',
      amount: 3000000,
      termMonths: 36,
      purpose: `Синтетическая проверка трактора ${marker}`,
      financials: declaredFinancials,
      consent: true,
    },
    client,
    201,
  );
  const id = application.id;
  const endpoint = `/applications/${id}/statement`;
  const body = { version: application.version, csv, period, sourceName: `${marker}.csv` };
  const beforePreview = await snapshot(id);
  assert.equal(beforePreview.statement.report, null);
  const preview = await call(`${endpoint}/preview`, 'POST', {
    ...body,
    sourceSha256: 'untrusted-client-hash',
    analysis: { totals: { revenue: 999999999 } },
  });
  assert.equal(preview.sourceSha256, sourceSha256);
  assert.equal(preview.analysis.rowCount, 12);
  assert.equal(preview.analysis.uniqueRows, 11);
  assert.equal(preview.analysis.duplicates.length, 1);
  assert.equal(preview.analysis.fullMonthCount, 2);
  assert.equal(preview.analysis.averageMonthlyRevenue, 2400000);
  assert.equal(preview.analysis.averageMonthlyExpenses, 1650000);
  assert.equal(preview.analysis.averageMonthlyDebtPayment, 120000);
  assert.equal(preview.analysis.totals.revenue, 4800000);
  assert.equal(preview.analysis.excludedTotals.loan.inflow, 900000);
  assert.equal(preview.analysis.excludedTotals.transfer.inflow, 500000);
  assert.equal(preview.analysis.excludedTotals.refund.outflow, 30000);
  assert.deepEqual(await snapshot(id), beforePreview, 'Предпросмотр изменил данные.');
  const { report } = await call(endpoint, 'POST', { ...body, reviewed: true }, client, 201);
  assert.deepEqual(report.analysis, preview.analysis);
  assert.equal(report.sourceSha256, sourceSha256);
  assert.equal(report.sourceSize, originalBytes.length);
  assert.equal(report.applicationVersion, application.version + 1);
  assert.deepEqual(report.analysis.declaredFinancials, declaredFinancials);
  assert.deepEqual((await call(endpoint)).report, report);
  let detail = await call(`/applications/${id}`);
  assert.deepEqual(detail.application.financials, declaredFinancials);
  assert.equal(detail.application.score, application.score);
  assert.equal(detail.application.decision, application.decision);
  assert.equal(detail.documents.filter((item) => item.category === 'statement').length, 1);
  assert.ok(detail.timeline.some((event) => event.action === 'statement_analyzed'));
  await download(report.documentId);

  const finance = {
    monthlyRevenue: report.analysis.averageMonthlyRevenue,
    monthlyExpenses: report.analysis.averageMonthlyExpenses,
    monthlyDebtPayment: report.analysis.averageMonthlyDebtPayment,
  };
  await call(`/applications/${id}`, 'PATCH', {
    version: detail.application.version,
    financials: finance,
  });
  detail = await call(`/applications/${id}`);
  assert.deepEqual(detail.application.financials, finance);
  assert.deepEqual(
    (await call(endpoint)).report,
    report,
    'Снимок сравнения переписан после PATCH.',
  );
  const beforeCalculations = await snapshot(id);
  const requestText = 'Нужно 3 миллиона на трактор на 3 года';
  const navigator = await call('/navigator/analyze', 'POST', { request: requestText });
  assert.equal(navigator.intent.amount, 3000000);
  assert.equal(navigator.intent.productId, 'equipment');
  assert.equal(navigator.intent.termMonths, 36);
  const prepared = await call('/navigator/prepare', 'POST', {
    expectedProfileVersion: navigator.profileVersion,
    productId: navigator.intent.productId,
    amount: navigator.intent.amount,
    termMonths: navigator.intent.termMonths,
    purpose: 'Покупка трактора для синтетической проверки',
  });
  const profile = beforeCalculations.profile;
  assert.equal(prepared.profileVersion, profile.profile.version);
  assert.equal(prepared.draft.consent, false);
  assert.deepEqual(prepared.draft.financials, {
    monthlyRevenue: profile.organization.monthlyRevenue,
    monthlyExpenses: profile.organization.monthlyExpenses,
    monthlyDebtPayment: profile.organization.monthlyDebtPayment,
  });
  assert.equal(prepared.calculation.schedule.length, 36);
  const cashflowInputs = {
    productId: prepared.draft.productId,
    amount: prepared.draft.amount,
    termMonths: prepared.draft.termMonths,
    startingMonth: '2026-11',
    horizonMonths: 12,
    openingBalance: 500000,
    monthlyInflow: finance.monthlyRevenue,
    monthlyOperatingOutflow: finance.monthlyExpenses,
    monthlyExistingDebtPayment: finance.monthlyDebtPayment,
    investmentCost: 3000000,
    monthlyAdditionalNetCash: 100000,
    benefitStartMonth: 3,
    seasonalRevenuePct: Array(12).fill(100),
    assumptionsConfirmed: true,
  };
  const cashflow = await call('/scenario/cashflow', 'POST', cashflowInputs);
  assert.equal(cashflow.rows.length, 12);
  assert.equal(cashflow.rows[0].loanProceeds, 3000000);
  assert.equal(cashflow.rows[0].investmentOutflow, 3000000);
  assert.equal(cashflow.rows[0].loanPayment, 0);
  assert.equal(cashflow.rows[1].month, '2026-12');
  assert.ok(cashflow.rows[1].loanPayment > 0);
  assert.equal(cashflow.rows[0].withLoan.endingBalance, 1130000);
  assert.equal(cashflow.rows[1].additionalNetCash, 0);
  assert.equal(cashflow.rows[2].additionalNetCash, 100000);
  assert.equal(cashflow.noLoan.endingBalance, 8060000);
  assert.equal(cashflow.loan.rateBps, prepared.product.rateBps);
  assert.equal(
    cashflow.withLoan.endingBalance,
    8060000 + 1000000 - cashflow.rows.reduce((sum, row) => sum + row.loanPayment, 0),
  );
  assert.ok(cashflow.loan.debtAfterHorizon > 0);
  assert.deepEqual(await snapshot(id), beforeCalculations, 'Расчёты изменили данные продукта.');

  const token = await call(
    '/integrations/tokens',
    'POST',
    { name: `Синтетическая проверка ${marker}` },
    client,
    201,
  );
  tokenId = token.id;
  const authorization = { Authorization: `Bearer ${token.token}` };
  let rpcId = 0;
  const rpc = async (method, params) => {
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
        ...authorization,
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
    );
    assert.equal(result.error, undefined, `MCP ${method} отклонён.`);
    return result.result;
  };
  await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'debitus-offline-analysis-smoke', version: '1' },
  });
  const tools = (await rpc('tools/list', {})).tools;
  const toolCall = async (name, args) => {
    const tool = tools.find((item) => item.name === name);
    assert.ok(tool);
    assert.equal(tool.annotations.readOnlyHint, true);
    const result = await rpc('tools/call', { name, arguments: args });
    assert.equal(result.isError, false, `MCP ${name} вернул ошибку.`);
    assert.ok(result.structuredContent);
    return result.structuredContent;
  };
  const httpReport = (await request(endpoint, 'GET', undefined, authorization)).result;
  assert.deepEqual(await toolCall('get_statement_analysis', { applicationId: id }), httpReport);
  const httpNavigator = (
    await request('/navigator/analyze', 'POST', { request: requestText }, authorization)
  ).result;
  assert.deepEqual(
    withoutCalculationTimes(await toolCall('analyze_financing_request', { request: requestText })),
    withoutCalculationTimes(httpNavigator),
  );
  const httpCashflow = (await request('/scenario/cashflow', 'POST', cashflowInputs, authorization))
    .result;
  assert.deepEqual(
    withoutCalculationTimes(await toolCall('calculate_cashflow', cashflowInputs)),
    withoutCalculationTimes(httpCashflow),
  );
  assert.deepEqual(withoutCalculationTimes(httpNavigator), withoutCalculationTimes(navigator));
  assert.deepEqual(withoutCalculationTimes(httpCashflow), withoutCalculationTimes(cashflow));
  await request(endpoint, 'POST', { ...body, reviewed: true }, authorization, 403);
  assert.deepEqual(
    await snapshot(id),
    beforeCalculations,
    'MCP или токен изменил данные продукта.',
  );

  bank = await login('bank@debitus.example.test');
  await call(endpoint, 'GET', undefined, bank, 404);
  await call(
    `/applications/${id}/documents/sample`,
    'POST',
    { category: 'financials' },
    client,
    201,
  );
  detail = await call(`/applications/${id}`);
  assert.ok(detail.documents.some((item) => item.category === 'financials'));
  assert.equal(detail.documents.filter((item) => item.category === 'statement').length, 1);
  await call(`/applications/${id}/actions/submit`, 'POST', { version: detail.application.version });
  detail = await call(`/applications/${id}`);
  assert.equal(detail.application.status, 'submitted');
  assert.deepEqual((await call(endpoint, 'GET', undefined, bank)).report, report);
  await download(report.documentId, bank);
  await call(
    endpoint,
    'POST',
    { ...body, version: detail.application.version, reviewed: true },
    bank,
    403,
  );
  await call(
    `/applications/${id}`,
    'PATCH',
    { version: detail.application.version, amount: 4000000 },
    bank,
    403,
  );
  assert.deepEqual((await call(`/applications/${id}`)).application, detail.application);
  assert.deepEqual((await call(endpoint)).report, report);
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
          application: detail.application,
          report,
          documentSha256: sourceSha256,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
  }
  return {
    target: base,
    mode: 'analysis',
    passed: true,
    applicationId: id,
    csvRows: 12,
    uniqueRows: 11,
    mcpTools: 3,
    bankReportMatches: true,
  };
}

try {
  client = await login('owner@sever.example.test');
  summary = await (verifySaved ? verifyFixture() : analyze());
} finally {
  if (tokenId) await call(`/integrations/tokens/${tokenId}`, 'DELETE');
  for (const cookie of [bank, client].filter(Boolean))
    await call('/auth/logout', 'POST', {}, cookie);
}
console.log(JSON.stringify(summary));
