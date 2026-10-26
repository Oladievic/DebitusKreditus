import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';
import { initializeDatabase } from '../server/seed.js';
import { fromBase64, sha256 } from '../server/security.js';
import {
  analyzeStatement,
  parseStatementCsv,
  statementCsvTemplate,
  STATEMENT_HEADER,
  StatementValidationError,
  type StatementReport,
} from '../shared/statements.js';
import type { ApplicationDetail } from '../shared/types.js';

const financials = {
  monthlyRevenue: 2_400_000,
  monthlyExpenses: 1_650_000,
  monthlyDebtPayment: 120_000,
};
const period = { from: '2026-08-01', to: '2026-09-30' };
const csv = (rows: string[]) => `${STATEMENT_HEADER}\n${rows.join('\n')}\n`;
const transaction = '2026-08-05;in;1200000;buyer-a;Покупатель А;revenue;A-001';

test('statement separates operating revenue, borrowing, internal transfers, refunds and debt', () => {
  const analysis = analyzeStatement(
    statementCsvTemplate() +
      [
        '2026-08-15;in;900000;self;Мой счёт;transfer;T-001',
        '2026-08-16;in;700000;lender;Кредитор;loan;L-001',
        '2026-08-17;in;300000;supplier;Поставщик;refund;R-001',
        '2026-08-18;out;100000;self;Мой счёт;transfer;T-002',
        '2026-08-19;out;50000;buyer;Покупатель;refund;R-002',
      ].join('\n'),
    period,
    financials,
  );
  assert.equal(analysis.averageMonthlyRevenue, 2_400_000);
  assert.equal(analysis.averageMonthlyExpenses, 1_650_000);
  assert.equal(analysis.averageMonthlyDebtPayment, 120_000);
  assert.equal(analysis.totals.revenue, 4_800_000);
  assert.equal(analysis.totals.inflow, 6_700_000);
  assert.equal(analysis.totals.outflow, 3_690_000);
  assert.deepEqual(analysis.excludedTotals, {
    transfer: { inflow: 900000, outflow: 100000 },
    loan: { inflow: 700000, outflow: 0 },
    refund: { inflow: 300000, outflow: 50000 },
    debt: { inflow: 0, outflow: 240000 },
  });
  assert.equal(analysis.trendBps, 0);
  assert.equal(analysis.largestRevenueCounterparty?.id, 'buyer-a');
  assert.equal(analysis.largestRevenueCounterparty?.shareBps, 5208);
  assert.equal(analysis.regularity.activeRevenueDays, 4);
  assert.equal(analysis.regularity.totalDays, 61);
  assert.equal(
    analysis.findings.some((item) => item.code.includes('MISMATCH')),
    false,
  );
});

test('statement quote parser supports BOM, CRLF, escaped quotes, semicolons and multiline cells', () => {
  const parsed = parseStatementCsv(
    `\uFEFF${STATEMENT_HEADER}\r\n2026-08-05;in;10;buyer;"  Компания; ""А""\r\n подразделение ";revenue;"REF;01"\r\n`,
    period,
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].counterparty, 'Компания; "А" подразделение');
  assert.equal(parsed[0].reference, 'REF;01');
  const duplicate = analyzeStatement(
    csv([
      transaction,
      transaction.replace('Покупатель А', '  Покупатель   А  '),
      transaction.replace('A-001', 'A-002'),
    ]),
    period,
    financials,
  );
  assert.equal(duplicate.rowCount, 3);
  assert.equal(duplicate.uniqueRows, 2);
  assert.deepEqual(duplicate.duplicates, [{ row: 3, originalRow: 2 }]);
  assert.equal(duplicate.totals.revenue, 2_400_000);
  assert.deepEqual(duplicate.findings.find((item) => item.code === 'EXACT_DUPLICATES')?.rows, [3]);
});

