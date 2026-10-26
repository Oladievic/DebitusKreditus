import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { localHostGuard } from '../server/local-security.js';

async function localServer(
  t: TestContext,
  settings: { hostname?: string; appOrigin?: string } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'debitus-local-security-'));
  const index = path.join(directory, 'index.html');
  await writeFile(index, '<html><body>Cabinet test</body></html>');
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/local.ts'], {
    cwd: path.resolve('.'),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOST: settings.hostname ?? '127.0.0.1',
      PORT: '0',
      APP_ORIGIN: settings.appOrigin ?? '',
      DATABASE_PATH: ':memory:',
      STATIC_DIRECTORY: directory,
      LOCAL_AI_ENABLED: '0',
    },
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill();
      await stopped;
    }
    await unlink(index);
    await rmdir(directory);
  });
  const port = await new Promise<number>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error(`Local server did not start: ${output}`)),
      15000,
    );
    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`Local server exited (${code}): ${output}`)));
    child.stderr.on('data', (chunk) => (output += String(chunk)));
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      const match = output.match(/Debitus-Kreditus: http:\/\/[^\s]+:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
  });
  const call = (
    host: string,
    route: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Promise<{ status: number; text: string; cookie?: string }>((resolve, reject) => {
      const bytes = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          path: route,
          method,
          headers: {
            host,
            ...(bytes
              ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) }
              : {}),
            ...headers,
          },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (text += chunk));
          res.once('end', () =>
            resolve({
              status: res.statusCode!,
              text,
              cookie: res.headers['set-cookie']?.[0].split(';')[0],
            }),
          );
        },
      );
      req.once('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('Local request timed out')));
      req.end(bytes);
    });
  return { call, port };
}

const credentials = { email: 'admin@debitus.example.test', password: 'Demo2026!' };

test('local HTTP boundary rejects DNS rebinding before pages, login, reads and MCP', async (t) => {
  const server = await localServer(t);
  for (const route of [
    '/',
    '/applications',
    '/api/health',
    '/api/auth/demo-accounts',
    '/api/auth/me',
    '/api/admin/overview',
    '/mcp',
  ]) {
    const response = await server.call(`attacker.example:${server.port}`, route, 'GET', undefined, {
      origin: `http://attacker.example:${server.port}`,
      'x-forwarded-host': '127.0.0.1',
      forwarded: 'host=localhost;proto=http',
    });
    assert.equal(response.status, 403, route);
    assert.equal(JSON.parse(response.text).error.code, 'HOST_DENIED', route);
    assert.equal(response.cookie, undefined, route);
  }
  for (const [route, body] of [
    ['/api/auth/login', credentials],
    ['/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }],
    ['/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }],
  ] as const) {
    const response = await server.call(`attacker.example:${server.port}`, route, 'POST', body, {
      origin: `http://attacker.example:${server.port}`,
    });
    assert.equal(response.status, 403, route);
    assert.equal(JSON.parse(response.text).error.code, 'HOST_DENIED', route);
    assert.equal(response.cookie, undefined, route);
  }
  for (const host of [
    `127.0.0.1:${server.port}`,
    `localhost:${server.port}`,
    `[::1]:${server.port}`,
  ]) {
    assert.equal((await server.call(host, '/')).status, 200, host);
    assert.equal((await server.call(host, '/api/health')).status, 200, host);
  }
  const validHost = `127.0.0.1:${server.port}`;
  const login = await server.call(validHost, '/api/auth/login', 'POST', credentials, {
    origin: `http://${validHost}`,
  });
  assert.equal(login.status, 200);
  assert.ok(login.cookie);
  assert.equal(
    (
      await server.call(validHost, '/api/admin/overview', 'GET', undefined, {
        cookie: login.cookie,
      })
    ).status,
    200,
  );
  const replay = await server.call(
    `attacker.example:${server.port}`,
    '/api/admin/overview',
    'GET',
    undefined,
    { cookie: login.cookie },
  );
  assert.equal(replay.status, 403);
  assert.equal(JSON.parse(replay.text).error.code, 'HOST_DENIED');
});

test('wildcard binding permits only loopback and the explicitly configured application hostname', async (t) => {
  const server = await localServer(t, {
    hostname: '0.0.0.0',
    appOrigin: 'http://cabinet.internal:3000',
  });
  for (const host of [`127.0.0.1:${server.port}`, `cabinet.internal:${server.port}`]) {
    assert.equal((await server.call(host, '/')).status, 200, host);
    const login = await server.call(host, '/api/auth/login', 'POST', credentials, {
      origin: `http://${host}`,
    });
    assert.equal(login.status, 200, host);
    assert.ok(login.cookie);
  }
  for (const host of [
    `unconfigured.internal:${server.port}`,
    `cabinet.internal.attacker.example:${server.port}`,
    `0.0.0.0:${server.port}`,
  ]) {
    const response = await server.call(host, '/api/health');
    assert.equal(response.status, 403, host);
    assert.equal(JSON.parse(response.text).error.code, 'HOST_DENIED', host);
  }
});

test('an explicit bind hostname is trusted without forwarding headers or implicit wildcard aliases', async () => {
  const app = new Hono();
  app.use('*', localHostGuard({ hostname: 'cabinet.internal' }));
  app.get('*', (c) => c.text('cabinet'));
  assert.equal((await app.request('http://cabinet.internal/api/health')).status, 200);
  assert.equal((await app.request('http://127.0.0.1/api/health')).status, 200);
  assert.equal(
    (
      await app.request('http://attacker.example/api/health', {
        headers: { host: 'cabinet.internal', 'x-forwarded-host': 'cabinet.internal' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await app.request('http://cabinet.internal/api/health', {
        headers: { host: 'attacker.example', 'x-forwarded-host': 'cabinet.internal' },
      })
    ).status,
    403,
  );
  for (const hostname of ['0.0.0.0', '::', '[::]']) {
    const wildcard = new Hono();
    wildcard.use('*', localHostGuard({ hostname }));
    wildcard.get('*', (c) => c.text('cabinet'));
    assert.equal((await wildcard.request('http://attacker.example/')).status, 403, hostname);
    assert.equal((await wildcard.request('http://localhost/')).status, 200, hostname);
  }
  for (const appOrigin of [
    '*',
    'https://cabinet.internal/path',
    'https://user:password@cabinet.internal',
    'ftp://cabinet.internal',
  ])
    assert.throws(() => localHostGuard({ hostname: '127.0.0.1', appOrigin }));
});
