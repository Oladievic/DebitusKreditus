import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import './check-migrations.mjs';

const required = [
  'dist/server/index.js',
  'dist/server/wrangler.json',
  'dist/client/index.html',
  'dist/.openai/hosting.json',
  'dist/.openai/drizzle/meta/_journal.json',
];
await Promise.all(required.map((file) => access(file)));
const source = JSON.parse(await readFile('hosting.config.json', 'utf8'));
const built = JSON.parse(await readFile('dist/.openai/hosting.json', 'utf8'));
if (
  !source.project_id ||
  source.project_id !== built.project_id ||
  built.d1 !== 'DB' ||
  built.static
) {
  throw new Error('Некорректный Sites manifest для Worker с D1');
}
const worker = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
if (
  !worker.assets?.directory ||
  !worker.d1_databases?.some((database) => database.binding === 'DB')
) {
  throw new Error('Сборка не объявляет клиентские ресурсы или D1');
}
for (const entry of await readdir('dist/server')) {
  if (!entry.endsWith('.js')) continue;
  const code = await readFile(path.join('dist/server', entry), 'utf8');
  if (/node:sqlite/.test(code)) throw new Error('Node SQLite попал в Worker');
}
console.log('Артефакт Sites: Worker, клиентские ресурсы, D1 и миграции проверены');
