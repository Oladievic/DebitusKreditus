import type { Offer } from './types';

export interface LoanSummaryItem {
  id: 'amount' | 'payment' | 'cost' | 'security' | 'overdue' | 'early_repayment';
  title: string;
  value: string;
  detail: string;
}

const rubles = (value: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);

const annualRate = (rateBps: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(rateBps / 100) + '%';

export function buildLoanSummary(offer: Offer): LoanSummaryItem[] {
  return [
    {
      id: 'amount',
      title: 'Сколько вы получаете',
      value: rubles(offer.amount),
      detail: 'Сумма из сохранённого предложения, с которым вы соглашаетесь.',
    },
    {
      id: 'payment',
      title: 'Сколько платить в месяц',
      value: rubles(offer.monthlyPayment),
      detail: `${offer.termMonths} мес.; ${annualRate(offer.rateBps)} годовых. Последний платёж может отличаться из-за округления.`,
    },
    {
      id: 'cost',
      title: 'Сколько вернёте за весь срок',
      value: rubles(offer.totalRepayment),
      detail: `Из них ${rubles(offer.totalInterest)} — проценты. Комиссии и страховка в этой модели не рассчитываются и не включены в итог.`,
    },
    {
      id: 'security',
      title: 'Залог и поручительство',
      value: 'Не оформляются в модели',
      detail:
        'Модуль обеспечения не реализован. Это ограничение прототипа, а не обещание кредита без залога у реального кредитора.',
    },
    {
      id: 'overdue',
      title: 'Что будет при просрочке',
      value: 'Начисления не моделируются',
      detail:
        'Штрафы, пени и последствия просрочки не рассчитываются. Это не означает, что их нет в реальном договоре.',
    },
    {
      id: 'early_repayment',
      title: 'Можно ли погасить раньше',
      value: 'Перерасчёт после выдачи',
      detail:
        'В сопровождении доступна имитация досрочного погашения на границе отмеченного периода: уменьшить срок или платёж. Дневные проценты и комиссии не моделируются. Показанный здесь итог относится к исходному графику.',
    },
  ];
}
