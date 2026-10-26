import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import path from 'node:path';
import { freemem } from 'node:os';
import { configureLocalAI } from './local-ai.js';
import { createApp } from './app';
import { initializeDatabase } from './seed';
import { openSqliteDatabase } from './runtime/sqlite';
import { localHostGuard } from './local-security';

const hostname = process.env.HOST ?? '127.0.0.1';
const db = openSqliteDatabase(process.env.DATABASE_PATH ?? 'data/debitus-kreditus.sqlite');
db.migrate(path.resolve('migrations'));
await initializeDatabase(db);
const app = new Hono();
app.use('*', localHostGuard({ hostname, appOrigin: process.env.APP_ORIGIN }));
app.route(
  '/',
  createApp(db, {
    allowedOrigins: process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : [],
    localAI: configureLocalAI(process.env, { freeMemory: freemem }),
  }),
);
app.all('/api/*', (c) => c.json({ error: 'Метод API не найден', code: 'not_found' }, 404));
app.all('/mcp', (c) => c.json({ error: 'Метод MCP не найден', code: 'not_found' }, 404));
const staticRoot = process.env.STATIC_DIRECTORY ?? './dist/client';
app.use('*', serveStatic({ root: staticRoot }));
app.all('/assets/*', (c) => c.notFound());
app.get('*', serveStatic({ path: path.join(staticRoot, 'index.html') }));

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Некорректный PORT');
const server = serve({ fetch: app.fetch, port, hostname }, ({ port: actualPort }) => {
  console.log(`Debitus-Kreditus: http://${hostname}:${actualPort}`);
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    db.close();
  });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
