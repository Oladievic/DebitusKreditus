import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLoanSummary } from '../shared/loan-summary.js';
import { createLoanContract } from '../server/loan-contract.js';
import type { Offer } from '../shared/types';

const offer: Offer = {
  amount: 1200000,
  termMonths: 12,
  rateBps: 2195,
  monthlyPayment: 112276,
  totalRepayment: 1347308,
  totalInterest: 147308,
};

const plain = (value: string) => value.replace(/[\s\u00a0\u202f]/g, '');

test('loan summary preserves saved totals when the last payment differs from the regular payment', () => {
  const saved = structuredClone(offer);
  const items = buildLoanSummary(offer);
  assert.deepEqual(
    items.map((item) => item.id),
    ['amount', 'payment', 'cost', 'security', 'overdue', 'early_repayment'],
  );
  assert.notEqual(offer.monthlyPayment * offer.termMonths, offer.totalRepayment);
  assert.equal(plain(items[0].value), '1200000₽');
  assert.equal(plain(items[1].value), '112276₽');
  assert.match(items[1].detail, /12 мес.; 21,95% годовых/);
  assert.match(items[1].detail, /Последний платёж может отличаться из-за округления/);
  assert.equal(plain(items[2].value), '1347308₽');
  assert.match(plain(items[2].detail), /147308₽/);
  assert.deepEqual(offer, saved);
});

test('contract uses exactly the same six conditions and saved offer values as the interface', () => {
  const application = { organizationName: 'ООО «Северная мастерская»', number: 'DK-2026-0042' };
  const text = createLoanContract(application, offer);
  for (const item of buildLoanSummary(offer)) {
    assert.ok(text.includes(`${item.title}\n${item.value}\n${item.detail}`), item.id);
  }
  for (const line of [
    'ДЕМОНСТРАЦИОННЫЙ КРЕДИТНЫЙ ДОГОВОР',
    application.organizationName,
    `Заявка ${application.number}`,
    'Сумма 1200000 RUB',
    'Срок 12 месяцев',
    'Ставка 21.95%',
    'Платёж 112276 RUB',
    'Проценты за весь срок 147308 RUB',
    'Всего к возврату 1347308 RUB',
  ]) {
    assert.ok(text.split('\n').includes(line), line);
  }
  assert.match(text, /не создаёт юридическую электронную подпись/);
  assert.match(text, /Денежные средства не переводятся/);
  assert.match(text, /Не является юридической офертой/);
});

test('unsupported mechanics are explicit and never presented as free real credit terms', () => {
  const items = buildLoanSummary(offer);
  const security = items.find((item) => item.id === 'security')!;
  const overdue = items.find((item) => item.id === 'overdue')!;
  const early = items.find((item) => item.id === 'early_repayment')!;
  assert.match(security.detail, /ограничение прототипа/);
  assert.match(overdue.detail, /не рассчитываются/);
  assert.match(overdue.detail, /не означает, что их нет в реальном договоре/);
  assert.match(early.detail, /не моделируются/);
  assert.match(early.detail, /исходному графику/);
  assert.doesNotMatch(
    items.map((item) => item.value).join(' '),
    /бесплатно|без штрафов|без комиссий/i,
  );
});

test('zero interest remains an explicit saved amount without inferred charges', () => {
  const zeroInterest = { ...offer, rateBps: 0, totalInterest: 0, totalRepayment: offer.amount };
  const items = buildLoanSummary(zeroInterest);
  assert.match(items[1].detail, /0% годовых/);
  assert.equal(plain(items[2].value), '1200000₽');
  assert.match(items[2].detail, /Из них 0\s₽ — проценты/);
  assert.match(
    createLoanContract({ organizationName: 'ИП Лесной', number: 'Z-1' }, zeroInterest),
    /Проценты за весь срок 0 RUB/,
  );
});
