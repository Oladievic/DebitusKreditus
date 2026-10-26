import { readFile, readdir } from 'node:fs/promises';

const mappings = JSON.parse(
  await readFile(new URL('./migration-map.json', import.meta.url), 'utf8'),
);
const normalize = (sql) =>
  sql.replaceAll('--> statement-breakpoint', '').replaceAll('\r', '').replace(/\s+/g, ' ').trim();
const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
const localFiles = (await readdir('migrations')).filter((file) => file.endsWith('.sql')).sort();
if (
  localFiles.join(',') !==
  mappings
    .map(({ local }) => local)
    .sort()
    .join(',')
) {
  throw new Error('Не все SQL-миграции включены в scripts/migration-map.json');
}
for (const { local, cloud } of mappings) {
  if (!journal.entries.some(({ tag }) => `${tag}.sql` === cloud))
    throw new Error(`Нет записи Drizzle: ${cloud}`);
  const left = await readFile(`migrations/${local}`, 'utf8');
  const right = await readFile(`drizzle/${cloud}`, 'utf8');
  if (normalize(left) !== normalize(right))
    throw new Error(`SQL-миграции расходятся: ${local} / ${cloud}`);
}
console.log(`Проверены миграции SQLite/D1: ${mappings.length}`);
