import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileOcr, selectedOcrFinancials, valuesFromOcr } from '../src/ocr/reconciliation.js';

const financials = {
  monthlyRevenue: 2400000,
  monthlyExpenses: 1650000,
  monthlyDebtPayment: 120000,
};
const text =
  'Выручка в месяц: 2 400 000 RUB\nОперационные расходы в месяц: 1 650 000 RUB\nКредитные платежи в месяц: 120 000 RUB';

test('OCR reconciliation compares all financial fields and preserves exact evidence', () => {
  const rows = reconcileOcr(text, financials);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.status),
    ['matches', 'matches', 'matches'],
  );
  assert.deepEqual(
    rows.map((row) => row.recognized),
    [2400000, 1650000, 120000],
  );
  assert.equal(rows[0].source, 'Выручка в месяц: 2 400 000 RUB');
  assert.equal(rows[0].manuallyEdited, false);
  assert.equal(reconcileOcr(text, { ...financials, monthlyRevenue: 2500000 })[0].status, 'differs');
});

test('missing OCR values stay null and do not equal an actual zero', () => {
  const rows = reconcileOcr('', { ...financials, monthlyDebtPayment: 0 });
  assert.equal(rows.length, 3);
  assert.ok(
    rows.every(
      (row) => row.status === 'missing' && row.recognized === null && row.effective === null,
    ),
  );
  const zero = reconcileOcr('Кредитные платежи в месяц: 0 RUB', {
    ...financials,
    monthlyDebtPayment: 0,
  });
  assert.equal(zero[2].status, 'matches');
  assert.equal(zero[2].recognized, 0);
  assert.equal(reconcileOcr('Выручка в месяц: 0 RUB', financials)[0].recognized, null);
});

test('duplicate monthly rows and multiple numbers are ambiguous rather than silently selected', () => {
  for (const source of [
    'Выручка в месяц: 2400000 RUB\nВыручка в месяц: 2500000 RUB',
    'Выручка в месяц: 2400000 RUB\nВыручка в месяц: 2400000 RUB',
    'Выручка в месяц: 2400000 RUB, предыдущий месяц: 2100000 RUB',
  ]) {
    const row = reconcileOcr(source, financials)[0];
    assert.equal(row.recognized, null);
    assert.equal(row.status, 'ambiguous');
    assert.match(row.hint, /несколько/);
  }
});

test('annual periods, large units, foreign currencies and negative values are never converted', () => {
  for (const source of [
    'Выручка за год: 28800000 RUB',
    'Выручка в месяц: 2400 тыс. руб.',
    'Выручка в месяц: 2 млн руб.',
    'Monthly revenue: 2400000 USD',
    'Выручка в месяц: -2400000 RUB',
  ]) {
    const row = reconcileOcr(source, financials)[0];
    assert.equal(row.recognized, null);
    assert.equal(row.effective, null);
    assert.equal(row.status, 'missing');
    assert.match(row.hint, /период/);
  }
});

test('manual correction compares the entered value while retaining original OCR evidence', () => {
  const values = { ...valuesFromOcr(text), monthlyRevenue: '2500000' };
  const row = reconcileOcr(text, financials, values)[0];
  assert.equal(row.recognized, 2400000);
  assert.equal(row.effective, 2500000);
  assert.equal(row.originalRecognized, 2400000);
  assert.equal(row.status, 'differs');
  assert.equal(row.manuallyEdited, true);
  assert.equal(row.originalSource, 'Выручка в месяц: 2 400 000 RUB');
  const edited = text.replace('2 400 000', '2 500 000');
  const afterTextChange = reconcileOcr(edited, financials, valuesFromOcr(edited), text)[0];
  assert.equal(afterTextChange.source, 'Выручка в месяц: 2 500 000 RUB');
  assert.equal(afterTextChange.originalSource, row.originalSource);
  assert.equal(afterTextChange.originalRecognized, 2400000);
});

test('only explicitly selected valid monthly values can be applied to a draft', () => {
  const values = { monthlyRevenue: '2500000', monthlyExpenses: '', monthlyDebtPayment: '0' };
  assert.deepEqual(selectedOcrFinancials(values, {}), {});
  assert.deepEqual(selectedOcrFinancials(values, { monthlyRevenue: true }), {
    monthlyRevenue: 2500000,
  });
  assert.deepEqual(selectedOcrFinancials(values, { monthlyDebtPayment: true }), {
    monthlyDebtPayment: 0,
  });
  assert.throws(
    () => selectedOcrFinancials(values, { monthlyExpenses: true }),
    /Операционные расходы/,
  );
  assert.throws(
    () => selectedOcrFinancials({ monthlyRevenue: '0' }, { monthlyRevenue: true }),
    /от 1/,
  );
  assert.throws(() => selectedOcrFinancials({ monthlyRevenue: '-1' }, { monthlyRevenue: true }));
  assert.equal(reconcileOcr(text)[0].status, 'unavailable');
});
