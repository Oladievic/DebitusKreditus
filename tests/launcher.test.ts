import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const source = path.resolve('scripts');

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'debitus launcher-'));
  const scripts = path.join(root, 'scripts');
  const cache = path.join(root, '.cache', 'launcher');
  await mkdir(scripts, { recursive: true });
  await mkdir(cache, { recursive: true });
  await Promise.all(
    ['start-local.mjs', 'launcher-state.mjs'].map((name) =>
      copyFile(path.join(source, name), path.join(scripts, name)),
    ),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = path.join(cache, 'instance.json');
  const project = createHash('sha256')
    .update(process.platform === 'win32' ? root.toLowerCase() : root)
    .digest('hex');
  const put = (state: Record<string, unknown>) => writeFile(stateFile, JSON.stringify(state));
  const run = (args = ['--stop', '--no-browser']) =>
    command(process.execPath, [path.join(scripts, 'start-local.mjs'), ...args], root);
  return { root, scripts, stateFile, project, put, run };
}

function command(file: string, args: string[], cwd: string) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', NODE_PENDING_PIPE_INSTANCES: '32' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (bytes) => (output += bytes.toString()));
    child.stderr.on('data', (bytes) => (output += bytes.toString()));
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Launcher test timed out. ${output}`));
    }, 25000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}

async function guard(t: TestContext): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, ['-e', "console.log('READY');setInterval(()=>{},1000)"], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', () => resolve());
    child.once('exit', () => reject(new Error('Guard fixture exited before readiness.')));
  });
  return child;
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function close(server: Server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function unusedPort() {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function absent(filename: string) {
  await assert.rejects(stat(filename), { code: 'ENOENT' });
}

test('launcher recovers a legacy lock whose live PID belongs to a newer unrelated process', async (t) => {
  const f = await fixture(t);
  const unrelated = await guard(t);
  await f.put({ project: f.project, instance: 'legacy', pid: unrelated.pid });
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await utimes(f.stateFile, yesterday, yesterday);
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  await absent(f.stateFile);
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
});

test('launcher removes a dead owner lock on Stop without starting dependency checks or servers', async (t) => {
  const f = await fixture(t);
  const dead = await guard(t);
  const pid = dead.pid!;
  dead.kill();
  await new Promise<void>((resolve) => dead.once('exit', () => resolve()));
  await f.put({ project: f.project, instance: 'dead-owner', pid });
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.doesNotMatch(result.output, /Запускаем кабинет|Устанавливаем зависимости|ENOENT/);
  await absent(f.stateFile);
});

test('launcher detects reused PID from a different recorded process identity without signalling it', async (t) => {
  const f = await fixture(t);
  const unrelated = await guard(t);
  await f.put({
    project: f.project,
    instance: 'previous-owner',
    pid: unrelated.pid,
    processIdentity: { id: 'old-process', startedAtMs: Date.now() - 86400000 },
  });
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  await absent(f.stateFile);
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
});

test('ready launch is reused and stopped only through its authenticated control endpoint', async (t) => {
  const f = await fixture(t);
  const ownFixture = await guard(t);
  const instance = 'authenticated-owner-fixture';
  const address = 'http://127.0.0.1:5173';
  let stopRequests = 0;
  let active = true;
  const server = createServer((request, response) => {
    assert.equal(request.url, '/instance');
    assert.equal(request.headers['x-debitus-launcher'], instance);
    assert.equal(request.headers.origin, undefined);
    if (!active) return void response.writeHead(404).end();
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        project: f.project,
        instance,
        pid: ownFixture.pid,
        phase: 'ready',
        url: address,
      }),
    );
    if (request.method === 'POST') {
      stopRequests++;
      active = false;
    }
  });
  const controlPort = await listen(server);
  t.after(() => close(server));
  await f.put({ project: f.project, instance, pid: ownFixture.pid, controlPort, phase: 'ready' });
  const original = await readFile(f.stateFile, 'utf8');
  const duplicate = await f.run(['--no-browser']);
  assert.equal(duplicate.code, 0, duplicate.output);
  assert.match(duplicate.output, /уже запущен/);
  assert.equal(await readFile(f.stateFile, 'utf8'), original);
  assert.equal(stopRequests, 0);
  const stopped = await f.run();
  assert.equal(stopped.code, 0, stopped.output);
  assert.equal(stopRequests, 1);
  assert.equal(ownFixture.exitCode, null);
  assert.equal(ownFixture.signalCode, null);
});

test('an identified live owner without control response is preserved instead of being reclaimed', async (t) => {
  const f = await fixture(t);
  const owner = await guard(t);
  const helper = await import(pathToFileURL(path.join(f.scripts, 'launcher-state.mjs')).href);
  const identity = await helper.getProcessIdentity(owner.pid);
  assert.ok(identity?.id, 'Process identity must be available on supported test platforms.');
  await f.put({
    project: f.project,
    instance: 'unresponsive-but-current-owner',
    pid: owner.pid,
    processIdentity: identity,
    controlPort: await unusedPort(),
    phase: 'ready',
  });
  const original = await readFile(f.stateFile, 'utf8');
  const result = await f.run();
  assert.equal(result.code, 1, result.output);
  assert.equal(await readFile(f.stateFile, 'utf8'), original);
  assert.equal(owner.exitCode, null);
  assert.equal(owner.signalCode, null);
});

test('damaged and foreign-project lock files receive explicit diagnostics and are preserved', async (t) => {
  const f = await fixture(t);
  for (const bytes of ['', '{"project":', JSON.stringify({ project: 'another-project', pid: 1 })]) {
    await writeFile(f.stateFile, bytes);
    const result = await f.run();
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /поврежд|некоррект|состояни|друг|папк|проект|каталог/i);
    assert.equal(await readFile(f.stateFile, 'utf8'), bytes);
  }
});

test('two concurrent stale Stop requests do not start servers or leave a replacement lock', async (t) => {
  const f = await fixture(t);
  const unrelated = await guard(t);
  await f.put({
    project: f.project,
    instance: 'stale-before-concurrent-stops',
    pid: unrelated.pid,
    processIdentity: { id: 'former-process', startedAtMs: 1 },
  });
  const results = await Promise.all([f.run(), f.run()]);
  for (const result of results) {
    assert.equal(result.code, 0, result.output);
    assert.doesNotMatch(result.output, /Запускаем кабинет|Устанавливаем зависимости|ENOENT/);
  }
  await absent(f.stateFile);
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
});

test('Stop without a launcher file is a no-op', async (t) => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  await absent(f.stateFile);
  await delay(50);
  await absent(f.stateFile);
});

test('an occupied application port remains served by its unrelated owner after a rejected start', async (t) => {
  const f = await fixture(t);
  const unrelated = createServer((_request, response) => response.end('unrelated-owner'));
  const port = await listen(unrelated);
  t.after(() => close(unrelated));
  const result = await f.run([
    '--no-browser',
    '--web-port',
    String(port),
    '--api-port',
    String(await unusedPort()),
  ]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /занят|недоступен/);
  assert.equal(unrelated.listening, true);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'unrelated-owner');
  await absent(f.stateFile);
});
