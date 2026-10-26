import { createRequire } from 'node:module';
import { mkdir, cp, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const target = path.resolve('public/ocr');
const tesseract = path.dirname(require.resolve('tesseract.js/package.json'));
const core = path.dirname(
  createRequire(path.join(tesseract, 'package.json')).resolve('tesseract.js-core/package.json'),
);
const pdf = path.dirname(require.resolve('pdfjs-dist/package.json'));
await mkdir(path.join(target, 'core'), { recursive: true });
await mkdir(path.join(target, 'lang'), { recursive: true });
await mkdir(path.join(target, 'pdf'), { recursive: true });
for (const name of ['worker.min.js', 'worker.min.js.LICENSE.txt'])
  await copyFile(path.join(tesseract, 'dist', name), path.join(target, name));
for (const name of await readdir(core))
  if (/^tesseract-core.*\.(js|wasm)$/.test(name))
    await copyFile(path.join(core, name), path.join(target, 'core', name));
for (const lang of ['rus', 'eng']) {
  const source = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
  await copyFile(
    path.join(source, '4.0.0', `${lang}.traineddata.gz`),
    path.join(target, 'lang', `${lang}.traineddata.gz`),
  );
}
await copyFile(
  path.join(pdf, 'build/pdf.worker.min.mjs'),
  path.join(target, 'pdf/pdf.worker.min.mjs'),
);
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs'])
  await cp(path.join(pdf, folder), path.join(target, 'pdf', folder), { recursive: true });
console.log('OCR: worker, CPU WASM, rus+eng and PDF assets prepared locally.');
