import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
if (process.platform === 'win32') delete process.env.NODE_PENDING_PIPE_INSTANCES;

export async function getProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return null;
  }
  try {
    if (process.platform === 'win32') {
      const powershell = path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      const { stdout } = await execute(
        powershell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { $p.CreationDate.ToUniversalTime().ToString('O') }`,
        ],
        { windowsHide: true, timeout: 4000, maxBuffer: 4096 },
      );
      const created = stdout.trim();
      if (created && Number.isFinite(Date.parse(created)))
        return { id: `win:${created}`, startedAtMs: Date.parse(created) };
    } else if (process.platform === 'linux') {
      const [record, boot] = await Promise.all([
        readFile(`/proc/${pid}/stat`, 'utf8'),
        readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      ]);
      const start = record.slice(record.lastIndexOf(')') + 2).split(' ')[19];
      const { stdout } = await execute('ps', ['-p', String(pid), '-o', 'lstart='], {
        timeout: 2000,
        maxBuffer: 4096,
        env: { ...process.env, LC_ALL: 'C' },
      });
      return { id: `linux:${boot.trim()}:${start}`, startedAtMs: Date.parse(stdout.trim()) };
    }
  } catch {}
  return { id: null };
}

export async function readLauncherState(filename) {
  try {
    const contents = await readFile(filename, 'utf8');
    const details = await stat(filename);
    let value = null;
    try {
      value = JSON.parse(contents);
    } catch {}
    return { value, contents, mtimeMs: details.mtimeMs };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function launcherOwnerIsGone(record) {
  const actual = await getProcessIdentity(record.value.pid);
  if (!actual) return true;
  const saved = record.value.processIdentity;
  if (saved?.id && actual.id) return saved.id !== actual.id;
  return Number.isFinite(actual.startedAtMs) && actual.startedAtMs > record.mtimeMs + 2000;
}

export async function withLauncherStateLock(filename, action) {
  const normalized = process.platform === 'win32' ? filename.toLowerCase() : filename;
  const name = `debitus-state-${createHash('sha256').update(normalized).digest('hex')}`;
  const address =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\${name}`
      : process.platform === 'linux'
        ? `\0${name}`
        : `${filename}.socket`;
  for (let attempt = 0; attempt < 120; attempt++) {
    const guard = createServer((socket) => socket.destroy());
    try {
      await new Promise((resolve, reject) => {
        guard.once('error', reject);
        guard.listen(address, resolve);
      });
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      await delay(50);
      continue;
    }
    try {
      return await action();
    } finally {
      await new Promise((resolve) => guard.close(resolve));
    }
  }
  throw new Error('Другой запуск обновляет состояние. Подождите несколько секунд и повторите.');
}

export async function writeLauncherState(filename, value) {
  const temporary = `${filename}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(value));
    } finally {
      await file.close();
    }
    await rename(temporary, filename);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
