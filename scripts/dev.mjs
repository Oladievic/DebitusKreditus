import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['--import', 'tsx', '--watch', 'server/local.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: process.env.API_PORT ?? '8787',
      HOST: '127.0.0.1',
      APP_ORIGIN: process.env.APP_ORIGIN ?? `http://127.0.0.1:${process.env.WEB_PORT ?? '5173'}`,
    },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
    stdio: 'inherit',
  }),
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
