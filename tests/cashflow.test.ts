import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import {
  calculateCashflow,
  CashflowInputError,
  validateCashflowInputs,
  type CashflowInputs,
} from '../shared/cashflow.js';
import { calculateScenario, DomainError } from '../server/domain.js';
import { calculateCashflowForOrganization, registerCashflowRoutes } from '../server/cashflow.js';
import type { AppEnv } from '../server/http-types.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';
import { DEMO_ORGANIZATIONS, initializeDatabase } from '../server/seed.js';

const at = '2026-10-24T12:00:00.000Z';
const base: CashflowInputs = {
  startingMonth: '2026-12',
  horizonMonths: 6,
  openingBalance: 5000,
  monthlyInflow: 10000,
  monthlyOperatingOutflow: 7000,
  monthlyExistingDebtPayment: 1000,
  investmentCost: 120000,
  monthlyAdditionalNetCash: 4000,
  benefitStartMonth: 3,
  seasonalRevenuePct: Array(12).fill(100),
  assumptionsConfirmed: true,
};
const loan = (inputs = base, amount = 120000, term = 12, rate = 0) =>
  calculateScenario(
    amount,
    term,
    rate,
    {
      monthlyRevenue: inputs.monthlyInflow,
      monthlyExpenses: inputs.monthlyOperatingOutflow,
      monthlyDebtPayment: inputs.monthlyExistingDebtPayment,
    },
    `${inputs.startingMonth}-01`,
  );

test('credit proceeds are financing, a purchase cancels them in month one, and repayments begin the next month', () => {
  const result = calculateCashflow(base, loan(), at);
  assert.equal(result.rows[0].month, '2026-12');
  assert.equal(result.rows[1].month, '2027-01');
  assert.equal(result.rows[0].inflow, 10000);
  assert.equal(result.rows[0].loanProceeds, 120000);
  assert.equal(result.rows[0].investmentOutflow, 120000);
  assert.equal(result.rows[0].loanPayment, 0);
  assert.equal(result.rows[0].noLoan.endingBalance, 7000);
  assert.equal(result.rows[0].withLoan.endingBalance, 7000);
  assert.equal(result.rows[1].loanPayment, 10000);
  assert.equal(result.rows[1].withLoan.endingBalance, -1000);
  assert.equal(result.noLoan.firstNegativeMonth, null);
  assert.equal(result.withLoan.firstNegativeMonth, '2027-01');
  assert.equal(result.rows[0].additionalNetCash, 0);
  assert.equal(result.rows[1].additionalNetCash, 0);
  assert.equal(result.rows[2].additionalNetCash, 4000);
  assert.equal(result.rows[2].withLoan.endingBalance, -5000);
  assert.equal(result.loan.debtAfterHorizon, 70000);
  assert.equal(result.loan.paymentsAfterHorizon, 70000);
  assert.equal(result.loan.totalRepayment, 120000);
});

test('both tracks carry balances exactly and include an adverse investment effect without inventing overdraft', () => {
  const inputs = { ...base, monthlyAdditionalNetCash: -500, benefitStartMonth: 1 };
  const result = calculateCashflow(inputs, loan(inputs), at);
  for (const track of ['noLoan', 'withLoan'] as const) {
    let prior = inputs.openingBalance;
    for (const row of result.rows) {
      assert.equal(row[track].openingBalance, prior);
      assert.equal(row[track].endingBalance, prior + row[track].netCash);
      assert.ok(Number.isSafeInteger(row[track].endingBalance));
      prior = row[track].endingBalance;
    }
    assert.equal(result[track].endingBalance, prior);
    assert.equal(
      result[track].minimumBalance,
      Math.min(inputs.openingBalance, ...result.rows.map((row) => row[track].endingBalance)),
    );
  }
  assert.ok(result.withLoan.endingBalance < 0);
  assert.ok(result.rows.every((row) => row.additionalNetCash === -500));
  assert.deepEqual(base.seasonalRevenuePct, Array(12).fill(100));
});

