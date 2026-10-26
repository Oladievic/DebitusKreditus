import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import {
  getProcessIdentity,
  launcherOwnerIsGone,
  readLauncherState,
  withLauncherStateLock,
  writeLauncherState,
} from './launcher-state.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const args = process.argv.slice(2);
const port = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : 3000);
const url = `http://127.0.0.1:${port}`;
const data = path.join(root, 'data');
const stateFile = path.join(data, '.launcher.json');
const token = randomBytes(24).toString('hex');
const project = createHash('sha256').update(root.toLowerCase()).digest('hex');
let control,
  child,
  owner = false,
  stopping = false,
  phase = 'preparing',
  processIdentity;
const noBrowser = args.some((arg) =>
  ['--no-browser', '--check', '--smoke', '--stop'].includes(arg),
);

async function state() {
  return (await readLauncherState(stateFile))?.value ?? null;
}
async function contact(previous, method = 'GET') {
  if (previous?.project !== project || !Number.isInteger(previous.controlPort) || !previous.token)
    return null;
  try {
    const response = await fetch(`http://127.0.0.1:${previous.controlPort}/instance`, {
      method,
      headers: { 'X-Debitus-Launcher': previous.token },
      signal: AbortSignal.timeout(1000),
    });
    const result = await response.json();
    return response.ok && result.project === project && result.token === previous.token
      ? result
      : null;
  } catch {
    return null;
  }
}
async function openBrowser(address) {
  if (noBrowser) return;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(address)) throw new Error('Неверный адрес кабинета.');
  const browser = spawn(
    path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    ['-NoLogo', '-NoProfile', '-Command', `Start-Process '${address}'`],
    { windowsHide: true, stdio: 'ignore' },
  );
  browser.once('error', () => console.log(`Откройте в браузере: ${address}`));
  browser.unref();
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 4000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  if (control) {
    control.closeAllConnections();
    await new Promise((resolve) => control.close(resolve));
  }
  if (owner)
    await withLauncherStateLock(stateFile, async () => {
      if ((await state())?.token === token) await unlink(stateFile).catch(() => {});
    });
  process.exitCode = code;
}
async function verify() {
  const manifest = JSON.parse(await readFile(path.join(root, 'bundle.json'), 'utf8'));
  if (
    manifest.format !== 1 ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    manifest.node !== process.versions.node
  )
    throw new Error(
      'Архив рассчитан на другой выпуск Node.js или систему. Используйте комплектный Start-Debitus.cmd.',
    );
  for (const entry of manifest.files) {
    const filename = path.resolve(root, entry.path);
    if (!filename.startsWith(root + path.sep)) throw new Error('Некорректный путь в bundle.json.');
    const bytes = await readFile(filename).catch(() => null);
    if (
      !bytes ||
      bytes.length !== entry.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sha256
    )
      throw new Error(
        `Файл отсутствует или повреждён: ${entry.path}. Распакуйте исходный архив заново; папку data сохраните.`,
      );
  }
  return manifest;
}
async function existing() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const previous = await state();
    const active = await contact(previous);
    if (active) {
      if (args.includes('--stop')) {
        await contact(previous, 'POST');
        for (let wait = 0; wait < 20; wait++) {
          if (!(await contact(previous))) {
            console.log('Кабинет остановлен. Данные сохранены.');
            return true;
          }
          await delay(250);
        }
        throw new Error('Остановка ещё не подтверждена. Проверьте окно запуска.');
      }
      console.log(`Кабинет уже запущен: ${active.url}`);
      if (active.phase === 'ready') await openBrowser(active.url);
      return true;
    }
    const recovered = await withLauncherStateLock(stateFile, async () => {
      const record = await readLauncherState(stateFile);
      if (!record) return true;
      if (!record.value || !Number.isInteger(record.value.pid) || record.value.pid <= 0)
        throw new Error(
          'Файл состояния запуска повреждён: data/.launcher.json. Сервер и данные не изменены.',
        );
      if (record.value.project !== project)
        throw new Error(
          'Файл состояния относится к другой папке: data/.launcher.json. Сервер и данные не изменены.',
        );
      if (!(await launcherOwnerIsGone(record))) return false;
      await unlink(stateFile);
      return true;
    });
    if (recovered) {
      console.log('Устаревшее состояние запуска сброшено. Другие процессы не затронуты.');
      return false;
    }
    await delay(250);
  }
  throw new Error(
    'Предыдущий запуск ещё не отвечает. Закройте его окно и повторите. Чужие процессы не остановлены.',
  );
}
async function main() {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Порт должен быть целым числом от 1024 до 65535.');
  if (args.includes('--stop') && !existsSync(stateFile)) {
    console.log('Кабинет не запущен.');
    return;
  }
  if (args.includes('--check')) {
    const manifest = await verify();
    console.log(
      `Целостность ${manifest.files.length} файлов подтверждена. Версия ${manifest.version}. Интернет для запуска не нужен.`,
    );
    return;
  }
  await mkdir(data, { recursive: true });
  try {
    processIdentity ??= await getProcessIdentity(process.pid);
    await withLauncherStateLock(stateFile, async () => {
      if (existsSync(stateFile))
        throw Object.assign(new Error('Запуск уже зарегистрирован.'), { code: 'EEXIST' });
      await writeLauncherState(stateFile, { project, token, pid: process.pid, processIdentity });
      owner = true;
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await existing()) return;
    if (args.includes('--stop')) {
      console.log('Прежний запуск уже остановлен.');
      return;
    }
    return main();
  }
  if (args.includes('--stop')) return shutdown();
  control = createServer((request, response) => {
    if (
      request.url !== '/instance' ||
      request.headers['x-debitus-launcher'] !== token ||
      request.headers.origin ||
      !['GET', 'POST'].includes(request.method)
    ) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ project, token, pid: process.pid, phase, url }));
    if (request.method === 'POST') setImmediate(() => void shutdown());
  });
  await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
  const saveState = () =>
    withLauncherStateLock(stateFile, async () => {
      if ((await state())?.token !== token)
        throw new Error('Состояние запуска изменилось. Повторите запуск.');
      await writeLauncherState(stateFile, {
        project,
        token,
        pid: process.pid,
        processIdentity,
        controlPort: control.address().port,
        phase,
        url,
      });
    });
  await saveState();
  await verify();
  const socket = tcpServer();
  await new Promise((resolve, reject) => {
    socket.once('error', () =>
      reject(
        new Error(
          `Порт ${port} занят. Используйте Start-Debitus.cmd --port ${port === 65535 ? 3001 : port + 1}.`,
        ),
      ),
    );
    socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });
  const local = existsSync('local-ai.env') ? parseEnv(await readFile('local-ai.env', 'utf8')) : {};
  const ai = Object.fromEntries(
    Object.entries(local).filter(([key]) =>
      ['LOCAL_AI_ENABLED', 'LOCAL_AI_URL', 'LOCAL_AI_MODEL'].includes(key),
    ),
  );
  const env = {
    ...process.env,
    LOCAL_AI_ENABLED: '0',
    ...ai,
    PORT: String(port),
    HOST: '127.0.0.1',
    APP_ORIGIN: url,
    DATABASE_PATH: path.join(data, 'debitus-kreditus.sqlite'),
    STATIC_DIRECTORY: path.join(root, 'client'),
  };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  console.log('Запускаем Debitus-Kreditus. Установка пакетов и интернет не требуются.');
  child = spawn(process.execPath, [path.join(root, 'app', 'index.js')], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (bytes) => {
    void appendFile(path.join(data, 'server.log'), bytes).catch(() => {});
  });
  child.once('error', () => {
    console.error('Не удалось запустить комплектный сервер.');
    void shutdown(1);
  });
  child.once('exit', (code) => {
    if (!stopping) {
      console.error(`Сервер остановлен (${code}). Диагностика: data/server.log.`);
      void shutdown(1);
    }
  });
  let ready = false;
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
      const body = await response.json();
      const page = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (
        response.ok &&
        body.ok &&
        body.moneyUnit === 'RUB_INTEGER' &&
        page.ok &&
        (await page.text()).includes('id="root"')
      ) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  if (!ready) throw new Error('Сервер не стал готов. Подробности: data/server.log.');
  phase = 'ready';
  await saveState();
  console.log(
    `Готово: ${url}\nДанные: ${data}\nОстановка: Stop-Debitus.cmd или Ctrl+C. Оставьте это окно открытым.`,
  );
  if (args.includes('--smoke')) return shutdown();
  await openBrowser(url);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  await main();
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  await shutdown(1);
}
