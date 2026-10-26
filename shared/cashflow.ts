import type { PaymentRow } from './types.js';

export interface CashflowInputs {
  startingMonth: string;
  horizonMonths: 6 | 12;
  openingBalance: number;
  monthlyInflow: number;
  monthlyOperatingOutflow: number;
  monthlyExistingDebtPayment: number;
  investmentCost: number;
  monthlyAdditionalNetCash: number;
  benefitStartMonth: number;
  seasonalRevenuePct: number[];
  assumptionsConfirmed: boolean;
}
export interface CashflowLoan {
  amount: number;
  termMonths: number;
  rateBps: number;
  schedule: PaymentRow[];
}
export interface CashflowTrackRow {
  openingBalance: number;
  netCash: number;
  endingBalance: number;
}
export interface CashflowRow {
  month: string;
  revenueMultiplierPct: number;
  inflow: number;
  operatingOutflow: number;
  existingDebtPayment: number;
  additionalNetCash: number;
  loanProceeds: number;
  investmentOutflow: number;
  loanPayment: number;
  noLoan: CashflowTrackRow;
  withLoan: CashflowTrackRow;
}
export interface CashflowTrackSummary {
  minimumBalance: number;
  firstNegativeMonth: string | null;
  endingBalance: number;
}
export interface CashflowResult {
  inputs: CashflowInputs;
  loan: Omit<CashflowLoan, 'schedule'> & {
    totalRepayment: number;
    debtAfterHorizon: number;
    paymentsAfterHorizon: number;
  };
  rows: CashflowRow[];
  noLoan: CashflowTrackSummary;
  withLoan: CashflowTrackSummary;
  generatedAt: string;
  methodVersion: string;
  assumptions: string[];
  source?: { organizationId: string; profileVersion: number; financialsAsOf: string };
}
export class CashflowInputError extends Error {}

