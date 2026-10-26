import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../server/app.js';
import { initializeDatabase } from '../server/seed.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';

async function setup() {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
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
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const login = await request('/auth/login', 'POST', {
    email: 'owner@sever.example.test',
    password: 'Demo2026!',
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const issued = await request(
    '/integrations/tokens',
    'POST',
    { name: 'MCP-проверка' },
    { cookie },
  );
  const { token, id: tokenId } = (await issued.json()) as { token: string; id: string };
  const headers = { authorization: `Bearer ${token}`, 'mcp-protocol-version': '2025-11-25' };
  const rpc = (body: unknown, extra: Record<string, string> = {}) =>
    request('/mcp', 'POST', body, { ...headers, ...extra });
  return { db, app, request, cookie, tokenId, headers, rpc };
}

test('MCP negotiates versions, handles notifications and ping, and rejects malformed envelopes', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const initialize = await s.rpc({
    jsonrpc: '2.0',
    id: 'init',
    method: 'initialize',
    params: {
      protocolVersion: '2099-01-01',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    },
  });
  assert.equal(initialize.status, 200);
  assert.equal(((await initialize.json()) as any).result.protocolVersion, '2025-11-25');
  const notification = await s.rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');
  assert.deepEqual(await (await s.rpc({ jsonrpc: '2.0', id: 7, method: 'ping' })).json(), {
    jsonrpc: '2.0',
    id: 7,
    result: {},
  });
  for (const body of [
    null,
    [],
    { jsonrpc: '2.0', id: null, method: 'ping' },
    { jsonrpc: '2.0', id: {}, method: 'ping' },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: [] },
  ]) {
    const response = await s.rpc(body);
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as any).error.code, -32600);
  }
  const invalid = await s.app.request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { ...s.headers, 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(((await invalid.json()) as any).error.code, -32700);
  assert.equal(
    (await s.rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': 'unknown' }))
      .status,
    400,
  );
  assert.equal(
    (await s.rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { accept: 'text/html' })).status,
    406,
  );
  for (const method of ['GET', 'DELETE']) {
    const response = await s.request('/mcp', method, undefined, s.headers);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  }
});

test('MCP keeps tool errors in protocol and does not accept tenant overrides or write tools', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const call = (name: string, args: unknown = {}) =>
    s.rpc({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name, arguments: args } });
  const malformed = await call('calculate_scenario', {
    productId: 'working_capital',
    amount: -1,
    termMonths: 24,
    financials: { monthlyRevenue: 1, monthlyExpenses: 0, monthlyDebtPayment: 0 },
  });
  const error = (await malformed.json()) as any;
  assert.equal(malformed.status, 200);
  assert.equal(error.id, 42);
  assert.equal(error.result.isError, true);
  assert.equal(error.result.structuredContent.code, 'INVALID_INPUT');
  const before = await s.db.query('SELECT * FROM applications ORDER BY id');
  for (const name of ['list_applications', 'get_business_profile', 'recommend_products']) {
    const forbidden = (await (await call(name, { organizationId: 'org_terra' })).json()) as any;
    assert.equal(forbidden.result.isError, true);
    assert.equal(JSON.stringify(forbidden).includes('Кофейни'), false);
  }
  const unknown = await call('submit_application');
  assert.equal(((await unknown.json()) as any).error.code, -32602);
  const profile = (await (await call('get_business_profile')).json()) as any;
  assert.equal(profile.result.isError, false);
  assert.equal(JSON.stringify(profile).includes('org_terra'), false);
  const list = (await (await call('list_applications')).json()) as any;
  assert.ok(
    list.result.structuredContent.applications.every(
      (a: { organizationId: string }) => a.organizationId === 'org_sever',
    ),
  );
  const recommendations = (await (await call('recommend_products')).json()) as any;
  assert.equal(recommendations.result.isError, false);
  assert.equal(recommendations.result.structuredContent.recommendations.length, 3);
  assert.deepEqual(await s.db.query('SELECT * FROM applications ORDER BY id'), before);
});

test('MCP authenticates every transport request, validates origins and immediately revokes access', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  assert.equal((await s.request('/mcp', 'POST', body)).status, 401);
  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await s.request('/mcp', method, method === 'POST' ? body : undefined, {
      ...s.headers,
      origin: 'https://untrusted.example',
    });
    assert.equal(response.status, 403);
  }
  assert.equal(
    (await s.request('/applications/app_terra_missing', 'GET', undefined, s.headers)).status,
    404,
  );
  assert.equal((await s.request('/applications', 'POST', {}, s.headers)).status, 403);
  await s.request(`/integrations/tokens/${s.tokenId}`, 'DELETE', undefined, { cookie: s.cookie });
  assert.equal((await s.rpc(body)).status, 401);
});

test('official MCP SDK completes a stateless HTTP handshake and all read-only tools', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const traffic: { method: string; status: number }[] = [];
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
    requestInit: { headers: { authorization: s.headers.authorization } },
    fetch: async (url, init) => {
      const response = await s.app.request(url instanceof URL ? url.toString() : url, init);
      traffic.push({ method: init?.method ?? 'GET', status: response.status });
      return response;
    },
  });
  const client = new Client({ name: 'debitus-sdk-test', version: '1' }, { capabilities: {} });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.name, 'debitus-kreditus');
  const health = (await (await s.request('/health')).json()) as { version: string };
  assert.equal(client.getServerVersion()?.version, health.version);
  const list = await client.listTools();
  assert.equal(list.tools.length, 11);
  assert.deepEqual(await client.ping(), {});
  for (const name of ['list_applications', 'get_business_profile', 'recommend_products']) {
    const result = await client.callTool({ name, arguments: {} });
    assert.equal(result.isError, false);
  }
  const result = await client.callTool({
    name: 'calculate_scenario',
    arguments: {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      financials: { monthlyRevenue: 2400000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
    },
  });
  assert.equal(result.isError, false);
  assert.ok(result.structuredContent);
  const error = await client.callTool({
    name: 'calculate_scenario',
    arguments: {
      productId: 'working_capital',
      amount: -1,
      termMonths: 24,
      financials: { monthlyRevenue: 1, monthlyExpenses: 0, monthlyDebtPayment: 0 },
    },
  });
  assert.equal(error.isError, true);
  assert.ok(traffic.some(({ status }) => status === 202));
  assert.ok(traffic.some(({ method, status }) => method === 'GET' && status === 405));
});
