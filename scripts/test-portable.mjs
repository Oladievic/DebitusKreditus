import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const bundle = path.resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Укажите папку переносимой сборки.');
const runDirectory = path.join(root, '.cache', `portable-test-${Date.now()}`);
const isolated = path.join(runDirectory, 'isolated');
await mkdir(runDirectory, { recursive: true });
await cp(bundle, isolated, { recursive: true });
const runtime = path.join(isolated, 'runtime', 'node.exe');
const launcher = path.join(isolated, 'run.mjs');
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const fixture = path.join(runDirectory, 'persistence.json');
const analysisFixture = path.join(runDirectory, 'analysis-persistence.json');
const servicingFixture = path.join(runDirectory, 'servicing-persistence.json');
const testEnv = { ...process.env, PATH: '', LOCAL_AI_ENABLED: '0' };
delete testEnv.NODE_OPTIONS;
delete testEnv.NODE_PATH;
const helperEnv = {
  ...process.env,
  LOCAL_WORKER_URL: base,
  PERSISTENCE_BASE_URL: base,
  PERSISTENCE_FIXTURE: fixture,
  PERSISTENCE_ALLOW_LOCAL: 'true',
  ANALYSIS_SMOKE_URL: base,
  ANALYSIS_SMOKE_FIXTURE: analysisFixture,
  SERVICING_SMOKE_URL: base,
  SERVICING_SMOKE_FIXTURE: servicingFixture,
};
let running, guarded, browser;
const report = {
  bundle,
  isolated,
  base,
  checks: [],
  browserExternalRequests: [],
  serverExternalRequests: [],
};

