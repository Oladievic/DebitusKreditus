import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const windows = process.platform === 'win32';
const source = path.resolve('scripts');
const powershell = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

async function absent(filename: string) {
  await assert.rejects(stat(filename), { code: 'ENOENT' });
}

async function fixture(t: TestContext, tools: 'none' | 'node' | 'both') {
  const root = await mkdtemp(path.join(tmpdir(), 'Debitus запуск с пробелами-'));
  const scripts = path.join(root, 'scripts');
  const node = path.join(root, '.cache', 'runtime', 'node-v24.19.0-win-x64', 'node.exe');
  const pnpm = path.join(root, '.cache', 'runtime', 'pnpm', 'pnpm.cmd');
  const calls = path.join(root, 'pnpm-calls.jsonl');
  t.after(async () => {
    assert.ok(root.startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(scripts, { recursive: true });
  await Promise.all(
    ['start-local.ps1', 'runtime-tools.ps1', 'start-local.mjs', 'launcher-state.mjs'].map(
      (filename) => copyFile(path.join(source, filename), path.join(scripts, filename)),
    ),
  );
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'windows-launcher-fixture',
      version: '1.0.0',
      private: true,
      type: 'module',
      packageManager: 'pnpm@11.25.0',
      engines: { node: '>=24.19.0 <25' },
      dependencies: {},
      devDependencies: {},
    }),
  );
  await mkdir(path.join(root, 'node_modules', '.pnpm'), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, 'node_modules', '.modules.yaml'), ''),
    writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n'),
    writeFile(path.join(root, 'node_modules', '.pnpm', 'lock.yaml'), 'lockfileVersion: "9.0"\n'),
  ]);
  if (tools !== 'none') {
    await mkdir(path.dirname(node), { recursive: true });
    await link(process.execPath, node).catch(() => copyFile(process.execPath, node));
  }
  if (tools === 'both') {
    await mkdir(path.dirname(pnpm), { recursive: true });
    await writeFile(
      pnpm,
      '@echo off\r\nnode.exe "%~dp0version.cjs" %*\r\nexit /b %errorlevel%\r\n',
    );
    await writeFile(
      path.join(path.dirname(pnpm), 'version.cjs'),
      `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + String.fromCharCode(10));
if (args.length !== 1 || args[0] !== '--version') throw new Error('Unexpected package installation');
console.log('11.25.0');
`,
    );
  }
  const run = (args: string[]) =>
    new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (
          /^(path|node_options|node_path|node_pending_pipe_instances|pnpm_home|npm_config_prefix|userprofile|appdata|localappdata|programfiles|programfiles\(x86\)|programw6432)$/i.test(
            key,
          )
        )
          delete env[key];
      }
      Object.assign(env, {
        PATH: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'),
        USERPROFILE: path.join(root, 'user'),
        APPDATA: path.join(root, 'user', 'AppData', 'Roaming'),
        LOCALAPPDATA: path.join(root, 'user', 'AppData', 'Local'),
        ProgramFiles: path.join(root, 'Program Files'),
        'ProgramFiles(x86)': path.join(root, 'Program Files (x86)'),
        ProgramW6432: path.join(root, 'Program Files'),
      });
      const child = spawn(
        powershell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(scripts, 'start-local.ps1'),
          ...args,
        ],
        { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      child.stdout.on('data', (chunk) => (output += chunk.toString('utf8')));
      child.stderr.on('data', (chunk) => (output += chunk.toString('utf8')));
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Windows launcher fixture timed out. ${output}`));
      }, 15000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        resolve({ code, output });
      });
    });
  return { root, node, pnpm, calls, run };
}

test(
  'Windows script finds project tools without Node in Explorer PATH',
  { skip: !windows },
  async (t) => {
    const f = await fixture(t, 'both');
    const result = await f.run(['-Check', '-NoInstall', '-NoBrowser']);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Окружение готово/);
    assert.match(result.output, /Проверка завершена/);
    const calls = (await readFile(f.calls, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.ok(calls.length > 0);
    for (const call of calls) assert.deepEqual(call, ['--version']);
    await absent(path.join(f.root, '.cache', 'launcher', 'instance.json'));
  },
);

test(
  'Windows Check and NoInstall fail without downloading missing tools',
  { skip: !windows },
  async (t) => {
    const f = await fixture(t, 'none');
    for (const args of [
      ['-Check', '-NoBrowser'],
      ['-NoInstall', '-NoBrowser'],
    ]) {
      const result = await f.run(args);
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, /Node\.js/);
      assert.doesNotMatch(result.output, /Загружаем Node|Устанавливаем pnpm|Запускаем кабинет/);
      await absent(f.node);
      await absent(f.pnpm);
      await absent(path.join(f.root, '.cache', 'runtime'));
      await absent(path.join(f.root, '.cache', 'launcher', 'instance.json'));
    }
  },
);

test(
  'Windows Check reports missing pnpm while preserving cached Node',
  { skip: !windows },
  async (t) => {
    const f = await fixture(t, 'node');
    const result = await f.run(['-Check', '-NoInstall', '-NoBrowser']);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /pnpm/i);
    assert.doesNotMatch(result.output, /Устанавливаем pnpm|Запускаем кабинет/);
    assert.ok((await stat(f.node)).isFile());
    await absent(f.pnpm);
    await absent(path.join(f.root, '.cache', 'launcher', 'instance.json'));
  },
);

test(
  'Windows Stop without an instance succeeds without any tools',
  { skip: !windows },
  async (t) => {
    const f = await fixture(t, 'none');
    const result = await f.run(['-Stop', '-NoBrowser']);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /не найден|уже остановлен/);
    assert.doesNotMatch(result.output, /Загружаем Node|Устанавливаем pnpm|Запускаем кабинет/);
    await absent(f.node);
    await absent(f.pnpm);
    await absent(path.join(f.root, '.cache', 'launcher', 'instance.json'));
  },
);

test(
  'Windows Stop contacts its authenticated owner without requiring pnpm',
  { skip: !windows },
  async (t) => {
    const f = await fixture(t, 'node');
    const helper = await import(
      pathToFileURL(path.join(f.root, 'scripts', 'launcher-state.mjs')).href
    );
    const identity = await helper.getProcessIdentity(process.pid);
    assert.ok(identity?.id, 'The live test process must have a Windows process identity.');
    const project = createHash('sha256').update(f.root.toLowerCase()).digest('hex');
    const instance = 'windows-stop-owner-fixture';
    let active = true;
    let stopRequests = 0;
    const server = createServer((request, response) => {
      assert.equal(request.url, '/instance');
      assert.equal(request.headers['x-debitus-launcher'], instance);
      assert.equal(request.headers.origin, undefined);
      if (!active) return void response.writeHead(404).end();
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          project,
          instance,
          pid: process.pid,
          phase: 'ready',
          url: 'http://127.0.0.1:5173',
        }),
      );
      if (request.method === 'POST') {
        stopRequests++;
        active = false;
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const stateDirectory = path.join(f.root, '.cache', 'launcher');
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(
      path.join(stateDirectory, 'instance.json'),
      JSON.stringify({
        project,
        instance,
        pid: process.pid,
        processIdentity: identity,
        controlPort: address.port,
        phase: 'ready',
        webPort: 5173,
        apiPort: 8787,
        url: 'http://127.0.0.1:5173',
      }),
    );
    const result = await f.run(['-Stop', '-NoInstall', '-NoBrowser']);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Собственный локальный запуск остановлен/);
    assert.equal(stopRequests, 1);
    assert.equal(active, false);
    assert.equal(process.kill(process.pid, 0), true);
    assert.ok((await stat(f.node)).isFile());
    await absent(f.pnpm);
    await absent(f.calls);
  },
);