const MONEY_LIMIT = 1_000_000_000;
function integer(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new CashflowInputError(`${label}: укажите целое число от ${min} до ${max}.`);
  return value;
}
export function cashflowMonth(startingMonth: string, offset: number): string {
  const year = Number(startingMonth.slice(0, 4));
  const month = Number(startingMonth.slice(5, 7)) - 1 + offset;
  return `${year + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}`;
}
export function validateCashflowInputs(value: unknown): CashflowInputs {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CashflowInputError('Передайте параметры денежного потока.');
  const v = value as Record<string, unknown>;
  if (typeof v.startingMonth !== 'string' || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(v.startingMonth))
    throw new CashflowInputError('Первый месяц: укажите существующий месяц с 2000 по 2099 год.');
  if (v.horizonMonths !== 6 && v.horizonMonths !== 12)
    throw new CashflowInputError('Выберите горизонт 6 или 12 месяцев.');
  if (v.assumptionsConfirmed !== true)
    throw new CashflowInputError(
      'Подтвердите, что проверили денежные поступления, выплаты и допущения.',
    );
  if (!Array.isArray(v.seasonalRevenuePct) || v.seasonalRevenuePct.length !== 12)
    throw new CashflowInputError('Укажите сезонность для всех 12 календарных месяцев.');
  return {
    startingMonth: v.startingMonth,
    horizonMonths: v.horizonMonths,
    openingBalance: integer(v.openingBalance, 0, MONEY_LIMIT, 'Остаток на начало'),
    monthlyInflow: integer(v.monthlyInflow, 0, MONEY_LIMIT, 'Поступления в обычный месяц'),
    monthlyOperatingOutflow: integer(
      v.monthlyOperatingOutflow,
      0,
      MONEY_LIMIT,
      'Операционные выплаты',
    ),
    monthlyExistingDebtPayment: integer(
      v.monthlyExistingDebtPayment,
      0,
      MONEY_LIMIT,
      'Действующие кредитные платежи',
    ),
    investmentCost: integer(v.investmentCost, 0, MONEY_LIMIT, 'Разовая покупка'),
    monthlyAdditionalNetCash: integer(
      v.monthlyAdditionalNetCash,
      -MONEY_LIMIT,
      MONEY_LIMIT,
      'Изменение потока от покупки',
    ),
    benefitStartMonth: integer(v.benefitStartMonth, 1, 60, 'Первый месяц изменения потока'),
    seasonalRevenuePct: Array.from(v.seasonalRevenuePct, (x) =>
      integer(x, 0, 300, 'Сезонные поступления, %'),
    ),
    assumptionsConfirmed: true,
  };
}
function safe(value: bigint) {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new CashflowInputError('Сумма денежного потока превышает точность расчёта.');
  return n;
}
function validateSchedule(inputs: CashflowInputs, loan: CashflowLoan) {
  if (!loan || typeof loan !== 'object')
    throw new CashflowInputError('Передайте проверенный график кредита.');
  integer(loan.amount, 1, 30_000_000, 'Сумма кредита');
  integer(loan.termMonths, 1, 60, 'Срок кредита');
  integer(loan.rateBps, 0, 10_000, 'Ставка');
  if (!Array.isArray(loan.schedule) || loan.schedule.length !== loan.termMonths)
    throw new CashflowInputError('График кредита неполный. Пересчитайте параметры.');
  let balance = loan.amount;
  for (const [index, row] of loan.schedule.entries()) {
    if (
      !row ||
      row.month !== index + 1 ||
      row.dueDate !== `${cashflowMonth(inputs.startingMonth, index + 1)}-01`
    )
      throw new CashflowInputError(
        'Даты графика кредита не соответствуют первому месяцу сценария.',
      );
    integer(row.payment, 0, MONEY_LIMIT, 'Платёж по графику');
    integer(row.principal, 0, balance, 'Основной долг по графику');
    integer(row.interest, 0, MONEY_LIMIT, 'Проценты по графику');
    integer(row.balance, 0, loan.amount, 'Остаток долга по графику');
    balance -= row.principal;
    if (row.principal + row.interest !== row.payment || row.balance !== balance)
      throw new CashflowInputError('График кредита содержит противоречивые суммы.');
  }
  if (balance !== 0) throw new CashflowInputError('График кредита не закрывает основной долг.');
}
export function calculateCashflow(
  value: unknown,
  loan: CashflowLoan,
  generatedAt: string,
): CashflowResult {
  const inputs = validateCashflowInputs(value);
  validateSchedule(inputs, loan);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt)))
    throw new CashflowInputError('Некорректная дата расчёта.');
  let noLoanBalance = inputs.openingBalance;
  let withLoanBalance = inputs.openingBalance;
  const rows: CashflowRow[] = Array.from({ length: inputs.horizonMonths }, (_, i) => {
    const month = cashflowMonth(inputs.startingMonth, i);
    const revenueMultiplierPct = inputs.seasonalRevenuePct[Number(month.slice(5)) - 1];
    const inflow = safe((BigInt(inputs.monthlyInflow) * BigInt(revenueMultiplierPct) + 50n) / 100n);
    const loanPayment = i === 0 ? 0 : (loan.schedule[i - 1]?.payment ?? 0);
    const loanProceeds = i === 0 ? loan.amount : 0;
    const investmentOutflow = i === 0 ? inputs.investmentCost : 0;
    const additionalNetCash =
      i + 1 >= inputs.benefitStartMonth ? inputs.monthlyAdditionalNetCash : 0;
    const operating =
      BigInt(inflow) -
      BigInt(inputs.monthlyOperatingOutflow) -
      BigInt(inputs.monthlyExistingDebtPayment);
    const noLoan: CashflowTrackRow = {
      openingBalance: noLoanBalance,
      netCash: safe(operating),
      endingBalance: safe(BigInt(noLoanBalance) + operating),
    };
    const withNet =
      operating +
      BigInt(loanProceeds) -
      BigInt(investmentOutflow) +
      BigInt(additionalNetCash) -
      BigInt(loanPayment);
    const withLoan: CashflowTrackRow = {
      openingBalance: withLoanBalance,
      netCash: safe(withNet),
      endingBalance: safe(BigInt(withLoanBalance) + withNet),
    };
    noLoanBalance = noLoan.endingBalance;
    withLoanBalance = withLoan.endingBalance;
    return {
      month,
      revenueMultiplierPct,
      inflow,
      operatingOutflow: inputs.monthlyOperatingOutflow,
      existingDebtPayment: inputs.monthlyExistingDebtPayment,
      additionalNetCash,
      loanProceeds,
      investmentOutflow,
      loanPayment,
      noLoan,
      withLoan,
    };
  });
  const summarize = (track: 'noLoan' | 'withLoan'): CashflowTrackSummary => ({
    minimumBalance: Math.min(inputs.openingBalance, ...rows.map((r) => r[track].endingBalance)),
    firstNegativeMonth: rows.find((r) => r[track].endingBalance < 0)?.month ?? null,
    endingBalance: rows.at(-1)![track].endingBalance,
  });
  const coveredPayments = Math.min(inputs.horizonMonths - 1, loan.schedule.length);
  return {
    inputs,
    loan: {
      amount: loan.amount,
      termMonths: loan.termMonths,
      rateBps: loan.rateBps,
      totalRepayment: safe(loan.schedule.reduce((sum, row) => sum + BigInt(row.payment), 0n)),
      debtAfterHorizon: coveredPayments ? loan.schedule[coveredPayments - 1].balance : loan.amount,
      paymentsAfterHorizon: safe(
        loan.schedule.slice(coveredPayments).reduce((sum, row) => sum + BigInt(row.payment), 0n),
      ),
    },
    rows,
    noLoan: summarize('noLoan'),
    withLoan: summarize('withLoan'),
    generatedAt,
    methodVersion: 'cashflow-rub-explicit-v1',
    assumptions: [
      'Это сценарий по заданным допущениям, а не обещание дохода или решение об одобрении.',
      'Начальный остаток — деньги на счёте. Поступления и выплаты — денежный поток, а не бухгалтерская прибыль.',
      'Вся сумма кредита поступает в первый месяц. Разовая покупка и её эффект есть только в сценарии с кредитом. Без кредита покупка не совершается.',
      'Первый платёж по кредиту — 1-го числа следующего месяца. Действующие кредитные платежи и операционные выплаты считаются постоянными.',
      'Сезонность меняет только обычные поступления. Эффект покупки задан отдельно как дополнительный чистый поток, уже после её текущих расходов.',
      'Остатки показаны на конец месяца. Внутримесячные разрывы, налоги и разовые выплаты сверх введённых расходов отдельно не моделируются.',
      'Отрицательный остаток означает нехватку денег в сценарии; овердрафт автоматически не добавляется. Долг после горизонта остаётся обязательством.',
    ],
  };
}
