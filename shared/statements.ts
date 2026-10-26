import type { Financials } from './types.js';

export const STATEMENT_METHOD_VERSION = 'statement-rules-1.0';
export const STATEMENT_HEADER = 'date;direction;amount;counterparty_id;counterparty;kind;reference';
export interface StatementPeriod {
  from: string;
  to: string;
}
export type StatementKind = 'revenue' | 'expense' | 'transfer' | 'loan' | 'refund' | 'debt';
export interface StatementTransaction {
  row: number;
  date: string;
  direction: 'in' | 'out';
  amount: number;
  counterpartyId: string;
  counterparty: string;
  kind: StatementKind;
  reference: string;
}
export interface StatementFinding {
  code: string;
  severity: 'info' | 'attention';
  title: string;
  detail: string;
  rows?: number[];
}
export interface StatementAnalysis {
  methodVersion: string;
  period: StatementPeriod;
  rowCount: number;
  uniqueRows: number;
  duplicates: { row: number; originalRow: number }[];
  months: {
    month: string;
    fullMonth: boolean;
    revenue: number;
    expenses: number;
    debtPayment: number;
    inflow: number;
    outflow: number;
  }[];
  fullMonthCount: number;
  averageMonthlyRevenue: number | null;
  averageMonthlyExpenses: number | null;
  averageMonthlyDebtPayment: number | null;
  trendBps: number | null;
  largestRevenueCounterparty: { id: string; name: string; amount: number; shareBps: number } | null;
  regularity: {
    activeRevenueDays: number;
    totalDays: number;
    activeRevenueWeeks: number;
    totalWeeks: number;
  };
  excludedTotals: Record<
    'transfer' | 'loan' | 'refund' | 'debt',
    { inflow: number; outflow: number }
  >;
  totals: {
    inflow: number;
    outflow: number;
    revenue: number;
    expenses: number;
    debtPayment: number;
  };
  declaredFinancials: Financials;
  findings: StatementFinding[];
}
export interface StatementReport {
  id: string;
  applicationId: string;
  organizationId: string;
  documentId: string;
  documentName: string;
  sourceSha256: string;
  sourceSize: number;
  createdAt: string;
  createdBy: string;
  applicationVersion: number;
  profileVersion: number | null;
  analysis: StatementAnalysis;
}
export class StatementValidationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StatementValidationError';
  }
}
const fail = (code: string, message: string): never => {
  throw new StatementValidationError(code, message);
};
const DAY = 86400000;
function dateValue(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return fail('STATEMENT_DATE', 'Укажите календарную дату в формате ГГГГ-ММ-ДД.');
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value)
    return fail('STATEMENT_DATE', `Несуществующая календарная дата: ${value}.`);
  return timestamp;
}
function normalized(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}
function csvRecords(source: string): string[][] {
  if (
    typeof source !== 'string' ||
    !source.length ||
    new TextEncoder().encode(source).length > 1024 * 1024
  )
    return fail('STATEMENT_SIZE', 'CSV должен содержать от 1 байта до 1 МБ.');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(source))
    return fail('STATEMENT_CSV', 'CSV содержит недопустимые управляющие символы.');
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    state: 'plain' | 'quoted' | 'closed' = 'plain';
  const finishRow = () => {
    row.push(cell);
    rows.push(row);
    if (rows.length > 5001) fail('STATEMENT_ROWS', 'Допускается не больше 5000 операций.');
    row = [];
    cell = '';
    state = 'plain';
  };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (state === 'quoted') {
      if (character === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else state = 'closed';
      } else cell += character;
      continue;
    }
    if (character === ';') {
      row.push(cell);
      cell = '';
      state = 'plain';
    } else if (character === '\n') finishRow();
    else if (character === '"' && state === 'plain' && !cell) state = 'quoted';
    else if (state === 'closed' || character === '"' || character === '\r')
      fail('STATEMENT_CSV', `Некорректные кавычки или перенос строки в записи ${rows.length + 1}.`);
    else cell += character;
  }
  if (state === 'quoted') fail('STATEMENT_CSV', 'В CSV не закрыты кавычки.');
  if (cell.length || row.length || state === 'closed') finishRow();
  if (
    !rows.length ||
    rows[0].map((value) => value.trim()).join(';') !== STATEMENT_HEADER ||
    rows[0].length !== 7
  )
    fail('STATEMENT_HEADER', `Нужны ровно семь столбцов: ${STATEMENT_HEADER}.`);
  if (rows.length < 2) fail('STATEMENT_ROWS', 'Добавьте хотя бы одну операцию.');
  return rows.slice(1);
}
export function parseStatementCsv(source: string, period: StatementPeriod): StatementTransaction[] {
  if (!period || typeof period !== 'object' || Array.isArray(period))
    return fail('STATEMENT_PERIOD', 'Укажите полный период выписки: начало и конец.');
  const from = dateValue(period.from),
    to = dateValue(period.to);
  if (to < from || (to - from) / DAY >= 731)
    return fail('STATEMENT_PERIOD', 'Период должен идти по порядку и занимать не больше 731 дня.');
  return csvRecords(source).map((values, index) => {
    const row = index + 2;
    if (values.length !== 7)
      return fail('STATEMENT_CSV', `В записи ${row} должно быть семь полей.`);
    const [date, direction, amount, counterpartyId, counterparty, kind, reference] =
      values.map(normalized);
    const timestamp = dateValue(date);
    if (timestamp < from || timestamp > to)
      return fail('STATEMENT_PERIOD', `Операция в записи ${row} находится вне выбранного периода.`);
    if (direction !== 'in' && direction !== 'out')
      return fail('STATEMENT_DIRECTION', `Запись ${row}: направление должно быть in или out.`);
    if (!/^[1-9]\d{0,9}$/.test(amount) || Number(amount) > 1_000_000_000)
      return fail(
        'STATEMENT_AMOUNT',
        `Запись ${row}: сумма — целое число рублей от 1 до 1 000 000 000.`,
      );
    if (
      !counterpartyId ||
      counterpartyId.length > 80 ||
      !counterparty ||
      counterparty.length > 200 ||
      !reference ||
      reference.length > 200
    )
      return fail(
        'STATEMENT_COUNTERPARTY',
        `Запись ${row}: нужны идентификатор контрагента до 80 символов, имя и номер операции до 200 символов.`,
      );
    if ([counterpartyId, counterparty, reference].some((value) => /^[=+\-@]/.test(value)))
      return fail(
        'STATEMENT_FORMULA',
        `Запись ${row}: имя, идентификатор и номер операции должны быть текстом без начальных =, +, - или @. Замените формулу её текстовым значением в исходном CSV.`,
      );
    if (!['revenue', 'expense', 'transfer', 'loan', 'refund', 'debt'].includes(kind))
      return fail('STATEMENT_KIND', `Запись ${row}: неизвестный вид операции.`);
    if (
      (['revenue', 'loan'].includes(kind) && direction !== 'in') ||
      (['expense', 'debt'].includes(kind) && direction !== 'out')
    )
      return fail(
        'STATEMENT_KIND_DIRECTION',
        `Запись ${row}: revenue и loan требуют in, expense и debt требуют out.`,
      );
    return {
      row,
      date,
      direction,
      amount: Number(amount),
      counterpartyId,
      counterparty,
      kind: kind as StatementKind,
      reference,
    };
  });
}
function weekKey(timestamp: number): string {
  const weekday = new Date(timestamp).getUTCDay();
  return new Date(timestamp - ((weekday + 6) % 7) * DAY).toISOString().slice(0, 10);
}
export function analyzeStatement(
  csv: string,
  period: StatementPeriod,
  declared: Financials,
): StatementAnalysis {
  const transactions = parseStatementCsv(csv, period);
  if (
    !declared ||
    ['monthlyRevenue', 'monthlyExpenses', 'monthlyDebtPayment'].some((key) => {
      const value = declared[key as keyof Financials];
      return !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000;
    })
  )
    fail('STATEMENT_FINANCIALS', 'Для сравнения нужны корректные финансовые сведения заявки.');
  const seen = new Map<string, number>(),
    duplicates: StatementAnalysis['duplicates'] = [],
    unique: StatementTransaction[] = [];
  for (const transaction of transactions) {
    const { row, ...identity } = transaction;
    const key = JSON.stringify(identity),
      originalRow = seen.get(key);
    if (originalRow !== undefined) duplicates.push({ row, originalRow });
    else {
      seen.set(key, row);
      unique.push(transaction);
    }
  }
  const months: StatementAnalysis['months'] = [];
  let cursor = new Date(`${period.from.slice(0, 7)}-01T00:00:00.000Z`);
  while (cursor.getTime() <= dateValue(period.to)) {
    const month = cursor.toISOString().slice(0, 7),
      first = `${month}-01`;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    const last = new Date(cursor.getTime() - DAY).toISOString().slice(0, 10);
    months.push({
      month,
      fullMonth: first >= period.from && last <= period.to,
      revenue: 0,
      expenses: 0,
      debtPayment: 0,
      inflow: 0,
      outflow: 0,
    });
  }
  const totals = { inflow: 0, outflow: 0, revenue: 0, expenses: 0, debtPayment: 0 };
  const excludedTotals: StatementAnalysis['excludedTotals'] = {
    transfer: { inflow: 0, outflow: 0 },
    loan: { inflow: 0, outflow: 0 },
    refund: { inflow: 0, outflow: 0 },
    debt: { inflow: 0, outflow: 0 },
  };
  const parties = new Map<string, { id: string; name: string; amount: number }>();
  const revenueDays = new Set<string>(),
    revenueWeeks = new Set<string>(),
    weeks = new Set<string>();
  for (let timestamp = dateValue(period.from); timestamp <= dateValue(period.to); timestamp += DAY)
    weeks.add(weekKey(timestamp));
  for (const transaction of unique) {
    const month = months.find((item) => item.month === transaction.date.slice(0, 7))!;
    const flow = transaction.direction === 'in' ? 'inflow' : 'outflow';
    totals[flow] += transaction.amount;
    month[flow] += transaction.amount;
    if (transaction.kind === 'revenue') {
      totals.revenue += transaction.amount;
      month.revenue += transaction.amount;
      const party = parties.get(transaction.counterpartyId) ?? {
        id: transaction.counterpartyId,
        name: transaction.counterparty,
        amount: 0,
      };
      party.amount += transaction.amount;
      parties.set(party.id, party);
      revenueDays.add(transaction.date);
      revenueWeeks.add(weekKey(dateValue(transaction.date)));
    } else if (transaction.kind === 'expense') {
      totals.expenses += transaction.amount;
      month.expenses += transaction.amount;
    } else {
      excludedTotals[transaction.kind][flow] += transaction.amount;
      if (transaction.kind === 'debt') {
        totals.debtPayment += transaction.amount;
        month.debtPayment += transaction.amount;
      }
    }
  }
  const full = months.filter((month) => month.fullMonth);
  const average = (key: 'revenue' | 'expenses' | 'debtPayment') =>
    full.length ? Math.round(full.reduce((sum, month) => sum + month[key], 0) / full.length) : null;
  const last = full.at(-1),
    prior = full.at(-2);
  const trendBps =
    prior && prior.revenue > 0 && last
      ? Math.round(((last.revenue - prior.revenue) / prior.revenue) * 10000)
      : null;
  const largest = [...parties.values()].sort(
    (a, b) => b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )[0];
  const largestRevenueCounterparty = largest
    ? { ...largest, shareBps: Math.round((largest.amount / totals.revenue) * 10000) }
    : null;
  const findings: StatementFinding[] = [];
  if (duplicates.length)
    findings.push({
      code: 'EXACT_DUPLICATES',
      severity: 'attention',
      title: 'Повторные операции исключены',
      detail: `${duplicates.length} точных повторов после нормализации пробелов. Совпали дата, направление, сумма, контрагент, вид и номер операции. Сохранена первая запись; это проверка файла, а не вывод о нарушении.`,
      rows: duplicates.map((item) => item.row),
    });
  if (months.some((month) => !month.fullMonth))
    findings.push({
      code: 'PARTIAL_PERIOD',
      severity: 'info',
      title: 'Есть неполные месяцы',
      detail:
        'Средние значения и сравнение с анкетой используют только полностью выбранные календарные месяцы. Полнота периода задана пользователем и не подтверждена банком.',
    });
  for (const [metric, declaredKey, label] of [
    ['revenue', 'monthlyRevenue', 'Выручка'],
    ['expenses', 'monthlyExpenses', 'Расходы'],
    ['debtPayment', 'monthlyDebtPayment', 'Кредитные платежи'],
  ] as const) {
    const actual = full.reduce((sum, month) => sum + month[metric], 0),
      expected = declared[declaredKey] * full.length;
    if (full.length && Math.abs(actual - expected) * 10 > expected)
      findings.push({
        code: `DECLARED_${metric.toUpperCase()}_MISMATCH`,
        severity: 'attention',
        title: `${label}: расхождение с анкетой`,
        detail: `${label} за ${full.length} полных мес.: ${actual} ₽; по анкете за тот же срок: ${expected} ₽. Разница превышает 10% от анкеты${expected === 0 ? ' (в анкете ноль)' : ''}. Проверьте период и классификацию; финансовые сведения не заменены.`,
      });
  }
  const jumps = full.flatMap((month, index) => {
    const previous = full[index - 1];
    return previous && month.revenue > 0 && month.revenue * 2 >= previous.revenue * 3
      ? [
          `${previous.month}: ${previous.revenue} ₽ → ${month.month}: ${month.revenue} ₽${previous.revenue === 0 ? ' (поступления после нулевого месяца)' : ''}`,
        ]
      : [];
  });
  if (jumps.length)
    findings.push({
      code: 'REVENUE_JUMP',
      severity: 'attention',
      title: 'Поступления заметно выросли',
      detail: `${jumps.join('; ')}. Проверены соседние полные месяцы: рост не меньше 50% или поступления после нуля. Это может быть сезонность или крупный контракт; причина требует пояснения.`,
    });
  if (largestRevenueCounterparty && largestRevenueCounterparty.amount * 2 >= totals.revenue)
    findings.push({
      code: 'COUNTERPARTY_CONCENTRATION',
      severity: 'attention',
      title: 'Зависимость от одного покупателя',
      detail: `${largestRevenueCounterparty.name}: ${largestRevenueCounterparty.amount} ₽, ${(largestRevenueCounterparty.shareBps / 100).toFixed(2)}% выручки выбранного периода. Правило срабатывает от 50%; это концентрация поступлений, а не признак нарушения.`,
    });
  return {
    methodVersion: STATEMENT_METHOD_VERSION,
    period: { from: period.from, to: period.to },
    rowCount: transactions.length,
    uniqueRows: unique.length,
    duplicates,
    months,
    fullMonthCount: full.length,
    averageMonthlyRevenue: average('revenue'),
    averageMonthlyExpenses: average('expenses'),
    averageMonthlyDebtPayment: average('debtPayment'),
    trendBps,
    largestRevenueCounterparty,
    regularity: {
      activeRevenueDays: revenueDays.size,
      totalDays: (dateValue(period.to) - dateValue(period.from)) / DAY + 1,
      activeRevenueWeeks: revenueWeeks.size,
      totalWeeks: weeks.size,
    },
    excludedTotals,
    totals,
    declaredFinancials: { ...declared },
    findings,
  };
}
export function statementCsvTemplate(): string {
  return `${STATEMENT_HEADER}\n2026-08-05;in;1200000;buyer-a;Покупатель А;revenue;A-001\n2026-08-12;in;1200000;buyer-b;Покупатель Б;revenue;B-001\n2026-08-20;out;1650000;supplier;Поставщик;expense;S-001\n2026-08-25;out;120000;lender;Кредитор;debt;D-001\n2026-09-05;in;1300000;buyer-a;Покупатель А;revenue;A-002\n2026-09-12;in;1100000;buyer-b;Покупатель Б;revenue;B-002\n2026-09-20;out;1650000;supplier;Поставщик;expense;S-002\n2026-09-25;out;120000;lender;Кредитор;debt;D-002\n`;
}