test('statement rejects ambiguous fields, invalid calendar dates, bounds and malformed CSV', () => {
  for (const value of ['0', '-1', '1.00', '1,00', '1e3', '1 000', '=1+2', '1000000001'])
    assert.throws(
      () => analyzeStatement(csv([transaction.replace('1200000', value)]), period, financials),
      StatementValidationError,
    );
  for (const value of ['2026-02-29', '2026-8-05', '2026-13-01', '2026-08-32'])
    assert.throws(
      () => parseStatementCsv(csv([transaction.replace('2026-08-05', value)]), period),
      StatementValidationError,
    );
  for (const value of [
    transaction.replace(';revenue;', ';expense;'),
    transaction.replace(';in;', ';out;'),
    transaction.replace(';in;', ';IN;'),
    transaction.replace(';buyer-a;', ';;'),
    transaction.replace(';A-001', ';'),
    transaction + ';extra',
    transaction.replace(';Покупатель А;', ';Покупатель "А";'),
    transaction.replace(';Покупатель А;', ';"Покупатель А;'),
    transaction.replace(';Покупатель А;', ';"Покупатель А"tail;'),
    '\n' + transaction,
    transaction.replace(';revenue;', ';unknown;'),
  ])
    assert.throws(() => parseStatementCsv(csv([value]), period), StatementValidationError);
  assert.throws(() =>
    parseStatementCsv(csv([transaction]), { from: '2026-08-06', to: '2026-09-30' }),
  );
  assert.throws(() =>
    parseStatementCsv(csv([transaction]), { from: '2027-01-01', to: '2026-01-01' }),
  );
  assert.throws(() =>
    parseStatementCsv(csv([transaction]), { from: '2024-01-01', to: '2027-01-01' }),
  );
  assert.throws(() => parseStatementCsv(STATEMENT_HEADER + '\n', period));
  assert.throws(() => parseStatementCsv(csv(Array(5001).fill(transaction)), period));
  assert.throws(() => parseStatementCsv(csv([transaction]) + 'я'.repeat(600000), period));
  assert.equal(parseStatementCsv(csv(Array(5000).fill(transaction)), period).length, 5000);
  for (const replacement of ['=HYPERLINK(1)', ' +SUM(1)', '\t@SUM(1)', '-1+1']) {
    for (const field of ['buyer-a', 'Покупатель А', 'A-001'])
      assert.throws(
        () => parseStatementCsv(csv([transaction.replace(field, replacement)]), period),
        (error: unknown) =>
          error instanceof StatementValidationError && error.code === 'STATEMENT_FORMULA',
      );
  }
});

test('full month averages include zero-operation months and never extrapolate partial periods', () => {
  const partial = analyzeStatement(
    csv([transaction]),
    { from: '2026-08-02', to: '2026-08-30' },
    financials,
  );
  assert.equal(partial.fullMonthCount, 0);
  assert.equal(partial.averageMonthlyRevenue, null);
  assert.equal(partial.averageMonthlyExpenses, null);
  assert.equal(partial.trendBps, null);
  assert.equal(
    partial.findings.some((item) => item.code.includes('MISMATCH')),
    false,
  );
  assert.equal(
    partial.findings.some((item) => item.code === 'PARTIAL_PERIOD'),
    true,
  );
  const complete = analyzeStatement(csv([transaction]), period, financials);
  assert.equal(complete.fullMonthCount, 2);
  assert.equal(complete.averageMonthlyRevenue, 600000);
  assert.equal(complete.months[1].revenue, 0);
  assert.equal(complete.trendBps, -10000);
  assert.equal(
    complete.findings.some((item) => item.code === 'DECLARED_REVENUE_MISMATCH'),
    true,
  );
  const leap = analyzeStatement(
    csv([transaction.replace('2026-08-05', '2024-02-29')]),
    { from: '2024-02-01', to: '2024-02-29' },
    financials,
  );
  assert.equal(leap.fullMonthCount, 1);
  assert.equal(leap.regularity.totalDays, 29);
});

