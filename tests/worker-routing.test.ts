import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExecutionContext } from 'hono';
import worker from '../server/worker';

const context = {} as ExecutionContext;
function assetEnvironment(handler: (request: Request) => Response) {
  const requests: Request[] = [];
  return {
    requests,
    env: {
      get DB(): never {
        throw new Error('Database route selected');
      },
      ASSETS: {
        async fetch(request: Request) {
          requests.push(request);
          return handler(request);
        },
      },
    },
  };
}

test('Worker serves the application shell after asset 404 only for known client routes', async () => {
  for (const route of [
    '/welcome',
    '/bank',
    '/admin',
    '/assistant',
    '/business',
    '/applications',
    '/applications/new',
    '/applications/app_sever_working',
    '/applications/import_a12_0',
    '/products?product=equipment',
    '/simulator',
    '/documents',
    '/feed',
    '/integrations',
    '/settings',
    '/legal/',
  ]) {
    const { env, requests } = assetEnvironment((request) =>
      new URL(request.url).pathname === '/'
        ? new Response('<html><div id="root"></div></html>', {
            headers: { 'Content-Type': 'text/html' },
          })
        : new Response('asset missing', { status: 404 }),
    );
    const request = new Request(`https://cabinet.example${route}`, {
      headers: { Accept: 'text/html', 'X-Request-Test': 'kept' },
    });
    const response = await worker.fetch(request, env, context);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), /id="root"/);
    assert.equal(requests.length, 2, route);
    assert.equal(requests[0], request);
    assert.equal(requests[1].url, 'https://cabinet.example/');
    assert.equal(requests[1].method, 'GET');
    assert.equal(requests[1].headers.get('X-Request-Test'), 'kept');
  }
});

test('Worker preserves HEAD and asset response headers when falling back to the shell', async () => {
  const { env, requests } = assetEnvironment((request) =>
    new URL(request.url).pathname === '/'
      ? new Response(null, { headers: { 'Content-Type': 'text/html', ETag: 'shell-v4' } })
      : new Response(null, { status: 404 }),
  );
  const response = await worker.fetch(
    new Request('https://cabinet.example/bank', { method: 'HEAD' }),
    env,
    context,
  );
  assert.equal(response.status, 200);
  assert.equal(requests[1].method, 'HEAD');
  assert.equal(response.headers.get('etag'), 'shell-v4');
  assert.equal(await response.text(), '');
});

test('Worker does not replace missing assets, unknown routes, mutations or asset failures with HTML', async () => {
  for (const [pathname, method, status] of [
    ['/assets/missing.js', 'GET', 404],
    ['/favicon-missing.svg', 'GET', 404],
    ['/unknown', 'GET', 404],
    ['/applications/missing.js', 'GET', 404],
    ['/bank/extra', 'GET', 404],
    ['/', 'GET', 404],
    ['/welcome', 'POST', 404],
    ['/welcome', 'PUT', 404],
    ['/welcome', 'OPTIONS', 404],
    ['/welcome', 'GET', 500],
    ['/bank', 'GET', 403],
    ['/assets/existing.js', 'GET', 200],
  ] as const) {
    const original = new Response('original response', {
      status,
      headers: { 'X-Asset': 'unchanged' },
    });
    const { env, requests } = assetEnvironment(() => original);
    const response = await worker.fetch(
      new Request(`https://cabinet.example${pathname}`, { method }),
      env,
      context,
    );
    assert.equal(response, original, `${method} ${pathname} ${status}`);
    assert.equal(requests.length, 1);
  }
});

test('Worker routes API and MCP to the application and never catches their failures as asset fallbacks', async () => {
  for (const pathname of ['/api/health', '/api/missing', '/mcp']) {
    const { env, requests } = assetEnvironment(() => new Response('<html>wrong</html>'));
    await assert.rejects(
      worker.fetch(new Request(`https://cabinet.example${pathname}`), env, context),
      /Database route selected/,
    );
    assert.equal(requests.length, 0);
  }
});
