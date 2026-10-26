import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  getProcessIdentity,
  launcherOwnerIsGone,
  readLauncherState,
  withLauncherStateLock,
  writeLauncherState,
} from './launcher-state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const args = process.argv.slice(2);
const value = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const webPort = Number(value('--web-port', '5173'));
const apiPort = Number(value('--api-port', '8787'));
const check = args.includes('--check'),
  smoke = args.includes('--smoke');
const noBrowser = args.includes('--no-browser') || smoke || check;
const cache = path.join(root, '.cache', 'launcher');
const stateFile = path.join(cache, 'instance.json');
const instance = randomBytes(24).toString('hex');
const project = createHash('sha256')
  .update(process.platform === 'win32' ? root.toLowerCase() : root)
  .digest('hex');
const url = `http://127.0.0.1:${webPort}`;
const logFile = path.join(cache, `launch-${Date.now()}-${process.pid}.log`);
const children = new Set();
let control,
  owner = false,
  stopping = false,
  exitCode = 0,
  phase = 'preparing',
  processIdentity;

async function log(message) {
  console.log(message);
  await appendFile(logFile, `${new Date().toISOString()} ${message}\n`).catch(() => {});
}
async function readState() {
  return (await readLauncherState(stateFile))?.value ?? null;
}
async function contact(state, method = 'GET') {
  if (
    !state ||
    state.project !== project ||
    !Number.isInteger(state.controlPort) ||
    !state.instance
  )
    return null;
  try {
    const response = await fetch(`http://127.0.0.1:${state.controlPort}/instance`, {
      method,
      headers: { 'X-Debitus-Launcher': state.instance },
      signal: AbortSignal.timeout(1200),
    });
    const body = await response.json();
    return response.ok && body.project === project && body.instance === state.instance
      ? body
      : null;
  } catch {
    return null;
  }
}
async function saveState() {
  await withLauncherStateLock(stateFile, async () => {
    if ((await readState())?.instance !== instance)
      throw new Error('Состояние запуска изменилось. Повторите запуск.');
    await writeLauncherState(stateFile, {
      project,
      instance,
      pid: process.pid,
      processIdentity,
      controlPort: control.address().port,
      webPort,
      apiPort,
      phase,
      url,
    });
  });
}
async function openBrowser(address) {
  if (noBrowser) return;
  const port = new URL(address).port;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(address)) throw new Error('Неверный локальный адрес.');
  const child = spawn(
    path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    ['-NoLogo', '-NoProfile', '-Command', `Start-Process 'http://127.0.0.1:${port}'`],
    { windowsHide: true, stdio: 'ignore' },
  );
  child.on('error', () => console.log(`Откройте адрес вручную: ${address}`));
  child.unref();
}
async function ensureFree(port) {
  const socket = createTcpServer();
  await new Promise((resolve, reject) => {
    socket.once('error', () =>
      reject(
        new Error(
          `Порт ${port} занят или недоступен. Чужой процесс не остановлен. Используйте -WebPort / -ApiPort или завершите свой прежний запуск.`,
        ),
      ),
    );
    socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32' && child.pid) {
        const stop = spawn(
          path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' },
        );
        stop.on('error', () => child.kill('SIGTERM'));
      } else child.kill('SIGTERM');
    }
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          const timer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            resolve();
          }, 4000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    ),
  );
  if (control) {
    control.closeAllConnections();
    await new Promise((resolve) => control.close(resolve));
  }
  if (owner)
    await withLauncherStateLock(stateFile, async () => {
      if ((await readState())?.instance === instance) await unlink(stateFile).catch(() => {});
    });
  process.exitCode = exitCode;
}
function launch(file, parameters, env, label) {
  const child = spawn(file, parameters, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.stdout.resume();
  child.stderr.resume();
  child.on('error', () => {
    void log(`Не удалось запустить ${label}. Проверьте установку зависимостей.`);
    void shutdown(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      void log(
        `${label} остановлен (код ${code ?? 'сигнал'}). Для подробной диагностики выполните pnpm dev в терминале.`,
      );
      void shutdown(1);
    }
  });
  return child;
}
async function runPnpm(pnpm, parameters) {
  if (!existsSync(pnpm))
    throw new Error(
      'Не найден pnpm. Установите pnpm версии из package.json: npm install --global pnpm@11.25.0. Скрипт сам не меняет системные настройки.',
    );
  const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(pnpm);
  if (batch && /["%!^&|<>\r\n]/.test(pnpm))
    throw new Error(
      'Путь pnpm содержит символы командной оболочки. Используйте pnpm.exe или путь без этих символов.',
    );
  const executable = batch
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
    : pnpm;
  const parametersSafe = batch
    ? ['/d', '/s', '/c', `""${pnpm}" ${parameters.join(' ')}"`]
    : parameters;
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, parametersSafe, {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true' },
      ...(batch ? { windowsVerbatimArguments: true } : {}),
    });
    children.add(child);
    let output = '';
    child.stdout.on('data', (chunk) => {
      if (output.length < 32000) output += chunk.toString();
    });
    child.stderr.resume();
    child.on('error', () =>
      reject(new Error('Не удалось запустить pnpm. Проверьте путь к менеджеру пакетов.')),
    );
    child.on('exit', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error(
              `pnpm завершился с кодом ${code}. Проверьте сеть и выполните pnpm install --frozen-lockfile в терминале. Файлы lock не изменялись скриптом.`,
            ),
          ),
    );
  });
}
async function dependencies(manifest, pnpm) {
  const version = await runPnpm(pnpm, ['--version']);
  const expected = manifest.packageManager.split('@').at(-1);
  if (version !== expected)
    throw new Error(
      `Нужен pnpm ${expected}. Выполните npm install --global pnpm@${expected} и повторите запуск.`,
    );
  let ready = existsSync('node_modules/.modules.yaml');
  for (const [name, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    try {
      if (
        JSON.parse(await readFile(path.join('node_modules', name, 'package.json'), 'utf8'))
          .version !== version
      )
        ready = false;
    } catch {
      ready = false;
    }
  }
  const lock = await readFile('pnpm-lock.yaml', 'utf8');
  const installedLock = await readFile('node_modules/.pnpm/lock.yaml', 'utf8').catch(() => '');
  if (lock.replaceAll('\r\n', '\n') !== installedLock.replaceAll('\r\n', '\n')) ready = false;
  if (!ready) {
    if (check || args.includes('--no-install'))
      throw new Error(
        'Зависимости отсутствуют или не соответствуют проекту. Обычный запуск установит их по lock-файлу; для проверки установки нужен доступ к сети.',
      );
    await log(
      'Устанавливаем зависимости по pnpm-lock.yaml. Первая установка может занять несколько минут.',
    );
    await runPnpm(pnpm, ['install', '--frozen-lockfile', '--prefer-offline']);
  }
  await log(`Окружение готово: Node.js ${process.versions.node}, pnpm ${expected}.`);
}
async function waitReady() {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (stopping) throw new Error('Сервер завершился до готовности.');
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
      const body = await response.json();
      const page = await fetch(url, { signal: AbortSignal.timeout(1000) });
      const entry = await fetch(`${url}/src/main.tsx`, { signal: AbortSignal.timeout(1500) });
      if (
        response.ok &&
        body.ok === true &&
        body.moneyUnit === 'RUB_INTEGER' &&
        page.ok &&
        entry.ok &&
        (await page.text()).includes('id="root"')
      )
        return;
    } catch {}
    await delay(500);
  }
  throw new Error(
    'Приложение не стало готово за отведённое время. Повторите запуск; для подробностей выполните pnpm dev в терминале.',
  );
}
async function existing() {
  for (let attempt = 0; attempt < 6; attempt++) {
    const state = await readState();
    const status = await contact(state);
    if (status) {
      if (args.includes('--stop')) {
        await contact(state, 'POST');
        for (let wait = 0; wait < 16; wait++) {
          if (!(await contact(state))) {
            await log('Собственный локальный запуск остановлен.');
            return true;
          }
          await delay(300);
        }
        throw new Error(
          'Остановка запрошена, но ещё не подтверждена. Проверьте окно первого запуска.',
        );
      }
      await log(`Кабинет уже запущен: ${status.url}. Второй сервер не создаётся.`);
      if (status.phase === 'ready') await openBrowser(status.url);
      else
        await log('Первый запуск ещё готовит приложение и сам откроет браузер после готовности.');
      return true;
    }
    const recovered = await withLauncherStateLock(stateFile, async () => {
      const record = await readLauncherState(stateFile);
      if (!record) return true;
      if (!record.value || !Number.isInteger(record.value.pid) || record.value.pid <= 0)
        throw new Error(
          'Файл состояния запуска повреждён: .cache/launcher/instance.json. Серверы и данные не изменены.',
        );
      if (record.value.project !== project)
        throw new Error(
          'Файл состояния относится к другой папке проекта: .cache/launcher/instance.json. Серверы и данные не изменены.',
        );
      if (!(await launcherOwnerIsGone(record))) return false;
      await unlink(stateFile);
      return true;
    });
    if (recovered) {
      await log('Устаревшее состояние запуска сброшено. Другие процессы не затронуты.');
      return false;
    }
    await delay(350);
  }
  throw new Error(
    'Процесс прежнего запуска существует, но не отвечает. Его состояние сохранено. Проверьте прежнее окно запуска; другие процессы не остановлены.',
  );
}
async function main() {
  await mkdir(cache, { recursive: true });
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 19)
    throw new Error(
      'Нужен Node.js >=24.19.0 и <25. Установите подходящий выпуск ветки 24 с nodejs.org.',
    );
  if (
    ![webPort, apiPort].every((port) => Number.isInteger(port) && port >= 1024 && port <= 65535) ||
    webPort === apiPort
  )
    throw new Error('Укажите разные порты в диапазоне 1024–65535.');
  if (args.includes('--stop') && !existsSync(stateFile))
    return await log('Локальный запуск этим скриптом не найден. Другие процессы не затронуты.');
  if (check) {
    await dependencies(JSON.parse(await readFile('package.json', 'utf8')), value('--pnpm', 'pnpm'));
    return await log('Проверка завершена. Серверы и браузер не запускались.');
  }
  try {
    processIdentity ??= await getProcessIdentity(process.pid);
    await withLauncherStateLock(stateFile, async () => {
      if (existsSync(stateFile))
        throw Object.assign(new Error('Запуск уже зарегистрирован.'), { code: 'EEXIST' });
      await writeLauncherState(stateFile, { project, instance, pid: process.pid, processIdentity });
      owner = true;
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await existing()) return;
    if (args.includes('--stop')) return await log('Прежний запуск уже остановлен.');
    return main();
  }
  if (args.includes('--stop')) return shutdown();
  control = createHttpServer((request, response) => {
    if (
      request.url !== '/instance' ||
      request.headers['x-debitus-launcher'] !== instance ||
      request.headers.origin ||
      !['GET', 'POST'].includes(request.method)
    ) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ project, instance, pid: process.pid, phase, url }));
    if (request.method === 'POST') setImmediate(() => void shutdown());
  });
  await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
  await saveState();
  await ensureFree(webPort);
  await ensureFree(apiPort);
  await dependencies(JSON.parse(await readFile('package.json', 'utf8')), value('--pnpm', 'pnpm'));
  if (stopping) return;
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = {
    ...process.env,
    WEB_PORT: String(webPort),
    API_PORT: String(apiPort),
    APP_ORIGIN: url,
    HOST: '127.0.0.1',
  };
  if (smoke) env.DATABASE_PATH = path.join(cache, `smoke-${instance}.sqlite`);
  await log(`Запускаем кабинет: ${url}. API доступен только локально на порту ${apiPort}.`);
  launch(
    process.execPath,
    ['--import', 'tsx', 'server/local.ts'],
    { ...env, PORT: String(apiPort) },
    'API',
  );
  launch(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    env,
    'Веб-интерфейс',
  );
  await waitReady();
  phase = 'ready';
  await saveState();
  await log(`Готово: ${url}`);
  if (smoke) {
    await log('Smoke-проверка прошла. Останавливаем только созданные этой проверкой серверы.');
    return await shutdown();
  }
  await openBrowser(url);
  await log('Оставьте это окно открытым. Остановка: Ctrl+C или Start-Debitus.cmd -Stop.');
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
try {
  await main();
} catch (error) {
  if (!stopping) {
    await log(`Ошибка запуска: ${error.message}`);
    await shutdown(1);
  }
}
