import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const target = process.argv[2] ?? '--all';
if (!['--all', '--local', '--cloud'].includes(target)) {
  throw new Error('Допустимые цели сборки: --all, --local, --cloud');
}
const root = process.cwd();
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
  throw new Error('Неверный путь выходной папки');
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await run('scripts/check-migrations.mjs', []);
await run('node_modules/vite/bin/vite.js', [
  'build',
  '--mode',
  target === '--local' ? 'standalone' : 'cloud',
]);
if (target !== '--cloud') {
  await build({
    entryPoints: ['server/local.ts'],
    outfile: 'dist/local/index.js',
    platform: 'node',
    format: 'esm',
    target: 'node24',
    bundle: true,
    sourcemap: false,
    logLevel: 'info',
  });
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`Сборка завершилась: ${signal ?? code}`)),
    );
  });
}
