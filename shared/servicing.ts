import type { Application, Offer, PaymentRow } from './types';

export const SERVICING_METHOD = 'servicing-1.0';
export type PrepaymentMode = 'reduce_payment' | 'reduce_term';
export interface ServicingEvent {
  id: string;
  kind: 'payment' | 'prepayment';
  recordedAt: string;
  effectiveDate: string;
  amount: number;
  principal: number;
  interest: number;
  balance: number;
  mode?: PrepaymentMode;
  actor: string;
}
export interface LoanServicingState {
  applicationId: string;
  version: number;
  methodVersion: string;
  simulated: true;
  status: 'active' | 'closed';
  offer: Offer;
  fundedAt: string;
  balance: number;
  paymentsRecorded: number;
  paidPrincipal: number;
  paidInterest: number;
  totalRecorded: number;
  remainingInterest: number;
  remainingPayments: number;
  nextPayment: PaymentRow | null;
  schedule: PaymentRow[];
  history: ServicingEvent[];
  prepaymentAvailable: boolean;
  boundaryDate: string | null;
  assumptions: string[];
}
export interface PrepaymentPreview {
  version: number;
  amount: number;
  mode: PrepaymentMode;
  effectiveDate: string;
  previousBalance: number;
  balance: number;
  previousPayment: number;
  nextPayment: number;
  previousTermMonths: number;
  remainingTermMonths: number;
  interestSaved: number;
  remainingInterest: number;
  schedule: PaymentRow[];
  methodVersion: string;
}
export class ServicingError extends Error {}
const round = (n: bigint, d: bigint) => (n + d / 2n) / d;
function integer(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new ServicingError(`Укажите целое число от ${min} до ${max}.`);
}
export function servicingDate(anchor: string, month: number): string {
  const date = new Date(`${anchor.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== anchor.slice(0, 10))
    throw new ServicingError('Дата выдачи отсутствует или повреждена.');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + month);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}
export function servicingPayment(amount: number, months: number, rateBps: number): number {
  integer(amount, 1, 30_000_000);
  integer(months, 1, 60);
  integer(rateBps, 0, 10_000);
  if (!rateBps) return Math.max(1, Number(round(BigInt(amount), BigInt(months))));
  const d = 120_000n,
    r = BigInt(rateBps),
    n = BigInt(months);
  const a = (d + r) ** n,
    b = d ** n;
  return Math.max(1, Number(round(BigInt(amount) * r * a, d * (a - b))));
}
function scheduleFor(
  balance: number,
  rateBps: number,
  payment: number,
  dates: PaymentRow[],
): PaymentRow[] {
  const result: PaymentRow[] = [];
  for (const [index, date] of dates.entries()) {
    if (balance === 0) break;
    const interest = Number(round(BigInt(balance) * BigInt(rateBps), 120_000n));
    const principal =
      index === dates.length - 1 ? balance : Math.min(balance, Math.max(0, payment - interest));
    balance -= principal;
    result.push({
      month: date.month,
      dueDate: date.dueDate,
      payment: principal + interest,
      principal,
      interest,
      balance,
    });
  }
  return result;
}
export function summarizeServicing(state: LoanServicingState): LoanServicingState {
  const paidPrincipal = state.history.reduce((n, event) => n + event.principal, 0);
  const paidInterest = state.history.reduce((n, event) => n + event.interest, 0);
  const paymentsRecorded = state.history.filter((event) => event.kind === 'payment').length;
  const boundary = [...state.history].reverse().find((event) => event.kind === 'payment');
  const alreadyPrepaid =
    boundary &&
    state.history.some(
      (event) => event.kind === 'prepayment' && event.effectiveDate === boundary.effectiveDate,
    );
  return {
    ...state,
    balance: state.offer.amount - paidPrincipal,
    paidPrincipal,
    paidInterest,
    paymentsRecorded,
    totalRecorded: paidPrincipal + paidInterest,
    remainingInterest: state.schedule.reduce((n, row) => n + row.interest, 0),
    remainingPayments: state.schedule.reduce((n, row) => n + row.payment, 0),
    status: state.schedule.length ? 'active' : 'closed',
    nextPayment: state.schedule[0] ?? null,
    boundaryDate: boundary?.effectiveDate ?? null,
    prepaymentAvailable: Boolean(boundary && !alreadyPrepaid && state.schedule.length),
  };
}
export function initialServicing(application: Application): LoanServicingState {
  const offer = application.decision?.offer;
  if (application.status !== 'funded' || !offer || !application.fundedAt)
    throw new ServicingError('Сопровождение доступно после смоделированной выдачи кредита.');
  const payment = servicingPayment(offer.amount, offer.termMonths, offer.rateBps);
  const dates = Array.from({ length: offer.termMonths }, (_, index) => ({
    month: index + 1,
    dueDate: servicingDate(application.fundedAt!, index + 1),
    payment: 0,
    principal: 0,
    interest: 0,
    balance: 0,
  }));
  const schedule = scheduleFor(offer.amount, offer.rateBps, payment, dates);
  const total = schedule.reduce((n, row) => n + row.payment, 0);
  if (
    payment !== offer.monthlyPayment ||
    total !== offer.totalRepayment ||
    total - offer.amount !== offer.totalInterest
  )
    throw new ServicingError(
      'Сохранённые условия не совпадают с графиком. Нужна проверка кредитного дела.',
    );
  return summarizeServicing({
    applicationId: application.id,
    version: 0,
    methodVersion: SERVICING_METHOD,
    simulated: true,
    status: 'active',
    offer: { ...offer },
    fundedAt: application.fundedAt,
    balance: offer.amount,
    paymentsRecorded: 0,
    paidPrincipal: 0,
    paidInterest: 0,
    totalRecorded: 0,
    remainingInterest: offer.totalInterest,
    remainingPayments: total,
    nextPayment: schedule[0],
    schedule,
    history: [],
    prepaymentAvailable: false,
    boundaryDate: null,
    assumptions: [
      'Все отметки платежей и досрочного погашения — имитация, деньги не переводятся.',
      'Ставка и сумма закреплены в принятом предложении. Даты календаря определяются по UTC; первый платёж — через месяц после выдачи, короткий месяц ограничен его последним днём.',
      'Суммы в целых рублях, округление половины вверх. Проценты за период: остаток × годовая ставка / 12.',
      'Можно репетировать будущие платежи; дата периода и время записи показываются отдельно.',
      'Досрочное погашение — только на границе последнего отмеченного периода, один раз между платежами. Дневные проценты, просрочка, комиссии и штрафы не рассчитываются.',
      'При уменьшении платежа выбирается сумма в целых рублях без увеличения оставшихся процентов из-за округления. Для очень малого взноса регулярный платёж может не измениться; уменьшится последний.',
    ],
  });
}
export function recordScheduledPayment(
  state: LoanServicingState,
  metadata: Pick<ServicingEvent, 'id' | 'recordedAt' | 'actor'>,
): LoanServicingState {
  const row = state.nextPayment;
  if (!row) throw new ServicingError('Кредит уже погашен в модели.');
  return summarizeServicing({
    ...state,
    version: state.version + 1,
    schedule: state.schedule.slice(1),
    history: [
      ...state.history,
      {
        ...metadata,
        kind: 'payment',
        effectiveDate: row.dueDate,
        amount: row.payment,
        principal: row.principal,
        interest: row.interest,
        balance: row.balance,
      },
    ],
  });
}
export function previewPrepayment(
  state: LoanServicingState,
  amount: number,
  mode: PrepaymentMode,
): PrepaymentPreview {
  if (!state.prepaymentAvailable || !state.boundaryDate)
    throw new ServicingError(
      'Сначала отметьте следующий платёж. Досрочное погашение доступно один раз на границе отмеченного периода.',
    );
  integer(amount, 1, state.balance);
  if (!['reduce_payment', 'reduce_term'].includes(mode))
    throw new ServicingError('Выберите уменьшение платежа или срока.');
  const balance = state.balance - amount;
  let payment =
    balance === 0
      ? 0
      : mode === 'reduce_payment'
        ? servicingPayment(balance, state.schedule.length, state.offer.rateBps)
        : state.nextPayment!.payment;
  let schedule = balance ? scheduleFor(balance, state.offer.rateBps, payment, state.schedule) : [];
  if (
    mode === 'reduce_payment' &&
    schedule.reduce((n, row) => n + row.interest, 0) > state.remainingInterest
  ) {
    let low = payment,
      high = state.nextPayment!.payment;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = scheduleFor(balance, state.offer.rateBps, middle, state.schedule);
      if (candidate.reduce((n, row) => n + row.interest, 0) > state.remainingInterest)
        low = middle + 1;
      else high = middle;
    }
    payment = low;
    schedule = scheduleFor(balance, state.offer.rateBps, payment, state.schedule);
  }
  const remainingInterest = schedule.reduce((n, row) => n + row.interest, 0);
  return {
    version: state.version,
    amount,
    mode,
    effectiveDate: state.boundaryDate,
    previousBalance: state.balance,
    balance,
    previousPayment: state.nextPayment!.payment,
    nextPayment: schedule[0]?.payment ?? 0,
    previousTermMonths: state.schedule.length,
    remainingTermMonths: schedule.length,
    interestSaved: state.remainingInterest - remainingInterest,
    remainingInterest,
    schedule,
    methodVersion: SERVICING_METHOD,
  };
}
export function recordPrepayment(
  state: LoanServicingState,
  preview: PrepaymentPreview,
  metadata: Pick<ServicingEvent, 'id' | 'recordedAt' | 'actor'>,
): LoanServicingState {
  const canonical = previewPrepayment(state, preview.amount, preview.mode);
  return summarizeServicing({
    ...state,
    version: state.version + 1,
    schedule: canonical.schedule,
    history: [
      ...state.history,
      {
        ...metadata,
        kind: 'prepayment',
        effectiveDate: canonical.effectiveDate,
        amount: canonical.amount,
        principal: canonical.amount,
        interest: 0,
        balance: canonical.balance,
        mode: canonical.mode,
      },
    ],
  });
}
export function servicingCsv(state: LoanServicingState): string {
  const rows = [
    [
      'Тип',
      'Дата периода',
      'Время записи UTC',
      'Сумма RUB',
      'Основной долг RUB',
      'Проценты RUB',
      'Остаток RUB',
      'Вариант',
      'Моделирование',
    ],
    ...state.history.map((event) => [
      event.kind === 'payment' ? 'Платёж' : 'Досрочное погашение',
      event.effectiveDate,
      event.recordedAt,
      String(event.amount),
      String(event.principal),
      String(event.interest),
      String(event.balance),
      event.mode ?? '',
      'Да',
    ]),
    ...state.schedule.map((row) => [
      'Будущий платёж',
      row.dueDate,
      '',
      String(row.payment),
      String(row.principal),
      String(row.interest),
      String(row.balance),
      '',
      'Да',
    ]),
  ];
  return (
    '\uFEFF' +
    rows
      .map((row) => row.map((value) => '"' + value.replaceAll('"', '""') + '"').join(';'))
      .join('\r\n') +
    '\r\n'
  );
}
