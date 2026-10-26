import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const args = process.argv.slice(2);
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error(
    'Переносимая сборка сейчас поддерживает Windows x64. Соберите её на Windows x64.',
  );
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 19) throw new Error('Для сборки нужен Node.js >=24.19.0 и <25.');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const requested = args.includes('--output') ? args[args.indexOf('--output') + 1] : undefined;
if (args.includes('--output') && !requested) throw new Error('После --output укажите новую папку.');
const destination = path.resolve(
  root,
  requested ?? `output/Debitus-Kreditus-${manifest.version}-win-x64-${stamp}`,
);
const outputRoot = path.join(root, 'output');
if (!destination.startsWith(outputRoot + path.sep))
  throw new Error('Выходная папка должна находиться внутри output проекта.');
if (existsSync(destination))
  throw new Error(
    'Выходная папка уже существует. Укажите новую через --output; данные не перезаписаны.',
  );

const cache = path.join(root, '.cache', 'portable-runtime', process.version);
await mkdir(cache, { recursive: true });
async function cached(name, url) {
  const file = path.join(cache, name);
  if (existsSync(file)) return readFile(file, 'utf8');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw new Error(`Не удалось получить ${name}: HTTP ${response.status}.`);
  const content = await response.text();
  await writeFile(file, content);
  return content;
}
const checksums = await cached(
  'SHASUMS256.txt',
  `https://nodejs.org/dist/${process.version}/SHASUMS256.txt`,
);
const expected = checksums
  .split(/\r?\n/)
  .find((line) => line.endsWith('  win-x64/node.exe'))
  ?.split(' ')[0];
const executable = await readFile(process.execPath);
const nodeHash = createHash('sha256').update(executable).digest('hex');
if (!expected || expected !== nodeHash)
  throw new Error('Node.exe не совпадает с официальной SHA-256 выпуска. Сборка остановлена.');
