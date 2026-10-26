import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';
import { initializeDatabase } from '../server/seed.js';
import { calculateScenario } from '../server/domain.js';
import {
  initialServicing,
  previewPrepayment,
  recordPrepayment,
  recordScheduledPayment,
  servicingCsv,
  servicingDate,
  servicingPayment,
} from '../shared/servicing.js';
import type { Application, ApplicationDetail } from '../shared/types.js';
import type { LoanServicingState, PrepaymentPreview } from '../shared/servicing.js';

const financials = {
  monthlyRevenue: 2400000,
  monthlyExpenses: 1650000,
  monthlyDebtPayment: 120000,
};
function funded(amount = 1200000, termMonths = 24, rateBps = 2450): Application {
  const calculation = calculateScenario(amount, termMonths, rateBps, financials, '2026-01-31');
  const { schedule: _, ...offer } = calculation;
  return {
    id: 'fixture',
    number: 'DK-fixture',
    organizationId: 'org_sever',
    organizationName: 'Мастерская',
    productId: 'working_capital',
    amount,
    termMonths,
    financials,
    purpose: 'Материалы',
    consent: true,
    version: 1,
    status: 'funded',
    score: null,
    checks: [],
    submittedAt: '2026-01-01',
    signedAt: '2026-01-30',
    fundedAt: '2026-01-31T23:45:00.000Z',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-31',
    decision: {
      outcome: 'approved',
      reasons: [],
      requestedDocuments: [],
      offer,
      ruleVersion: 'fixture',
      decidedBy: 'bank',
      decidedAt: '2026-01-29',
    },
  };
}
const metadata = (n: number) => ({
  id: `event-${n}`,
  recordedAt: `2026-10-24T12:00:${String(n).padStart(2, '0')}.000Z`,
  actor: 'Предприниматель',
});

test('servicing calendar anchors short and leap months to funded date; saved offer matches canonical graph', () => {
  const a = funded();
  const state = initialServicing(a);
  assert.equal(state.version, 0);
  assert.equal(state.schedule[0].dueDate, '2026-02-28');
  assert.equal(state.schedule[1].dueDate, '2026-03-31');
  assert.equal(servicingDate('2028-01-31', 1), '2028-02-29');
  assert.equal(servicingDate('2026-12-31', 1), '2027-01-31');
  assert.throws(() => servicingDate('2026-02-30', 1));
  assert.deepEqual(
    state.schedule,
    calculateScenario(a.amount, a.termMonths, 2450, financials, '2026-01-31').schedule,
  );
  assert.equal(state.balance, a.amount);
  assert.equal(state.remainingPayments, a.decision!.offer!.totalRepayment);
  assert.equal(state.prepaymentAvailable, false);
  assert.equal(state.simulated, true);
  assert.throws(() => initialServicing({ ...a, fundedAt: null }));
  assert.throws(() => initialServicing({ ...a, status: 'signed' }));
  a.decision!.offer!.monthlyPayment++;
  assert.throws(() => initialServicing(a));
});

test('scheduled installments conserve principal and rounded interest until exact full repayment', () => {
  for (const rate of [0, 1, 2190, 2450, 10000]) {
    for (const amount of [100000, 1200001, 30000000]) {
      let state = initialServicing(funded(amount, 60, rate));
      const total = state.remainingPayments;
      const rows = [...state.schedule];
      for (let index = 0; index < rows.length; index++) {
        state = recordScheduledPayment(state, metadata(index));
        assert.equal(state.history.at(-1)!.interest, rows[index].interest);
        assert.equal(state.balance + state.paidPrincipal, amount);
        assert.equal(state.totalRecorded + state.remainingPayments, total);
        assert.equal(state.version, index + 1);
      }
      assert.equal(state.status, 'closed');
      assert.equal(state.balance, 0);
      assert.equal(state.nextPayment, null);
      assert.throws(() => recordScheduledPayment(state, metadata(61)));
    }
  }
});

