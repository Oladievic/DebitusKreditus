import { buildLoanSummary } from '../shared/loan-summary';
import type { Application, Offer } from '../shared/types';

export function createLoanContract(
  application: Pick<Application, 'organizationName' | 'number'>,
  offer: Offer,
): string {
  const conditions = buildLoanSummary(offer)
    .map((item) => `${item.title}\n${item.value}\n${item.detail}`)
    .join('\n\n');
  return [
    'ДЕМОНСТРАЦИОННЫЙ КРЕДИТНЫЙ ДОГОВОР',
    application.organizationName,
    `Заявка ${application.number}`,
    `Сумма ${offer.amount} RUB`,
    `Срок ${offer.termMonths} месяцев`,
    `Ставка ${offer.rateBps / 100}%`,
    `Платёж ${offer.monthlyPayment} RUB`,
    `Проценты за весь срок ${offer.totalInterest} RUB`,
    `Всего к возврату ${offer.totalRepayment} RUB`,
    '',
    'ГЛАВНОЕ В УСЛОВИЯХ',
    conditions,
    '',
    'Условия взяты из сохранённого предложения. График и суммы здесь не пересчитываются.',
    'Не является юридической офертой. Подписание и выдача — симуляция.',
    'Подтверждение кнопкой не создаёт юридическую электронную подпись и реальные финансовые обязательства.',
    'Денежные средства не переводятся, документы в реальные банковские системы не направляются.',
    '',
  ].join('\n');
}
