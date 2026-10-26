import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateScenario } from '../server/domain.js';

const financials = {
  monthlyRevenue: 2400000,
  monthlyExpenses: 1650000,
  monthlyDebtPayment: 120000,
};

test('scenario defaults to current UTC date and explains the payment calendar', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-31T23:59:00Z') });
  const result = calculateScenario(1200000, 6, 2450, financials);
  assert.equal(result.schedule[0].dueDate, '2026-11-30');
  assert.equal(result.schedule[3].dueDate, '2027-02-28');
  assert.ok(result.assumptions.some((line) => line.includes('2026-10-31 (UTC)')));
  t.mock.timers.tick(120000);
  const next = calculateScenario(1200000, 6, 2450, financials);
  assert.equal(next.schedule[0].dueDate, '2026-12-01');
  assert.equal(next.monthlyPayment, result.monthlyPayment);
});

test('explicit assessment date preserves a historical schedule independently of current time', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-06-19T12:00:00Z') });
  const result = calculateScenario(1200000, 6, 2450, financials, '2028-01-31');
  assert.equal(result.schedule[0].dueDate, '2028-02-29');
  assert.equal(result.schedule[1].dueDate, '2028-03-31');
  assert.ok(result.assumptions.some((line) => line.includes('2028-01-31 (UTC)')));
  t.mock.timers.tick(86400000);
  assert.deepEqual(calculateScenario(1200000, 6, 2450, financials, '2028-01-31'), result);
});