const nodeLicense = await cached(
  'LICENSE.txt',
  `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,
);
if (!nodeLicense.includes('Node.js is licensed') || nodeLicense.length < 10000)
  throw new Error('Лицензия Node.js повреждена или неполна.');

await mkdir(path.join(destination, 'runtime'), { recursive: true });
await mkdir(path.join(destination, 'app'), { recursive: true });
await run('scripts/check-migrations.mjs', []);
await run('node_modules/vite/bin/vite.js', [
  'build',
  '--mode',
  'standalone',
  '--outDir',
  path.join(destination, 'client'),
]);
await build({
  entryPoints: ['server/local.ts'],
  outfile: path.join(destination, 'app', 'index.js'),
  platform: 'node',
  format: 'esm',
  target: 'node24',
  bundle: true,
  sourcemap: false,
  metafile: true,
  logLevel: 'info',
}).then((result) => {
  const external = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((entry) => entry.external && !entry.path.startsWith('node:'));
  if (external.length)
    throw new Error(
      `Сервер требует внешние модули: ${external.map((item) => item.path).join(', ')}`,
    );
});
await cp('migrations', path.join(destination, 'migrations'), { recursive: true });
await cp('scripts/portable-run.mjs', path.join(destination, 'run.mjs'));
await cp('scripts/launcher-state.mjs', path.join(destination, 'launcher-state.mjs'));
await cp('THIRD_PARTY_NOTICES.txt', path.join(destination, 'THIRD_PARTY_NOTICES.txt'));
await writeFile(path.join(destination, 'runtime', 'node.exe'), executable);
await writeFile(path.join(destination, 'runtime', 'NODE_LICENSE.txt'), nodeLicense);
await writeFile(path.join(destination, 'runtime', 'SHASUMS256.txt'), checksums);
await writeFile(
  path.join(destination, 'package.json'),
  JSON.stringify(
    { name: manifest.name, version: manifest.version, private: true, type: 'module' },
    null,
    2,
  ) + '\n',
);
await writeFile(
  path.join(destination, 'Start-Debitus.cmd'),
  '@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\n"%~dp0runtime\\node.exe" "%~dp0run.mjs" %*\r\nset "result=%ERRORLEVEL%"\r\nif not "%result%"=="0" pause\r\nexit /b %result%\r\n',
);
await writeFile(
  path.join(destination, 'Stop-Debitus.cmd'),
  '@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\n"%~dp0runtime\\node.exe" "%~dp0run.mjs" --stop\r\nif errorlevel 1 pause\r\n',
);
await writeFile(
  path.join(destination, 'local-ai.env.example'),
  'LOCAL_AI_ENABLED=0\nLOCAL_AI_URL=http://127.0.0.1:11434\nLOCAL_AI_MODEL=qwen3:0.6b\n',
);
const instructions = `# Debitus-Kreditus: запуск без интернета\n\n1. Полностью распакуйте папку в доступное для записи место на Windows x64 (например, «Документы»). Не запускайте из ZIP.\n2. Дважды нажмите **Start-Debitus.cmd**. Браузер откроет http://127.0.0.1:3000. Node.js, Docker, npm и интернет для запуска не нужны.\n3. На экране входа выберите предпринимателя, сотрудника банка или администратора.\n4. Для остановки нажмите **Stop-Debitus.cmd** или Ctrl+C в окне запуска.\n\nВсе заявки и документы сохраняются в папке **data** рядом с кнопкой запуска. Для переноса или резервной копии сначала остановите кабинет и скопируйте всю папку. Не удаляйте data при обновлении.\n\nПорт занят: запустите \`Start-Debitus.cmd --port 3001\`. Проверка целостности: \`Start-Debitus.cmd --check\`. Запуск без открытия браузера: \`Start-Debitus.cmd --no-browser\`. Двойной запуск открывает уже работающий экземпляр. Сервер доступен только с этого компьютера.\n\nОсновной сценарий и распознавание PDF/PNG/JPEG работают без LLM. Включение локального помощника необязательно: отдельно установите Ollama и заранее загрузите Qwen3 0.6B или 1.7B; скопируйте local-ai.env.example в local-ai.env, поставьте LOCAL_AI_ENABLED=1 и перезапустите кабинет. Удалённые inference API не поддерживаются. Для ПК с 8–16 ГБ по умолчанию выбрана проверенная 0.6B. Профиль 1.7B допустим при наличии минимум 4 ГиБ свободной памяти, но его скорость и качество отдельно не измерялись. Модель не входит в архив. Лимит владельца 120B — верхняя граница, а не требование к офисному ПК.\n\nДанные синтетические. Выдача кредита, подпись и банковские операции имитируются. Это автономный прототип, не подключённый к реальным банкам.\n\nВерсия ${manifest.version}; Windows x64; Node ${process.versions.node}. Хеши файлов и исходный Git-коммит находятся в bundle.json. Лицензии: THIRD_PARTY_NOTICES.txt и runtime/NODE_LICENSE.txt.\n`;
await writeFile(path.join(destination, 'README.md'), instructions);
await writeFile(
  path.join(destination, 'Инструкция.txt'),
  instructions.replaceAll('**', '').replaceAll('`', ''),
);
if (existsSync(path.join(root, 'README.md')))
  await cp(path.join(root, 'README.md'), path.join(destination, 'technical-reference.md'));
await cp(path.join(root, 'docs'), path.join(destination, 'docs'), {
  recursive: true,
  filter: (filename) =>
    !path.relative(path.join(root, 'docs'), filename).split(path.sep).includes('tooling'),
});
let commit = null;
let sourceDirty = null;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  sourceDirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
  );
} catch {}
const files = [];
async function collect(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Переносимый архив не должен содержать ссылки: ${filename}`);
    if (entry.isDirectory()) await collect(filename);
    else {
      const bytes = await readFile(filename);
      files.push({
        path: path.relative(destination, filename).split(path.sep).join('/'),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
}
await collect(destination);
const report = {
  format: 1,
  product: manifest.name,
  version: manifest.version,
  platform: 'win32',
  arch: 'x64',
  node: process.versions.node,
  sourceCommit: commit,
  sourceDirty,
  lockfileSha256: createHash('sha256')
    .update(await readFile('pnpm-lock.yaml'))
    .digest('hex'),
  createdAt: new Date().toISOString(),
  offline: true,
  files,
};
await writeFile(path.join(destination, 'bundle.json'), JSON.stringify(report, null, 2) + '\n');
const archive = destination + '.zip';
await new Promise((resolve, reject) => {
  const child = spawn(
    path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:DEBITUS_ARCHIVE_SOURCE, $env:DEBITUS_ARCHIVE_TARGET, [System.IO.Compression.CompressionLevel]::Optimal, $true, [System.Text.Encoding]::UTF8)",
    ],
    {
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, DEBITUS_ARCHIVE_SOURCE: destination, DEBITUS_ARCHIVE_TARGET: archive },
    },
  );
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`Архиватор завершился с кодом ${code}.`)),
  );
});
const archiveBytes = await readFile(archive);
const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex');
await writeFile(archive + '.sha256', `${archiveSha256}  ${path.basename(archive)}\n`);
console.log(
  JSON.stringify({
    directory: destination,
    files: files.length,
    bytes: files.reduce((total, item) => total + item.bytes, 0),
    nodeSha256: nodeHash,
    sourceCommit: commit,
    sourceDirty,
    archive,
    archiveBytes: archiveBytes.length,
    archiveSha256,
    offline: true,
  }),
);

function run(script, parameters) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...parameters], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Сборка завершилась с кодом ${code}.`)),
    );
  });
}