test('prepayment preview is pure, reduces payment or term, and requires the paid-period boundary', () => {
  const initial = initialServicing(funded());
  assert.throws(() => previewPrepayment(initial, 100000, 'reduce_payment'));
  const state = recordScheduledPayment(initial, metadata(1));
  const frozen = structuredClone(state);
  const lower = previewPrepayment(state, 300000, 'reduce_payment');
  const shorter = previewPrepayment(state, 300000, 'reduce_term');
  assert.deepEqual(state, frozen);
  assert.equal(lower.effectiveDate, '2026-02-28');
  assert.equal(lower.previousBalance - lower.balance, 300000);
  assert.ok(lower.nextPayment < lower.previousPayment);
  assert.equal(lower.remainingTermMonths, lower.previousTermMonths);
  assert.equal(shorter.nextPayment, shorter.previousPayment);
  assert.ok(shorter.remainingTermMonths < shorter.previousTermMonths);
  assert.ok(lower.interestSaved > 0 && shorter.interestSaved > lower.interestSaved);
  assert.equal(lower.schedule[0].dueDate, '2026-03-31');
  const saved = recordPrepayment(
    state,
    { ...lower, balance: 0, schedule: [], interestSaved: 9999999 },
    metadata(2),
  );
  assert.equal(saved.balance, lower.balance);
  assert.deepEqual(saved.schedule, lower.schedule);
  assert.equal(saved.paidInterest, state.paidInterest);
  assert.equal(saved.history.at(-1)!.interest, 0);
  assert.equal(saved.prepaymentAvailable, false);
  assert.throws(() => previewPrepayment(saved, 1, 'reduce_term'));
  assert.equal(recordScheduledPayment(saved, metadata(3)).prepaymentAvailable, true);
  for (const amount of [0, -1, 0.5, state.balance + 1, NaN, Infinity])
    assert.throws(() => previewPrepayment(state, amount, 'reduce_payment'));
  assert.throws(() => previewPrepayment(state, 10, 'forged' as never));
});

test('full and tiny residual prepayment stay exact with no invented period interest', () => {
  const paid = recordScheduledPayment(initialServicing(funded()), metadata(1));
  const full = previewPrepayment(paid, paid.balance, 'reduce_term');
  assert.equal(full.nextPayment, 0);
  assert.equal(full.interestSaved, paid.remainingInterest);
  const closed = recordPrepayment(paid, full, metadata(2));
  assert.equal(closed.status, 'closed');
  assert.equal(closed.paidPrincipal, paid.offer.amount);
  assert.equal(closed.schedule.length, 0);
  assert.throws(() => previewPrepayment(closed, 1, 'reduce_term'));
  const tiny = previewPrepayment(paid, paid.balance - 1, 'reduce_payment');
  assert.equal(tiny.balance, 1);
  assert.equal(tiny.schedule.length, 1);
  assert.equal(tiny.nextPayment, 1);
  assert.equal(tiny.schedule[0].balance, 0);
  assert.equal(servicingPayment(1, 60, 0), 1);
  const csv = servicingCsv(closed);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('Досрочное погашение'));
  assert.ok(csv.includes('2026-02-28'));
  assert.ok(csv.includes('Моделирование'));
});

test('whole-ruble recalculation never adds interest after tiny prepayments', () => {
  for (const amount of [100000, 100001, 1200000, 30000000])
    for (const rate of [0, 1, 10, 100, 2190, 2450, 10000])
      for (const term of [6, 12, 24, 60]) {
        const paid = recordScheduledPayment(
          initialServicing(funded(amount, term, rate)),
          metadata(1),
        );
        for (const amount of [
          1,
          2,
          10,
          100,
          1000,
          Math.floor(paid.balance / 2),
          paid.balance - 1,
          paid.balance,
        ])
          for (const mode of ['reduce_payment', 'reduce_term'] as const) {
            const preview = previewPrepayment(paid, amount, mode);
            assert.ok(preview.interestSaved >= 0, JSON.stringify({ amount, rate, term, mode }));
            assert.ok(preview.nextPayment <= preview.previousPayment);
            assert.equal(
              preview.schedule.reduce((sum, row) => sum + row.principal, 0),
              paid.balance - amount,
            );
          }
      }
});

