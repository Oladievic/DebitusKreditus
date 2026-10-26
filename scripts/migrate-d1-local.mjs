import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

await access('dist/server/wrangler.json');
const args = [
  'node_modules/wrangler/bin/wrangler.js',
  'd1',
  'migrations',
  'apply',
  'DB',
  '--local',
  '--config',
  'dist/server/wrangler.json',
  '--persist-to',
  '.wrangler/state',
];
process.env.WRANGLER_SEND_METRICS ??= 'false';
process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