test('seasonality follows calendar months across a year boundary and rounds half up in whole rubles', () => {
  const factors = Array(12).fill(100);
  factors[11] = 50;
  factors[0] = 150;
  const inputs = { ...base, monthlyInflow: 101, seasonalRevenuePct: factors };
  const result = calculateCashflow(inputs, loan(inputs), at);
  assert.equal(result.rows[0].inflow, 51);
  assert.equal(result.rows[1].inflow, 152);
  assert.equal(result.rows[2].inflow, 101);
  assert.ok(result.rows.every((row) => row.operatingOutflow === 7000));
  assert.ok(result.rows.every((row) => row.existingDebtPayment === 1000));
});

test('the horizon does not erase remaining credit obligations or pull future investment benefits forward', () => {
  const inputs: CashflowInputs = { ...base, horizonMonths: 12, benefitStartMonth: 60 };
  const result = calculateCashflow(inputs, loan(inputs, 100001, 6, 2190), at);
  assert.equal(result.rows.length, 12);
  assert.equal(result.rows[6].loanPayment, loan(inputs, 100001, 6, 2190).schedule[5].payment);
  assert.ok(result.rows.slice(7).every((row) => row.loanPayment === 0));
  assert.ok(result.rows.every((row) => row.additionalNetCash === 0));
  assert.equal(result.loan.debtAfterHorizon, 0);
  assert.equal(result.loan.paymentsAfterHorizon, 0);
  const shorter = calculateCashflow(base, loan(base, 100001, 12, 2190), at);
  assert.equal(shorter.loan.debtAfterHorizon, loan(base, 100001, 12, 2190).schedule[4].balance);
  assert.equal(
    shorter.loan.paymentsAfterHorizon,
    loan(base, 100001, 12, 2190)
      .schedule.slice(5)
      .reduce((s, row) => s + row.payment, 0),
  );
});

test('a zero starting balance is stock, not income, and a zero month is not a negative month', () => {
  const inputs = {
    ...base,
    openingBalance: 0,
    monthlyInflow: 0,
    monthlyOperatingOutflow: 0,
    monthlyExistingDebtPayment: 0,
    monthlyAdditionalNetCash: 0,
  };
  const result = calculateCashflow(inputs, loan(inputs), at);
  assert.ok(result.rows.every((row) => row.noLoan.endingBalance === 0 && row.inflow === 0));
  assert.equal(result.noLoan.firstNegativeMonth, null);
  assert.equal(result.withLoan.firstNegativeMonth, '2027-01');
});

test('invalid money, months, unconfirmed assumptions, and incomplete seasonality are rejected', () => {
  for (const patch of [
    { startingMonth: '2026-00' },
    { startingMonth: '2026-13' },
    { startingMonth: '2026-2' },
    { startingMonth: '1999-12' },
    { horizonMonths: 7 },
    { openingBalance: -1 },
    { openingBalance: Number.MAX_SAFE_INTEGER + 1 },
    { monthlyInflow: NaN },
    { monthlyOperatingOutflow: 0.5 },
    { monthlyExistingDebtPayment: 1_000_000_001 },
    { monthlyAdditionalNetCash: -1_000_000_001 },
    { investmentCost: Infinity },
    { benefitStartMonth: 0 },
    { benefitStartMonth: 61 },
    { assumptionsConfirmed: false },
    { seasonalRevenuePct: Array(11).fill(100) },
    { seasonalRevenuePct: [...Array(11).fill(100), 301] },
  ])
    assert.throws(
      () => validateCashflowInputs({ ...base, ...patch }),
      CashflowInputError,
      JSON.stringify(patch),
    );
  const sparse = Array(12);
  sparse[0] = 100;
  assert.throws(
    () => validateCashflowInputs({ ...base, seasonalRevenuePct: sparse }),
    CashflowInputError,
  );
  for (const value of [null, [], 'bad'])
    assert.throws(() => validateCashflowInputs(value), CashflowInputError);
});