function start(file, args, options = {}) {
  const process = spawn(file, args, {
    cwd: isolated,
    env: testEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...options,
  });
  let output = '';
  process.stdout.on('data', (data) => {
    output += data.toString();
  });
  process.stderr.on('data', (data) => {
    output += data.toString();
  });
  const done = new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', (code) => resolve({ code, output }));
  });
  return { process, done, output: () => output };
}
async function command(file, args, options) {
  const result = await start(file, args, options).done;
  assert.equal(result.code, 0, result.output);
  return result.output;
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Сервер не готов. ${running?.output() ?? ''} ${guarded?.output() ?? ''}`);
}
async function stop() {
  if (running?.process.exitCode === null) {
    await command(runtime, [launcher, '--stop']);
    assert.equal((await running.done).code, 0);
    running = null;
  }
}
try {
  await command(runtime, [launcher, '--check']);
  report.checks.push('SHA-256 completeness, runtime identity');
  const stateFile = path.join(isolated, 'data', '.launcher.json');
  await mkdir(path.dirname(stateFile), { recursive: true });
  const staleState = async () => {
    await writeFile(
      stateFile,
      JSON.stringify({
        project: createHash('sha256').update(isolated.toLowerCase()).digest('hex'),
        token: 'stale-test-instance',
        pid: process.pid,
      }),
    );
    const previousDay = new Date(Date.now() - 86400000);
    await utimes(stateFile, previousDay, previousDay);
  };
  await staleState();
  const staleStop = await command(runtime, [launcher, '--stop']);
  assert.match(staleStop, /Устаревшее состояние/);
  assert.equal(existsSync(stateFile), false);
  process.kill(process.pid, 0);
  report.checks.push(
    'Stop recovers legacy reused PID without starting a server or stopping its current owner',
  );
  await staleState();
  running = start(runtime, [launcher, '--port', String(port), '--no-browser']);
  await ready();
  assert.match(running.output(), /Устаревшее состояние/);
  process.kill(process.pid, 0);
  report.checks.push('Start recovers legacy reused PID and leaves its current owner alive');
  const duplicate = await command(runtime, [launcher, '--port', String(port), '--no-browser']);
  assert.match(duplicate, /уже запущен/);
  report.checks.push('Start without PATH, npm, pnpm or Docker; repeated launch reuses own process');
  await command(process.execPath, [path.join(root, 'scripts', 'smoke-cloud.mjs')], {
    cwd: root,
    env: helperEnv,
  });
  await command(process.execPath, [path.join(root, 'scripts', 'check-persistence.mjs'), 'before'], {
    cwd: root,
    env: helperEnv,
  });
  report.checks.push('Client → bank → approved → signed → funded, idempotent issue');
  await command(process.execPath, [path.join(root, 'scripts', 'smoke-analysis.mjs')], {
    cwd: root,
    env: helperEnv,
  });
  report.checks.push(
    'CSV preview/save with frozen source, financing navigator, cashflow and three MCP tools match HTTP; bank reads submitted report without edit access',
  );
  await command(process.execPath, [path.join(root, 'scripts', 'smoke-servicing.mjs')], {
    cwd: root,
    env: helperEnv,
  });
  report.checks.push(
    'Action plan, read-only financing alternatives, bank before/after comparison and funded servicing close with four idempotent operations; four MCP tools match HTTP',
  );

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'ru-RU',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      report.browserExternalRequests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const login = await context.request.post(`${base}/api/auth/login`, {
    data: { email: 'owner@sever.example.test', password: 'Demo2026!' },
  });
  assert.equal(login.ok(), true);
  for (const route of ['/feed', '/products', '/simulator', '/assistant', '/integrations']) {
    await page.goto(base + route);
    await expect(page.locator('main')).toBeVisible();
  }
  await page.goto(`${base}/applications/new`);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('button', { name: 'Распознать документ', exact: true }).click();
  await page
    .getByLabel('Файл для распознавания')
    .setInputFiles(path.join(isolated, 'client', 'fixtures', 'financial-scan.pdf'));
  const text = page.getByLabel('Распознанный текст', { exact: true });
  await expect(text).toBeVisible({ timeout: 120000 });
  await expect(text).toHaveValue(/Выручка/i);
  await page.screenshot({ path: path.join(runDirectory, 'offline-ocr.png'), fullPage: true });
  assert.deepEqual(errors, [], 'Browser errors');
  assert.deepEqual(report.browserExternalRequests, [], 'Unexpected external browser dependency');
  report.checks.push(
    'Production pages and real Russian PDF OCR with all non-local browser requests blocked',
  );
  await browser.close();
  browser = null;
  await stop();
  running = start(runtime, [launcher, '--port', String(port), '--no-browser']);
  await ready();
  await command(process.execPath, [path.join(root, 'scripts', 'check-persistence.mjs'), 'after'], {
    cwd: root,
    env: helperEnv,
  });
  await command(
    process.execPath,
    [path.join(root, 'scripts', 'smoke-analysis.mjs'), '--verify-saved'],
    {
      cwd: root,
      env: helperEnv,
    },
  );
  await command(
    process.execPath,
    [path.join(root, 'scripts', 'smoke-servicing.mjs'), '--verify-saved'],
    { cwd: root, env: helperEnv },
  );
  await stop();
  report.checks.push('Application, document bytes and history survive stop/start');
  report.checks.push(
    'Statement analysis, declared-finance snapshot and original BOM CSV survive stop/start',
  );
  report.checks.push(
    'Closed servicing ledger, unchanged funded offer and all four idempotent responses survive stop/start',
  );

  const guard = path.join(runDirectory, 'network-guard.mjs');
  await writeFile(
    guard,
    `import net from 'node:net';\nimport {syncBuiltinESMExports} from 'node:module';\nconst allowed=h=>['127.0.0.1','localhost','::1','[::1]'].includes(h);\nconst deny=h=>{console.error('OUTBOUND_BLOCKED '+h);throw new Error('External network blocked for offline verification');};\nconst connect=net.Socket.prototype.connect;\nnet.Socket.prototype.connect=function(...args){let a=Array.isArray(args[0])?args[0]:args;let o=a[0];let h=typeof o==='object'?o.host:(typeof a[1]==='string'?a[1]:'localhost');if(h&&!allowed(h))deny(h);return connect.apply(this,args);};\nconst originalFetch=globalThis.fetch;\nglobalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!allowed(u.hostname))deny(u.hostname);return originalFetch(input,options);};\nsyncBuiltinESMExports();\ntry{await fetch('https://offline-probe.invalid');}catch(e){console.log('OFFLINE_GUARD_READY');}\n`,
  );
  guarded = start(
    runtime,
    ['--import', pathToFileURL(guard).href, path.join(isolated, 'app', 'index.js')],
    {
      env: {
        ...testEnv,
        PORT: String(port),
        HOST: '127.0.0.1',
        APP_ORIGIN: base,
        DATABASE_PATH: path.join(isolated, 'data', 'debitus-kreditus.sqlite'),
        STATIC_DIRECTORY: path.join(isolated, 'client'),
      },
    },
  );
  await ready();
  await command(process.execPath, [path.join(root, 'scripts', 'smoke-cloud.mjs')], {
    cwd: root,
    env: helperEnv,
  });
  const guardedAnalysisEnv = { ...helperEnv };
  delete guardedAnalysisEnv.ANALYSIS_SMOKE_FIXTURE;
  await command(process.execPath, [path.join(root, 'scripts', 'smoke-analysis.mjs')], {
    cwd: root,
    env: guardedAnalysisEnv,
  });
  const guardedServicingEnv = { ...helperEnv };
  delete guardedServicingEnv.SERVICING_SMOKE_FIXTURE;
  await command(process.execPath, [path.join(root, 'scripts', 'smoke-servicing.mjs')], {
    cwd: root,
    env: guardedServicingEnv,
  });
  const lines = guarded
    .output()
    .split(/\r?\n/)
    .filter((line) => line.startsWith('OUTBOUND_BLOCKED '));
  report.serverExternalRequests = lines.filter(
    (line) => line !== 'OUTBOUND_BLOCKED offline-probe.invalid',
  );
  assert.deepEqual(lines, ['OUTBOUND_BLOCKED offline-probe.invalid']);
  assert.match(guarded.output(), /OFFLINE_GUARD_READY/);
  guarded.process.kill('SIGTERM');
  await guarded.done;
  guarded = null;
  report.checks.push(
    'Full credit journey with external server sockets/fetch blocked (guard self-test passed)',
  );
  report.checks.push(
    'CSV, navigator, cashflow, MCP and bank dossier complete with external server sockets/fetch blocked',
  );
  report.checks.push(
    'Action plan, alternatives, bank comparison, payment and full early repayment complete with external server sockets/fetch blocked',
  );

  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(port, '127.0.0.1', resolve));
  const rejected = await start(runtime, [launcher, '--port', String(port), '--no-browser']).done;
  assert.equal(rejected.code, 1);
  assert.match(rejected.output, /занят/);
  assert.equal(occupied.listening, true);
  await new Promise((resolve) => occupied.close(resolve));
  report.checks.push('Occupied port rejected without stopping another process');
  const original = await readFile(path.join(isolated, 'app', 'index.js'));
  await writeFile(path.join(isolated, 'app', 'index.js'), 'corrupt');
  const corruption = await start(runtime, [launcher, '--check']).done;
  assert.equal(corruption.code, 1);
  assert.match(corruption.output, /повреждён/);
  await writeFile(path.join(isolated, 'app', 'index.js'), original);
  report.checks.push('Modified/missing bundle content blocks startup with recovery instructions');
  assert.equal(report.checks.length, 16, 'Неполный набор офлайн-проверок.');
  report.passed = true;
} finally {
  await browser?.close();
  await stop();
  if (guarded?.process.exitCode === null) {
    guarded.process.kill('SIGTERM');
    await guarded.done;
  }
  await writeFile(path.join(runDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(
  JSON.stringify({ ...report, reportPath: path.join(runDirectory, 'report.json') }, null, 2),
);

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