test('findings expose exact thresholds without converting score or movement into fraud probability', () => {
  const customPeriod = { from: '2026-08-01', to: '2026-08-31' };
  const declared = { monthlyRevenue: 100, monthlyExpenses: 0, monthlyDebtPayment: 0 };
  const one = (amount: number) =>
    analyzeStatement(csv([transaction.replace('1200000', String(amount))]), customPeriod, declared);
  assert.equal(
    one(110).findings.some((item) => item.code === 'DECLARED_REVENUE_MISMATCH'),
    false,
  );
  assert.equal(
    one(111).findings.some((item) => item.code === 'DECLARED_REVENUE_MISMATCH'),
    true,
  );
  const growth = analyzeStatement(
    csv([
      transaction.replace('1200000', '100'),
      transaction
        .replace('2026-08-05', '2026-09-05')
        .replace('1200000', '150')
        .replace('A-001', 'A-002'),
    ]),
    period,
    declared,
  );
  assert.equal(growth.trendBps, 5000);
  assert.equal(
    growth.findings.some((item) => item.code === 'REVENUE_JUMP'),
    true,
  );
  assert.equal(
    growth.findings.some((item) => item.code === 'COUNTERPARTY_CONCENTRATION'),
    true,
  );
  assert.ok(growth.findings.every((item) => !('confidence' in item)));
  const nearGrowth = analyzeStatement(
    csv([
      transaction.replace('1200000', '100000'),
      transaction
        .replace('2026-08-05', '2026-09-05')
        .replace('1200000', '149999')
        .replace('A-001', 'A-002'),
    ]),
    period,
    declared,
  );
  assert.equal(nearGrowth.trendBps, 5000);
  assert.equal(
    nearGrowth.findings.some((item) => item.code === 'REVENUE_JUMP'),
    false,
  );
  const earlierJump = analyzeStatement(
    csv([
      transaction.replace('1200000', '100'),
      transaction
        .replace('2026-08-05', '2026-09-05')
        .replace('1200000', '150')
        .replace('A-001', 'A-002'),
      transaction
        .replace('2026-08-05', '2026-10-05')
        .replace('1200000', '100')
        .replace('A-001', 'A-003'),
    ]),
    { from: '2026-08-01', to: '2026-10-31' },
    declared,
  );
  assert.equal(
    earlierJump.findings.some((item) => item.code === 'REVENUE_JUMP'),
    true,
  );
});

