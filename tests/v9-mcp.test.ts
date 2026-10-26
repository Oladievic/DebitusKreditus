import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../server/app.js';
import { initializeDatabase } from '../server/seed.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['generatedAt', 'evaluatedAt', 'decidedAt', 'checkedAt'].includes(key))
      .map(([key, item]) => [key, stable(item)]),
  );
}
async function setup() {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
  const clients: Client[] = [];
  const request = (
    route: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(`http://localhost/api${route}`, {
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
    return { cookie: response.headers.get('set-cookie')!.split(';')[0] };
  };
  const sdk = async (headers: Record<string, string>) => {
    const client = new Client({ name: 'v9-read-only-test', version: '1' }, { capabilities: {} });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
        requestInit: { headers },
        fetch: async (url, init) => app.request(url instanceof URL ? url.toString() : url, init),
      }),
    );
    return client;
  };
  const owner = await login('owner@sever.example.test');
  const issued = await request(
    '/integrations/tokens',
    'POST',
    { name: 'Проверка новых инструментов' },
    owner,
  );
  assert.equal(issued.status, 201);
  const token = (await issued.json()) as { token: string; id: string };
  const bearer = { authorization: `Bearer ${token.token}` };
  return {
    db,
    request,
    login,
    sdk,
    owner,
    bearer,
    token,
    close: async () => {
      for (const client of clients) await client.close();
      db.close();
    },
  };
}

test('V9 official MCP tools match authorized HTTP and cannot write through a read token', async () => {
  const s = await setup();
  try {
    const client = await s.sdk(s.bearer);
    assert.equal((await client.listTools()).tools.length, 11);
    const before = await s.db.query('SELECT * FROM applications ORDER BY id');
    for (const [name, path] of [
      ['get_application_action_plan', '/applications/app_sever_working/action-plan'],
      ['get_financing_alternatives', '/applications/app_sever_working/alternatives'],
    ]) {
      const http = await s.request(path, 'GET', undefined, s.bearer);
      assert.equal(http.status, 200);
      const tool = await client.callTool({
        name,
        arguments: { applicationId: 'app_sever_working' },
      });
      assert.equal(tool.isError, false);
      assert.deepEqual(stable(tool.structuredContent), stable(await http.json()));
    }
    assert.deepEqual(await s.db.query('SELECT * FROM applications ORDER BY id'), before);
    const payment = await s.request(
      '/applications/app_sever_working/servicing/payment',
      'POST',
      { version: 0, idempotencyKey: 'v9-denied', confirmed: true },
      s.bearer,
    );
    assert.equal(payment.status, 403);
    const forbidden = await client.callTool({
      name: 'get_application_action_plan',
      arguments: { applicationId: 'app_sever_working', organizationId: 'org_terra' },
    });
    assert.equal(forbidden.isError, true);
    const wrongOwner = await client.callTool({
      name: 'get_financing_alternatives',
      arguments: { applicationId: 'app_terra_missing' },
    });
    assert.equal(wrongOwner.isError, true);
    const bankOnly = await client.callTool({
      name: 'get_application_changes',
      arguments: { applicationId: 'app_sever_expansion' },
    });
    assert.equal(bankOnly.isError, true);
    await s.request(`/integrations/tokens/${s.token.id}`, 'DELETE', undefined, s.owner);
    assert.equal(
      (await s.request('/applications/app_sever_working/action-plan', 'GET', undefined, s.bearer))
        .status,
      401,
    );
  } finally {
    await s.close();
  }
});

test('MCP bank changes use bank-only HTTP service and never expose a private draft', async () => {
  const s = await setup();
  try {
    const bank = await s.login('bank@debitus.example.test');
    const client = await s.sdk(bank);
    const http = await s.request(
      '/bank/applications/app_sever_expansion/changes',
      'GET',
      undefined,
      bank,
    );
    assert.equal(http.status, 200);
    const tool = await client.callTool({
      name: 'get_application_changes',
      arguments: { applicationId: 'app_sever_expansion' },
    });
    assert.equal(tool.isError, false);
    assert.deepEqual(stable(tool.structuredContent), stable(await http.json()));
    const draft = await client.callTool({
      name: 'get_application_action_plan',
      arguments: { applicationId: 'app_sever_working' },
    });
    assert.equal(draft.isError, true);
    const admin = await s.login('admin@debitus.example.test');
    assert.equal(
      (await s.request('/applications/app_sever_working/action-plan', 'GET', undefined, admin))
        .status,
      403,
    );
  } finally {
    await s.close();
  }
});

test('MCP servicing returns the saved model after a payment and retains read-only scopes', async () => {
  const s = await setup();
  try {
    const id = 'app_sever_working';
    const bank = await s.login('bank@debitus.example.test');
    for (const category of ['statement', 'financials']) {
      const response = await s.request(
        `/applications/${id}/documents/sample`,
        'POST',
        { category },
        s.owner,
      );
      assert.equal(response.status, 201);
    }
    const action = async (path: string, headers: Record<string, string>, extra = {}) => {
      const current = await (
        await s.request(`/applications/${id}`, 'GET', undefined, s.owner)
      ).json();
      const response = await s.request(
        path,
        'POST',
        { version: current.application.version, ...extra },
        headers,
      );
      assert.equal(response.status, 200, path);
    };
    await action(`/applications/${id}/actions/submit`, s.owner);
    await action(`/bank/applications/${id}/review`, bank);
    await action(`/bank/applications/${id}/decision`, bank);
    for (const name of ['accept-offer', 'sign', 'fund'])
      await action(`/applications/${id}/actions/${name}`, s.owner, { confirmed: true });
    const paid = await s.request(
      `/applications/${id}/servicing/payment`,
      'POST',
      { version: 0, idempotencyKey: 'sdk-payment-v9', confirmed: true },
      s.owner,
    );
    assert.equal(paid.status, 201);
    const saved = await paid.json();
    const client = await s.sdk(s.bearer);
    const tool = await client.callTool({
      name: 'get_loan_servicing',
      arguments: { applicationId: id },
    });
    assert.equal(tool.isError, false);
    assert.deepEqual(tool.structuredContent, saved);
    const forged = await client.callTool({
      name: 'get_loan_servicing',
      arguments: { applicationId: id, schedule: [] },
    });
    assert.equal(forged.isError, true);
    assert.equal(
      (
        await s.request(
          `/applications/${id}/servicing/prepayment`,
          'POST',
          {
            version: 1,
            amount: 100000,
            mode: 'reduce_term',
            idempotencyKey: 'sdk-prepayment-v9',
            confirmed: true,
          },
          s.bearer,
        )
      ).status,
      403,
    );
    assert.equal(
      (await s.request(`/applications/${id}/servicing`, 'GET', undefined, bank)).status,
      200,
    );
  } finally {
    await s.close();
  }
});
