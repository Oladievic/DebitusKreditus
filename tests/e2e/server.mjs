import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const webPort = process.env.E2E_WEB_PORT ?? '5273';
const apiPort = process.env.E2E_API_PORT ?? '8887';
const directory = path.resolve('.cache/e2e');
mkdirSync(directory, { recursive: true });
const database = path.join(directory, `run-${Date.now()}-${process.pid}.sqlite`);
const environment = {
  ...process.env,
  DATABASE_PATH: database,
  APP_ORIGIN: `http://127.0.0.1:${webPort}`,
  API_PORT: apiPort,
  WEB_PORT: webPort,
  PORT: apiPort,
  HOST: '127.0.0.1',
};
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'server/local.ts'], {
    stdio: 'inherit',
    env: environment,
  }),
  spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', webPort, '--strictPort'],
    { stdio: 'inherit', env: environment },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log(`E2E database: ${database}`);