async function setup() {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
  const call = (route: string, cookie = '', method = 'GET', body?: unknown) =>
    app.request(`http://localhost/api${route}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (email: string) => {
    const response = await call('/auth/login', '', 'POST', { email, password: 'Demo2026!' });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const owner = await login('owner@sever.example.test');
  const created = await read<ApplicationDetail>(
    await call('/applications', owner, 'POST', {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      purpose: 'Закупка материалов',
      financials,
      consent: true,
    }),
  );
  return { db, call, login, owner, application: created.application };
}
async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body as T;
}
const importBody = (version: number) => ({
  version,
  csv: statementCsvTemplate(),
  sourceName: 'обороты.csv',
  period,
  reviewed: true,
});

test('preview recalculates on server; saving freezes source, rule version, financial comparison and audit atomically', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const endpoint = `/applications/${s.application.id}/statement`;
  const beforeAudit = await s.db.query('SELECT id FROM audit');
  const preview = await read<{ analysis: unknown; sourceSha256: string }>(
    await s.call(endpoint + '/preview', s.owner, 'POST', {
      ...importBody(1),
      analysis: { totals: { revenue: 999999999 } },
      sourceSha256: 'spoofed',
    }),
  );
  assert.deepEqual(
    preview.analysis,
    analyzeStatement(statementCsvTemplate(), period, s.application.financials),
  );
  assert.equal(preview.sourceSha256, await sha256(statementCsvTemplate()));
  assert.equal(
    (await s.db.query('SELECT * FROM documents WHERE application_id=?', [s.application.id])).length,
    0,
  );
  assert.deepEqual(await s.db.query('SELECT id FROM audit'), beforeAudit);
  const { report } = await read<{ report: StatementReport }>(
    await s.call(endpoint, s.owner, 'POST', {
      ...importBody(1),
      analysis: { totals: { revenue: 999999999 } },
    }),
  );
  assert.deepEqual(report.analysis, preview.analysis);
  assert.equal(report.applicationVersion, 2);
  assert.equal(report.createdBy, 'user_sever');
  assert.equal(report.sourceSha256, preview.sourceSha256);
  const [document] = await s.db.query<{ content: string; sha256: string; size: number }>(
    'SELECT content,sha256,size FROM documents WHERE id=?',
    [report.documentId],
  );
  assert.equal(new TextDecoder().decode(fromBase64(document.content)), statementCsvTemplate());
  assert.equal(document.sha256, await sha256(fromBase64(document.content)));
  assert.equal(document.size, new TextEncoder().encode(statementCsvTemplate()).length);
  const detail = await read<ApplicationDetail>(
    await s.call(`/applications/${s.application.id}`, s.owner),
  );
  assert.deepEqual(detail.application.financials, s.application.financials);
  assert.deepEqual(detail.application.score, s.application.score);
  assert.deepEqual(detail.application.decision, s.application.decision);
  assert.equal(detail.timeline.at(-1)?.action, 'statement_analyzed');
  assert.equal(detail.application.version, 2);
  const old = structuredClone(report);
  await read(
    await s.call(`/applications/${s.application.id}`, s.owner, 'PATCH', {
      ...detail.application,
      financials: { ...financials, monthlyRevenue: 1000000 },
    }),
  );
  assert.deepEqual(
    (await read<{ report: StatementReport }>(await s.call(endpoint, s.owner))).report,
    old,
  );
  assert.equal((await s.call(endpoint, s.owner, 'POST', importBody(1))).status, 409);
  assert.equal((await s.db.query('SELECT * FROM statement_reports')).length, 1);
  assert.deepEqual(await s.db.query('PRAGMA foreign_key_check'), []);
});

test('statement dossier enforces owner, submitted-bank visibility, consent gate, state and version', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const other = await s.login('owner@terra.example.test');
  const bank = await s.login('bank@debitus.example.test');
  const admin = await s.login('admin@debitus.example.test');
  const endpoint = `/applications/${s.application.id}/statement`;
  assert.deepEqual(await read(await s.call(endpoint, s.owner)), { report: null });
  assert.equal((await s.call(endpoint)).status, 401);
  assert.equal((await s.call(endpoint, other)).status, 404);
  assert.equal((await s.call(endpoint, bank)).status, 404);
  assert.equal((await s.call(endpoint, admin)).status, 403);
  assert.equal((await s.call(endpoint + '/preview', other, 'POST', importBody(1))).status, 404);
  assert.equal((await s.call(endpoint, bank, 'POST', importBody(1))).status, 403);
  assert.equal((await s.call(endpoint, admin, 'POST', importBody(1))).status, 403);
  assert.equal(
    (await s.call(endpoint, s.owner, 'POST', { ...importBody(1), reviewed: false })).status,
    400,
  );
  assert.equal((await s.call(endpoint, s.owner, 'POST', importBody(999))).status, 409);
  assert.equal(
    (await s.call(endpoint, s.owner, 'POST', { ...importBody(1), period: null })).status,
    400,
  );
  const saved = await read<{ report: StatementReport }>(
    await s.call(endpoint, s.owner, 'POST', importBody(1)),
  );
  await read(
    await s.call(`/applications/${s.application.id}/actions/submit`, s.owner, 'POST', {
      version: 2,
    }),
  );
  assert.deepEqual(await read(await s.call(endpoint, bank)), saved);
  assert.equal((await s.call(endpoint, s.owner, 'POST', importBody(3))).status, 409);
  assert.equal((await s.call(endpoint + '/preview', s.owner, 'POST', importBody(3))).status, 409);
  const download = await s.call(`/documents/${saved.report.documentId}/download`, bank);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), statementCsvTemplate());
  assert.equal((await s.call(`/documents/${saved.report.documentId}/download`, other)).status, 404);
  assert.equal((await s.call(`/documents/${saved.report.documentId}/download`, admin)).status, 403);
});

test('statement insertion rolls back document, report, audit and application on conflict or report failure', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const endpoint = `/applications/${s.application.id}/statement`;
  const beforeAudit = await s.db.query('SELECT * FROM audit');
  await s.db.run(
    `CREATE TRIGGER statement_test_failure BEFORE INSERT ON statement_reports BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END`,
  );
  assert.equal((await s.call(endpoint, s.owner, 'POST', importBody(1))).status, 500);
  const detail = await read<ApplicationDetail>(
    await s.call(`/applications/${s.application.id}`, s.owner),
  );
  assert.equal(detail.application.version, 1);
  assert.equal(detail.documents.length, 0);
  assert.deepEqual(await s.db.query('SELECT * FROM audit'), beforeAudit);
  assert.deepEqual(await s.db.query('SELECT * FROM statement_reports'), []);
  await s.db.run('DROP TRIGGER statement_test_failure');
  const responses = await Promise.all([
    s.call(endpoint, s.owner, 'POST', importBody(1)),
    s.call(endpoint, s.owner, 'POST', importBody(1)),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal((await s.db.query('SELECT * FROM statement_reports')).length, 1);
  assert.equal(
    (await s.db.query('SELECT * FROM documents WHERE application_id=?', [s.application.id])).length,
    1,
  );
  assert.equal((await s.db.query('SELECT * FROM audit')).length, beforeAudit.length + 1);
});

test('statement reports and linked original documents reject modification, deletion and replacement', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const { report } = await read<{ report: StatementReport }>(
    await s.call(`/applications/${s.application.id}/statement`, s.owner, 'POST', importBody(1)),
  );
  for (const statement of [
    ["UPDATE statement_reports SET data='{}' WHERE id=?", report.id, /STATEMENT_APPEND_ONLY/],
    ['DELETE FROM statement_reports WHERE id=?', report.id, /STATEMENT_APPEND_ONLY/],
    [
      'INSERT OR REPLACE INTO statement_reports SELECT * FROM statement_reports WHERE id=?',
      report.id,
      /STATEMENT_APPEND_ONLY/,
    ],
    [
      "UPDATE documents SET content='changed' WHERE id=?",
      report.documentId,
      /STATEMENT_SOURCE_IMMUTABLE/,
    ],
    ['DELETE FROM documents WHERE id=?', report.documentId, /STATEMENT_SOURCE_IMMUTABLE/],
    [
      'INSERT OR REPLACE INTO documents SELECT * FROM documents WHERE id=?',
      report.documentId,
      /STATEMENT_SOURCE_IMMUTABLE/,
    ],
  ] as const)
    await assert.rejects(s.db.run(statement[0], [statement[1]]), statement[2]);
  const [stored] = await s.db.query<{ rowid: number }>('SELECT rowid FROM documents WHERE id=?', [
    report.documentId,
  ]);
  await assert.rejects(
    s.db.run(
      `INSERT OR REPLACE INTO documents(rowid,id,application_id,organization_id,name,category,mime_type,size,sha256,content,synthetic,created_at) SELECT ?, 'replacement',application_id,organization_id,name,category,mime_type,size,sha256,content,synthetic,created_at FROM documents WHERE id=?`,
      [stored.rowid, report.documentId],
    ),
    /STATEMENT_SOURCE_IMMUTABLE/,
  );
  await assert.rejects(
    s.db.run(
      'INSERT INTO statement_reports(id,application_id,organization_id,document_id,data) VALUES(?,?,?,?,?)',
      ['wrong-scope', 'app_terra_missing', 'org_terra', report.documentId, '{}'],
    ),
    /STATEMENT_SCOPE_MISMATCH|STATEMENT_APPEND_ONLY/,
  );
});

test('statement respects existing 20 document limit without side effects', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  for (let i = 0; i < 20; i++)
    await s.db.run(
      'INSERT INTO documents(id,application_id,organization_id,name,category,mime_type,size,sha256,content,synthetic,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [
        `limit-${i}`,
        s.application.id,
        s.application.organizationId,
        `file-${i}.txt`,
        'other',
        'text/plain',
        1,
        'a'.repeat(64),
        'YQ==',
        1,
        new Date().toISOString(),
      ],
    );
  const response = await s.call(
    `/applications/${s.application.id}/statement`,
    s.owner,
    'POST',
    importBody(1),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'DOCUMENT_LIMIT');
  assert.equal((await s.db.query('SELECT * FROM statement_reports')).length, 0);
  const detail = await read<ApplicationDetail>(
    await s.call(`/applications/${s.application.id}`, s.owner),
  );
  assert.equal(detail.application.version, 1);
});

test('bearer can read its own saved report but cannot preview or persist CSV', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const endpoint = `/applications/${s.application.id}/statement`;
  const saved = await read<{ report: StatementReport }>(
    await s.call(endpoint, s.owner, 'POST', importBody(1)),
  );
  const issued = await read<{ token: string }>(
    await s.call('/integrations/tokens', s.owner, 'POST', { name: 'Анализ выписки' }),
  );
  const request = (path: string, method = 'GET', body?: unknown) => s.call(path, '', method, body);
  const bearer = async (path: string, method = 'GET', body?: unknown) => {
    const app = createApp(s.db);
    return app.request(`http://localhost/api${path}`, {
      method,
      headers: { authorization: `Bearer ${issued.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  assert.equal((await request(endpoint)).status, 401);
  assert.deepEqual(await read(await bearer(endpoint)), saved);
  assert.equal((await bearer('/applications/app_terra_missing/statement')).status, 404);
  assert.equal((await bearer(endpoint, 'POST', importBody(2))).status, 403);
  assert.equal((await bearer(endpoint + '/preview', 'POST', importBody(2))).status, 403);
  assert.equal((await s.db.query('SELECT * FROM statement_reports')).length, 1);
});
