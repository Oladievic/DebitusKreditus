import type { D1Database } from '@cloudflare/workers-types';
import type { ExecutionContext } from 'hono';
import { createApp } from './app';
import { initializeDatabase } from './seed';
import { createD1Database } from './runtime/d1';

interface Environment {
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const applications = new WeakMap<
  D1Database,
  { app: ReturnType<typeof createApp>; ready: Promise<void> }
>();
const clientRoutes = new Set([
  '/welcome',
  '/applications',
  '/products',
  '/business',
  '/simulator',
  '/documents',
  '/feed',
  '/integrations',
  '/settings',
  '/legal',
  '/bank',
  '/admin',
  '/assistant',
]);
const isClientRoute = (pathname: string) => {
  const route = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return clientRoutes.has(route) || /^\/applications\/[A-Za-z0-9_-]+$/.test(route);
};

export default {
  async fetch(request: Request, env: Environment, context: ExecutionContext) {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith('/api/') && pathname !== '/mcp') {
      const asset = await env.ASSETS.fetch(request);
      if (
        asset.status === 404 &&
        ['GET', 'HEAD'].includes(request.method) &&
        isClientRoute(pathname)
      ) {
        return env.ASSETS.fetch(new Request(new URL('/', request.url), request));
      }
      return asset;
    }
    let entry = applications.get(env.DB);
    if (!entry) {
      const db = createD1Database(env.DB);
      entry = { app: createApp(db), ready: initializeDatabase(db).then(() => undefined) };
      applications.set(env.DB, entry);
      entry.ready.catch(() => applications.delete(env.DB));
    }
    await entry.ready;
    return entry.app.fetch(request, undefined, context);
  },
};
