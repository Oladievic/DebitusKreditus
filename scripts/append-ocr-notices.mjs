import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const tesseract = path.dirname(require.resolve('tesseract.js/package.json'));
const core = path.dirname(
  createRequire(path.join(tesseract, 'package.json')).resolve('tesseract.js-core/package.json'),
);
const pdf = path.dirname(require.resolve('pdfjs-dist/package.json'));
const marker = '## OCR and PDF runtime notices — V5';
let document = (await readFile('THIRD_PARTY_NOTICES.txt', 'utf8'))
  .split(marker)[0]
  .trimEnd()
  .replace('Версия приложения: `0.3.0`', 'Версия приложения: `0.4.0`');
document += `\n\n${marker}\n\nTesseract.js 7.0.0 and tesseract.js-core 7.0.0: Apache-2.0.\nPDF.js (pdfjs-dist) 6.4.299: Apache-2.0.\n@tesseract.js-data/rus 1.0.0 and @tesseract.js-data/eng 1.0.0 package metadata declares MIT; the underlying traineddata from naptha/tessdata is distributed under Apache-2.0.\nSources: https://github.com/naptha/tesseract.js ; https://github.com/naptha/tesseract.js-core ; https://github.com/naptha/tessdata ; https://github.com/mozilla/pdf.js\nOCR assets are self-hosted. public/fixtures/financial-scan.png and .pdf were generated specifically for this project using synthetic data.\n\n`;
const files = [
  ['Tesseract.js', path.join(tesseract, 'LICENSE.md')],
  ['Tesseract.js-core / traineddata Apache-2.0', path.join(core, 'LICENSE')],
  ['Tesseract worker bundled dependencies', path.join(tesseract, 'dist/worker.min.js.LICENSE.txt')],
  ['PDF.js', path.join(pdf, 'LICENSE')],
];
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  for (const name of await readdir(path.join(pdf, folder)))
    if (/license|notice/i.test(name))
      files.push([`PDF.js ${folder}/${name}`, path.join(pdf, folder, name)]);
}
for (const [title, file] of files)
  document += `### ${title}\n\n${await readFile(file, 'utf8')}\n\n`;
await writeFile('THIRD_PARTY_NOTICES.txt', document.replace(/[\t ]+$/gm, '').trimEnd() + '\n');
