import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../server/app.js';
import { initializeDatabase } from '../server/seed.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';
import { statementCsvTemplate, type StatementReport } from '../shared/statements.js';
import type { Application } from '../shared/types.js';
import type { NavigatorAnalysis } from '../shared/financing-intent.js';
import type { CashflowResult } from '../shared/cashflow.js';

const cashflow = {
  productId: 'equipment',
  amount: 1_200_000,
  termMonths: 24,
  startingMonth: '2026-11',
  horizonMonths: 12,
  openingBalance: 500_000,
  monthlyInflow: 2_400_000,
  monthlyOperatingOutflow: 1_650_000,
  monthlyExistingDebtPayment: 120_000,
  investmentCost: 1_200_000,
  monthlyAdditionalNetCash: 100_000,
  benefitStartMonth: 3,
  seasonalRevenuePct: Array(12).fill(100),
  assumptionsConfirmed: true,
};
const requestText = 'Нужно 1,2 млн рублей на оборудование на 24 месяца';
type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown> };

async function read<T>(response: Response): Promise<T> {
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result as T;
}
async function setup() {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
  const clients: Client[] = [];
  const request = (
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(`http://localhost/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (email: string) => {
    const response = await request('/auth/login', 'POST', { email, password: 'Demo2026!' });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const issue = async (cookie: string) => {
    const token = await read<{ token: string; id: string; scopes: string[] }>(
      await request('/integrations/tokens', 'POST', { name: 'Проверка V8 MCP' }, { cookie }),
    );
    assert.deepEqual(token.scopes, ['portfolio:read', 'scenarios:calculate']);
    return { headers: { authorization: `Bearer ${token.token}` }, id: token.id };
  };
  const sdk = async (headers: Record<string, string>) => {
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
      requestInit: { headers },
      fetch: async (url, init) => app.request(url instanceof URL ? url.toString() : url, init),
    });
    const client = new Client({ name: 'debitus-v8-test', version: '1' }, { capabilities: {} });
    clients.push(client);
    await client.connect(transport);
    return client;
  };
  const owner = await login('owner@sever.example.test');
  const token = await issue(owner);
  const client = await sdk(token.headers);
  const { application } = await read<{ application: Application }>(
    await request(
      '/applications',
      'POST',
      {
        productId: 'working_capital',
        amount: 1_200_000,
        termMonths: 24,
        purpose: 'Закупка материалов',
        financials: {
          monthlyRevenue: 2_400_000,
          monthlyExpenses: 1_650_000,
          monthlyDebtPayment: 120_000,
        },
        consent: true,
      },
      { cookie: owner },
    ),
  );
  const { report } = await read<{ report: StatementReport }>(
    await request(
      `/applications/${application.id}/statement`,
      'POST',
      {
        version: application.version,
        csv: statementCsvTemplate(),
        sourceName: 'выписка.csv',
        period: { from: '2026-08-01', to: '2026-09-30' },
        reviewed: true,
      },
      { cookie: owner },
    ),
  );
  const snapshot = async () => ({
    applications: await db.query('SELECT * FROM applications ORDER BY id'),
    organizations: await db.query('SELECT * FROM organizations ORDER BY id'),
    profiles: await db.query('SELECT * FROM business_profiles ORDER BY organization_id'),
    reports: await db.query('SELECT * FROM statement_reports ORDER BY id'),
    documents: await db.query('SELECT * FROM documents ORDER BY id'),
    audit: await db.query('SELECT * FROM audit ORDER BY id'),
  });
  return {
    db,
    request,
    login,
    issue,
    sdk,
    owner,
    token,
    client,
    application,
    report,
    snapshot,
    close: async () => {
      await Promise.all(clients.map((client) => client.close()));
      db.close();
    },
  };
}
function withoutCalculationTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCalculationTimestamps);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['generatedAt', 'evaluatedAt', 'checkedAt'].includes(key))
      .map(([key, item]) => [key, withoutCalculationTimestamps(item)]),
  );
}
async function success<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.ok(result.structuredContent);
  return result.structuredContent as T;
}
async function failure(client: Client, name: string, args: Record<string, unknown>, code: string) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.equal(result.structuredContent?.code, code);
  assert.equal(typeof result.structuredContent?.message, 'string');
}

test('official SDK exposes current read-only tools and V8 results match HTTP without mutating product data', async (t) => {
  const s = await setup();
  t.after(s.close);
  const list = await s.client.listTools();
  assert.equal(list.tools.length, 11);
  for (const name of [
    'get_statement_analysis',
    'analyze_financing_request',
    'calculate_cashflow',
  ]) {
    const tool = list.tools.find((item) => item.name === name)!;
    assert.ok(tool);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.openWorldHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const before = await s.snapshot();
  const statement = await success<{ report: StatementReport }>(s.client, 'get_statement_analysis', {
    applicationId: s.application.id,
  });
  assert.deepEqual(
    statement,
    await read(
      await s.request(
        `/applications/${s.application.id}/statement`,
        'GET',
        undefined,
        s.token.headers,
      ),
    ),
  );
  assert.deepEqual(statement.report, s.report);
  const navigator = await success<NavigatorAnalysis>(s.client, 'analyze_financing_request', {
    request: requestText,
  });
  const httpNavigator = await read<NavigatorAnalysis>(
    await s.request('/navigator/analyze', 'POST', { request: requestText }, s.token.headers),
  );
  assert.deepEqual(
    withoutCalculationTimestamps(navigator),
    withoutCalculationTimestamps(httpNavigator),
  );
  assert.equal(navigator.intent.amount, 1_200_000);
  assert.equal(navigator.intent.productId, 'equipment');
  assert.equal(navigator.intent.termMonths, 24);
  const flow = await success<CashflowResult>(s.client, 'calculate_cashflow', cashflow);
  const httpFlow = await read<CashflowResult>(
    await s.request('/scenario/cashflow', 'POST', cashflow, s.token.headers),
  );
  assert.deepEqual(withoutCalculationTimestamps(flow), withoutCalculationTimestamps(httpFlow));
  assert.equal(flow.rows.length, 12);
  assert.equal(flow.rows[0].loanProceeds, cashflow.amount);
  assert.equal(flow.rows[0].loanPayment, 0);
  assert.ok(flow.rows[1].loanPayment > 0);
  assert.equal(flow.source?.organizationId, 'org_sever');
  assert.deepEqual(await s.snapshot(), before);
});

test('saved statement MCP uses the same organization and bank visibility boundaries as HTTP', async (t) => {
  const s = await setup();
  t.after(s.close);
  const otherCookie = await s.login('owner@terra.example.test');
  const otherToken = await s.issue(otherCookie);
  const other = await s.sdk(otherToken.headers);
  const bankCookie = await s.login('bank@debitus.example.test');
  const bank = await s.sdk({ cookie: bankCookie });
  assert.equal(
    (
      await s.request(
        `/applications/${s.application.id}/statement`,
        'GET',
        undefined,
        otherToken.headers,
      )
    ).status,
    404,
  );
  await failure(other, 'get_statement_analysis', { applicationId: s.application.id }, 'NOT_FOUND');
  assert.equal(
    (
      await s.request(`/applications/${s.application.id}/statement`, 'GET', undefined, {
        cookie: bankCookie,
      })
    ).status,
    404,
  );
  await failure(bank, 'get_statement_analysis', { applicationId: s.application.id }, 'NOT_FOUND');
  await read(
    await s.request(
      `/applications/${s.application.id}/actions/submit`,
      'POST',
      { version: s.report.applicationVersion },
      { cookie: s.owner },
    ),
  );
  const bankReport = await success<{ report: StatementReport }>(bank, 'get_statement_analysis', {
    applicationId: s.application.id,
  });
  assert.deepEqual(bankReport.report, s.report);
  assert.deepEqual(
    bankReport,
    await read(
      await s.request(`/applications/${s.application.id}/statement`, 'GET', undefined, {
        cookie: bankCookie,
      }),
    ),
  );
  const admin = await s.login('admin@debitus.example.test');
  assert.equal(
    (
      await s.request(`/applications/${s.application.id}/statement`, 'GET', undefined, {
        cookie: admin,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await s.request(
        '/mcp',
        'POST',
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'get_statement_analysis',
            arguments: { applicationId: s.application.id },
          },
        },
        { cookie: admin },
      )
    ).status,
    403,
  );
});

test('MCP refuses tenant overrides, unknown arguments, invalid assumptions and bank-only company calculations', async (t) => {
  const s = await setup();
  t.after(s.close);
  const bank = await s.sdk({ cookie: await s.login('bank@debitus.example.test') });
  const before = await s.snapshot();
  await failure(
    s.client,
    'get_statement_analysis',
    { applicationId: s.application.id, organizationId: 'org_terra' },
    'INVALID_INPUT',
  );
  await failure(s.client, 'get_statement_analysis', { applicationId: '' }, 'INVALID_INPUT');
  await failure(
    s.client,
    'analyze_financing_request',
    { request: requestText, organizationId: 'org_terra' },
    'INVALID_INPUT',
  );
  await failure(s.client, 'analyze_financing_request', { request: 'x' }, 'INVALID_REQUEST');
  await failure(
    s.client,
    'calculate_cashflow',
    { ...cashflow, organizationId: 'org_terra' },
    'INVALID_INPUT',
  );
  await failure(s.client, 'calculate_cashflow', { ...cashflow, schedule: [] }, 'INVALID_INPUT');
  await failure(
    s.client,
    'calculate_cashflow',
    { ...cashflow, assumptionsConfirmed: false },
    'INVALID_CASHFLOW',
  );
  await failure(
    s.client,
    'calculate_cashflow',
    { ...cashflow, startingMonth: '2026-13' },
    'INVALID_CASHFLOW',
  );
  await failure(bank, 'analyze_financing_request', { request: requestText }, 'FORBIDDEN');
  await failure(bank, 'calculate_cashflow', cashflow, 'FORBIDDEN');
  const ambiguous = await success<NavigatorAnalysis>(s.client, 'analyze_financing_request', {
    request: 'Нужно от 2 до 3 млн на оборудование',
  });
  assert.equal(ambiguous.intent.amount, null);
  assert.equal(ambiguous.recommendation, null);
  assert.ok(ambiguous.intent.questions.length > 0);
  assert.deepEqual(await s.snapshot(), before);
});

test('bearer cannot turn V8 calculation tools into writes and revocation closes all new read routes', async (t) => {
  const s = await setup();
  t.after(s.close);
  const before = await s.snapshot();
  const blocked: [string, unknown][] = [
    [
      '/navigator/prepare',
      {
        expectedProfileVersion: 1,
        productId: 'equipment',
        amount: 1200000,
        termMonths: 24,
        purpose: 'Покупка оборудования',
      },
    ],
    [`/applications/${s.application.id}/statement/preview`, {}],
    [`/applications/${s.application.id}/statement`, {}],
    ['/applications', {}],
  ];
  for (const [path, body] of blocked) {
    const response = await s.request(path, 'POST', body, s.token.headers);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'TOKEN_SCOPE_DENIED');
  }
  assert.deepEqual(await s.snapshot(), before);
  await read(
    await s.request(`/integrations/tokens/${s.token.id}`, 'DELETE', undefined, { cookie: s.owner }),
  );
  for (const [path, method, body] of [
    [`/applications/${s.application.id}/statement`, 'GET', undefined],
    ['/navigator/analyze', 'POST', { request: requestText }],
    ['/scenario/cashflow', 'POST', cashflow],
    [
      '/mcp',
      'POST',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_statement_analysis', arguments: { applicationId: s.application.id } },
      },
    ],
  ] as const)
    assert.equal((await s.request(path, method, body, s.token.headers)).status, 401);
});
