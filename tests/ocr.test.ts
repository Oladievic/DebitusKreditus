import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundedCanvas,
  financialCandidates,
  imageDimensions,
  parseRubles,
} from '../src/ocr/fields.js';
import { importCsvTemplate, parseImportCsv } from '../src/import-csv.js';
import { createApp } from '../server/app.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';
import { initializeDatabase } from '../server/seed.js';

test('OCR candidates require unambiguous monthly units and valid whole RUB', () => {
  assert.equal(parseRubles('2 400 000,00'), 2400000);
  assert.equal(parseRubles('1,55'), null);
  assert.equal(parseRubles('-20'), null);
  assert.equal(parseRubles('1 000 000 001'), null);
  assert.deepEqual(
    financialCandidates(
      'Выручка в месяц: 2 400 000 RUB\nОперационные расходы в месяц: 1 650 000 RUB\nКредитные платежи в месяц: 120 000 RUB',
    ).map((item) => item.value),
    [2400000, 1650000, 120000],
  );
  assert.equal(
    financialCandidates('Выручка за год: 2400000\nВыручка в месяц: 2400 тыс. руб.').length,
    0,
  );
  assert.equal(financialCandidates('Выручка в месяц: 2400000\nВыручка в месяц: 2200000').length, 0);
  assert.equal(financialCandidates('Выручка в месяц: -500').length, 0);
  const bounds = boundedCanvas(12000, 9000);
  assert.ok(bounds.width * bounds.height <= 6000000);
  assert.throws(() => imageDimensions(new Uint8Array([1, 2, 3])));
});

test('CSV template and quoted cells preserve values; malformed imports are rejected', () => {
  const rows = parseImportCsv(importCsvTemplate());
  assert.equal(rows[0].financials.monthlyRevenue, 2400000);
  assert.equal(rows[0].consent, true);
  const escaped = importCsvTemplate().replace('Закупка материалов', '"Материалы; заказ ""А"""');
  assert.equal(parseImportCsv(escaped)[0].purpose, 'Материалы; заказ "А"');
  assert.throws(() => parseImportCsv('Номер;Цель;Сумма RUB;Срок;Статус\n1;x;2;3;draft'));
  assert.throws(() => parseImportCsv(importCsvTemplate().replace('1200000', '=SUM(1)')));
  assert.throws(() => parseImportCsv(importCsvTemplate().replace('true', 'да')));
});

test('OCR endpoint requires review, owner, version and editable state; records atomic provenance', async () => {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
  const call = (path: string, cookie: string, body?: unknown) =>
    app.request(`http://localhost/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  const login = async (name: string) => {
    const response = await app.request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `owner@${name}.example.test`, password: 'Demo2026!' }),
    });
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const cookie = await login('sever'),
    other = await login('terra');
  const created = await call('/applications', cookie, {
    productId: 'working_capital',
    amount: 1200000,
    termMonths: 24,
    purpose: 'Закупка материалов',
    financials: { monthlyRevenue: 2400000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
    consent: true,
  });
  const { application } = await created.json();
  const endpoint = `/applications/${application.id}/documents/ocr`;
  const body = {
    version: application.version,
    category: 'financials',
    sourceName: 'scan.png',
    sourceSha256: 'a'.repeat(64),
    sourceSize: 4000,
    sourceMimeType: 'image/png',
    pages: 1,
    text: 'Выручка в месяц: 2400000 RUB',
    engine: 'tesseract.js@7.0.0',
    reviewed: true,
  };
  assert.equal((await call(endpoint, cookie, { ...body, reviewed: false })).status, 400);
  assert.equal((await call(endpoint, other, body)).status, 404);
  assert.equal((await call(endpoint, cookie, { ...body, version: 999 })).status, 409);
  assert.equal((await call(endpoint, cookie, { ...body, pages: 6 })).status, 400);
  const response = await call(endpoint, cookie, body);
  assert.equal(response.status, 201, await response.clone().text());
  const { document } = await response.json();
  assert.equal(document.ocr.sourceSha256, body.sourceSha256);
  assert.ok(document.ocr.reviewedAt);
  assert.equal((await call(endpoint, cookie, body)).status, 409);
  const detail = await (await call(`/applications/${application.id}`, cookie)).json();
  assert.equal(detail.documents.length, 1);
  assert.equal(detail.documents[0].ocr.engine, body.engine);
  assert.deepEqual(detail.application.financials, application.financials);
  const download = await app.request(`http://localhost${document.downloadUrl}`, {
    headers: { cookie },
  });
  assert.match(await download.text(), /Подлинность и достоверность не проверены/);
  const records = await db.query<{ count: number }>('SELECT count(*) AS count FROM document_ocr');
  assert.equal(records[0].count, 1);
  db.close();
});