test('a supplied schedule must be complete, chronological, integral and close the principal', () => {
  const valid = loan();
  for (const change of [
    (l: typeof valid) => {
      l.schedule.pop();
    },
    (l: typeof valid) => {
      l.schedule[0].dueDate = '2026-12-01';
    },
    (l: typeof valid) => {
      l.schedule[0].payment += 1;
    },
    (l: typeof valid) => {
      l.schedule[0].principal = 0.1;
    },
    (l: typeof valid) => {
      l.schedule[0].balance += 1;
    },
    (l: typeof valid) => {
      l.schedule[1].month = 1;
    },
    (l: typeof valid) => {
      l.schedule[0].interest = NaN;
    },
  ]) {
    const modified = structuredClone(valid);
    change(modified);
    assert.throws(() => calculateCashflow(base, modified, at), CashflowInputError);
  }
  assert.throws(() => calculateCashflow(base, valid, 'invalid'), CashflowInputError);
});

test('large supported balances remain exact without truncation or mutation', () => {
  const inputs: CashflowInputs = {
    ...base,
    horizonMonths: 12,
    openingBalance: 1_000_000_000,
    monthlyInflow: 1_000_000_000,
    monthlyOperatingOutflow: 0,
    monthlyExistingDebtPayment: 0,
    seasonalRevenuePct: Array(12).fill(300),
    monthlyAdditionalNetCash: 0,
  };
  const before = structuredClone(inputs),
    schedule = loan(inputs);
  const result = calculateCashflow(inputs, schedule, at);
  assert.equal(result.noLoan.endingBalance, 37_000_000_000);
  assert.equal(result.noLoan.minimumBalance, 1_000_000_000);
  assert.deepEqual(inputs, before);
  assert.deepEqual(schedule, loan(inputs));
  assert.deepEqual(result, calculateCashflow(inputs, schedule, at));
});

test('server model enforces product boundaries and publishes only the authenticated organization source', () => {
  const organization = DEMO_ORGANIZATIONS[0];
  const body = {
    ...base,
    productId: 'working_capital',
    amount: 120000,
    termMonths: 12,
    organizationId: 'foreign-company',
    rateBps: 0,
  };
  const result = calculateCashflowForOrganization(organization, body);
  assert.equal(result.source.organizationId, organization.id);
  assert.equal(result.loan.rateBps, 2450);
  assert.equal(result.rows[0].loanProceeds, 120000);
  assert.throws(
    () => calculateCashflowForOrganization(organization, { ...body, amount: 1 }),
    DomainError,
  );
  assert.throws(
    () => calculateCashflowForOrganization(organization, { ...body, termMonths: 1 }),
    DomainError,
  );
  assert.throws(
    () => calculateCashflowForOrganization(organization, { ...body, assumptionsConfirmed: false }),
    (error: unknown) => error instanceof DomainError && error.code === 'INVALID_CASHFLOW',
  );
});

test('cashflow endpoint permits a client with an organization, denies bank and administrator, and changes no profile', async () => {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const organization = DEMO_ORGANIZATIONS[0];
  const before = await db.query('SELECT * FROM organizations WHERE id=?', [organization.id]);
  for (const role of ['client', 'bank', 'admin'] as const) {
    const app = new Hono<AppEnv>();
    app.use('/api/*', async (c, next) => {
      c.set('user', {
        id: `u-${role}`,
        name: role,
        email: `${role}@example.test`,
        role,
        organizationId: organization.id,
      });
      await next();
    });
    app.onError((error, c) =>
      c.json({ error: error.message }, error instanceof DomainError ? (error.status as 400) : 500),
    );
    registerCashflowRoutes(app, db);
    const response = await app.request('http://localhost/api/scenario/cashflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...base,
        productId: 'working_capital',
        amount: 120000,
        termMonths: 12,
        organizationId: 'foreign',
      }),
    });
    assert.equal(response.status, role === 'client' ? 200 : 403, role);
    if (role === 'client')
      assert.equal((await response.json()).source.organizationId, organization.id);
  }
  assert.deepEqual(
    await db.query('SELECT * FROM organizations WHERE id=?', [organization.id]),
    before,
  );
  db.close();
});