async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body as T;
}
async function setup(filename = ':memory:') {
  const db = openSqliteDatabase(filename);
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
  const call = (route: string, cookie = '', method = 'GET', body?: unknown, bearer = '') =>
    app.request(`http://localhost/api${route}`, {
      method,
      headers: {
        cookie,
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (email: string) => {
    const response = await call('/auth/login', '', 'POST', { email, password: 'Demo2026!' });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const owner = await login('owner@sever.example.test');
  const detail = await read<ApplicationDetail>(
    await call('/applications', owner, 'POST', {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      purpose: 'Материалы',
      financials,
      consent: true,
    }),
  );
  const application = {
    ...detail.application,
    status: 'funded' as const,
    decision: funded().decision,
    fundedAt: funded().fundedAt,
    signedAt: funded().signedAt,
  };
  await db.run('UPDATE applications SET data=?,status=? WHERE id=?', [
    JSON.stringify(application),
    'funded',
    application.id,
  ]);
  return {
    db,
    call,
    login,
    owner,
    application,
    endpoint: `/applications/${application.id}/servicing`,
  };
}
const payment = (version = 0, idempotencyKey = 'payment-00000001') => ({
  version,
  idempotencyKey,
  confirmed: true,
});

test('GET and preview never write; payment and early repayment preserve offer and application state', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const auditBefore = await s.db.query('SELECT * FROM audit');
  const initial = (await read<{ servicing: LoanServicingState }>(await s.call(s.endpoint, s.owner)))
    .servicing;
  assert.equal(initial.version, 0);
  assert.deepEqual(await s.db.query('SELECT * FROM loan_servicing'), []);
  assert.deepEqual(await s.db.query('SELECT * FROM audit'), auditBefore);
  const saved = await read<{ servicing: LoanServicingState }>(
    await s.call(s.endpoint + '/payment', s.owner, 'POST', payment()),
  );
  assert.equal(saved.servicing.version, 1);
  const preBody = { version: 1, amount: 300000, mode: 'reduce_payment' };
  const beforePreview = await s.db.query('SELECT * FROM loan_servicing_events');
  const preview = await read<{ preview: PrepaymentPreview }>(
    await s.call(s.endpoint + '/prepayment/preview', s.owner, 'POST', preBody),
  );
  assert.deepEqual(preview.preview, previewPrepayment(saved.servicing, 300000, 'reduce_payment'));
  assert.deepEqual(await s.db.query('SELECT * FROM loan_servicing_events'), beforePreview);
  const prepaid = await read<{ servicing: LoanServicingState }>(
    await s.call(s.endpoint + '/prepayment', s.owner, 'POST', {
      ...preBody,
      confirmed: true,
      idempotencyKey: 'prepayment-0001',
    }),
  );
  assert.equal(prepaid.servicing.version, 2);
  assert.deepEqual(prepaid.servicing.schedule, preview.preview.schedule);
  const latest = await read<ApplicationDetail>(
    await s.call(`/applications/${s.application.id}`, s.owner),
  );
  assert.deepEqual(latest.application, s.application);
  assert.equal(latest.timeline.at(-1)!.action, 'servicing_prepayment_recorded');
  assert.equal((await s.db.query('SELECT * FROM audit')).length, auditBefore.length + 2);
  assert.deepEqual(await s.db.query('PRAGMA foreign_key_check'), []);
});

test('idempotency returns original response after later actions, rejects changed payload and races once', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const responses = await Promise.all([
    s.call(s.endpoint + '/payment', s.owner, 'POST', payment()),
    s.call(s.endpoint + '/payment', s.owner, 'POST', payment()),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const first = await read<{ servicing: LoanServicingState }>(responses[0]);
  assert.deepEqual(await read(responses[1]), first);
  assert.equal((await s.db.query('SELECT * FROM loan_servicing_events')).length, 1);
  assert.equal((await s.call(s.endpoint + '/payment', s.owner, 'POST', payment(1))).status, 409);
  const race = await Promise.all([
    s.call(s.endpoint + '/payment', s.owner, 'POST', payment(1, 'payment-00000002')),
    s.call(s.endpoint + '/payment', s.owner, 'POST', payment(1, 'payment-00000003')),
  ]);
  assert.deepEqual(race.map((response) => response.status).sort(), [201, 409]);
  assert.deepEqual(
    await read(await s.call(s.endpoint + '/payment', s.owner, 'POST', payment())),
    first,
  );
  const latest = await read<{ servicing: LoanServicingState }>(await s.call(s.endpoint, s.owner));
  assert.equal(latest.servicing.version, 2);
  assert.equal(latest.servicing.history.length, 2);
});

test('prepayment keys include amount, mode and version; stale previews never mutate state', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  await read(await s.call(s.endpoint + '/payment', s.owner, 'POST', payment()));
  const body = {
    version: 1,
    amount: 100000,
    mode: 'reduce_term',
    idempotencyKey: 'prepayment-key-1',
    confirmed: true,
  };
  const first = await read(await s.call(s.endpoint + '/prepayment', s.owner, 'POST', body));
  assert.deepEqual(
    await read(await s.call(s.endpoint + '/prepayment', s.owner, 'POST', body)),
    first,
  );
  for (const changed of [{ amount: 100001 }, { mode: 'reduce_payment' }, { version: 2 }])
    assert.equal(
      (await s.call(s.endpoint + '/prepayment', s.owner, 'POST', { ...body, ...changed })).status,
      409,
    );
  assert.equal(
    (
      await s.call(s.endpoint + '/prepayment/preview', s.owner, 'POST', {
        version: 1,
        amount: 10000,
        mode: 'reduce_payment',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await s.call(s.endpoint + '/prepayment', s.owner, 'POST', {
        ...body,
        idempotencyKey: 'prepayment-key-2',
        version: 2,
      })
    ).status,
    409,
  );
  assert.equal((await s.db.query('SELECT * FROM loan_servicing_events')).length, 2);
});

test('owner, bank, admin, tokens, invalid and unfunded requests obey server boundaries', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const other = await s.login('owner@terra.example.test'),
    bank = await s.login('bank@debitus.example.test'),
    admin = await s.login('admin@debitus.example.test');
  assert.equal((await s.call(s.endpoint)).status, 401);
  assert.equal((await s.call(s.endpoint, other)).status, 404);
  assert.equal((await s.call(s.endpoint, admin)).status, 403);
  assert.equal((await s.call(s.endpoint, bank)).status, 200);
  for (const user of [bank, admin, other]) {
    assert.ok(
      [403, 404].includes((await s.call(s.endpoint + '/payment', user, 'POST', payment())).status),
    );
    assert.ok(
      [403, 404].includes(
        (
          await s.call(s.endpoint + '/prepayment/preview', user, 'POST', {
            version: 0,
            amount: 1,
            mode: 'reduce_term',
          })
        ).status,
      ),
    );
  }
  const { token } = await read<{ token: string }>(
    await s.call('/integrations/tokens', s.owner, 'POST', { name: 'Сопровождение' }),
  );
  assert.equal((await s.call(s.endpoint + '/payment', '', 'POST', payment(), token)).status, 403);
  assert.equal(
    (
      await s.call(
        s.endpoint + '/prepayment/preview',
        '',
        'POST',
        { version: 0, amount: 1, mode: 'reduce_term' },
        token,
      )
    ).status,
    403,
  );
  for (const body of [
    { ...payment(), confirmed: false },
    { ...payment(), idempotencyKey: 'short' },
    { ...payment(), schedule: [] },
    { ...payment(), amount: 1 },
    { ...payment(), version: -1 },
    null,
  ]) {
    assert.ok(
      [400, 409].includes((await s.call(s.endpoint + '/payment', s.owner, 'POST', body)).status),
    );
  }
  assert.equal((await s.call('/applications/app_sever_working/servicing', s.owner)).status, 409);
  assert.equal(
    (await s.call('/applications/app_sever_working/servicing/payment', s.owner, 'POST', payment()))
      .status,
    409,
  );
  assert.equal((await s.call('/applications/app_sever_working/servicing', bank)).status, 404);
  assert.deepEqual(await s.db.query('SELECT * FROM loan_servicing'), []);
});

test('ledger and audit failure roll back the whole operation, including initial and later CAS', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const auditBefore = await s.db.query('SELECT * FROM audit');
  await s.db.run(
    "CREATE TRIGGER servicing_fail BEFORE INSERT ON loan_servicing_events BEGIN SELECT RAISE(ABORT,'FIXTURE_FAILURE'); END",
  );
  assert.equal((await s.call(s.endpoint + '/payment', s.owner, 'POST', payment())).status, 500);
  assert.deepEqual(await s.db.query('SELECT * FROM loan_servicing'), []);
  assert.deepEqual(await s.db.query('SELECT * FROM audit'), auditBefore);
  await s.db.run('DROP TRIGGER servicing_fail');
  await read(await s.call(s.endpoint + '/payment', s.owner, 'POST', payment()));
  const beforeState = await s.db.query('SELECT * FROM loan_servicing');
  await s.db.run(
    "CREATE TRIGGER servicing_audit_fail BEFORE INSERT ON audit WHEN NEW.action='servicing_payment_recorded' BEGIN SELECT RAISE(ABORT,'FIXTURE_FAILURE'); END",
  );
  assert.equal(
    (await s.call(s.endpoint + '/payment', s.owner, 'POST', payment(1, 'payment-failed-2'))).status,
    500,
  );
  assert.deepEqual(await s.db.query('SELECT * FROM loan_servicing'), beforeState);
  assert.equal((await s.db.query('SELECT * FROM loan_servicing_events')).length, 1);
  await s.db.run('DROP TRIGGER servicing_audit_fail');
  const retried = await read<{ servicing: LoanServicingState }>(
    await s.call(s.endpoint + '/payment', s.owner, 'POST', payment(1, 'payment-failed-2')),
  );
  assert.equal(retried.servicing.version, 2);
});

test('events are append-only and scope/version guards reject replacement and cross-tenant records', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  await read(await s.call(s.endpoint + '/payment', s.owner, 'POST', payment()));
  for (const sql of [
    'UPDATE loan_servicing_events SET data=data',
    'DELETE FROM loan_servicing_events',
    'INSERT OR REPLACE INTO loan_servicing_events SELECT * FROM loan_servicing_events',
    'DELETE FROM loan_servicing',
    'INSERT OR REPLACE INTO loan_servicing SELECT * FROM loan_servicing',
    "UPDATE loan_servicing SET organization_id='org_terra'",
    'UPDATE loan_servicing SET version=version+2',
  ])
    await assert.rejects(s.db.run(sql));
  assert.equal((await s.db.query('SELECT * FROM loan_servicing_events')).length, 1);
  assert.deepEqual(await s.db.query('PRAGMA foreign_key_check'), []);
});

test('closed service stays readable and funded; restart preserves schedule, history and idempotent results', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'debitus-servicing-'));
  let reopened: ReturnType<typeof openSqliteDatabase> | null = null;
  t.after(() => {
    reopened?.close();
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(dir, { recursive: true, force: true });
  });
  const filename = path.join(dir, 'case.sqlite');
  const s = await setup(filename);
  const first = await read<{ servicing: LoanServicingState }>(
    await s.call(s.endpoint + '/payment', s.owner, 'POST', payment()),
  );
  const body = {
    version: 1,
    amount: first.servicing.balance,
    mode: 'reduce_payment',
    confirmed: true,
    idempotencyKey: 'complete-prepayment',
  };
  const closed = await read<{ servicing: LoanServicingState }>(
    await s.call(s.endpoint + '/prepayment', s.owner, 'POST', body),
  );
  assert.equal(closed.servicing.status, 'closed');
  assert.equal(
    (await s.call(s.endpoint + '/payment', s.owner, 'POST', payment(2, 'extra-payment-3'))).status,
    409,
  );
  const { application } = await read<ApplicationDetail>(
    await s.call(`/applications/${s.application.id}`, s.owner),
  );
  assert.equal(application.status, 'funded');
  s.db.close();
  const db = openSqliteDatabase(filename);
  reopened = db;
  db.migrate('migrations');
  const app = createApp(db);
  const get = await app.request(`http://localhost/api${s.endpoint}`, {
    headers: { cookie: s.owner },
  });
  assert.deepEqual(await read(get), closed);
  const retry = await app.request(`http://localhost/api${s.endpoint}/prepayment`, {
    method: 'POST',
    headers: { cookie: s.owner, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.deepEqual(await read(retry), closed);
  assert.equal((await db.query('SELECT * FROM loan_servicing_events')).length, 2);
});
