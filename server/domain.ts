/*! Created by Oladievic */
import type {
  ApplicationInput,
  Application,
  Assessment,
  BudgetScenarioResult,
  CreditDecision,
  Financials,
  Organization,
  Product,
  ScenarioResult,
  Score,
  DocumentRecord,
} from '../shared/types.js';
import { businessProfile, documentGuidance } from '../shared/business-profile.js';

export const PRODUCTS: Product[] = [
  {
    id: 'working_capital',
    name: 'Оборотный капитал',
    subtitle: 'Закупки, запасы, новый контракт',
    description: 'Равные платежи для текущих задач бизнеса. Без залога в модели прототипа.',
    minAmount: 100000,
    maxAmount: 10000000,
    minTerm: 6,
    maxTerm: 36,
    rateBps: 2450,
    purposes: ['Закупка товара', 'Исполнение контракта', 'Пополнение оборотных средств'],
    requiredDocuments: ['statement', 'financials'],
    color: 'mint',
  },
  {
    id: 'equipment',
    name: 'Развитие и оборудование',
    subtitle: 'Инвестиция, которая работает',
    description:
      'Финансирование оборудования и расширения. Более длинный срок снижает ежемесячную нагрузку.',
    minAmount: 500000,
    maxAmount: 30000000,
    minTerm: 12,
    maxTerm: 60,
    rateBps: 2190,
    purposes: ['Покупка оборудования', 'Расширение производства', 'Открытие новой точки'],
    requiredDocuments: ['statement', 'financials', 'invoice'],
    color: 'violet',
  },
  {
    id: 'credit_line',
    name: 'Резерв для бизнеса',
    subtitle: 'Запас ликвидности на сезон',
    description:
      'Упрощённая модель кредитной линии: в демонстрации вся сумма выдаётся одним траншем с равными платежами.',
    minAmount: 100000,
    maxAmount: 5000000,
    minTerm: 6,
    maxTerm: 24,
    rateBps: 2690,
    purposes: ['Сезонные закупки', 'Кассовый разрыв', 'Резерв ликвидности'],
    requiredDocuments: ['statement', 'financials'],
    color: 'amber',
  },
];
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const now = () => new Date().toISOString();
export const uid = (prefix = 'id') =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
export const productById = (id: string) => {
  const p = PRODUCTS.find((p) => p.id === id);
  if (!p) throw new DomainError('PRODUCT_NOT_FOUND', 'Кредитный продукт не найден.', 404);
  return p;
};
export function validateInput(value: unknown): ApplicationInput {
  const x = value as Record<string, unknown>;
  if (!x || typeof x !== 'object' || Array.isArray(x))
    throw new DomainError('INVALID_INPUT', 'Передайте данные заявки.');
  const product = productById(String(x.productId ?? ''));
  const integer = (v: unknown, min: number, max: number, label: string) => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
      throw new DomainError('INVALID_INPUT', `${label}: укажите целое число от ${min} до ${max}.`);
    return v;
  };
  const f = x.financials as Record<string, unknown>;
  if (!f || typeof f !== 'object')
    throw new DomainError('INVALID_INPUT', 'Заполните финансовые показатели.');
  if (typeof x.purpose !== 'string' || x.purpose.trim().length < 3 || x.purpose.length > 500)
    throw new DomainError('INVALID_INPUT', 'Опишите цель финансирования: от 3 до 500 символов.');
  if (typeof x.consent !== 'boolean')
    throw new DomainError('INVALID_INPUT', 'Укажите согласие на демонстрационную проверку данных.');
  return {
    productId: product.id,
    amount: integer(x.amount, product.minAmount, product.maxAmount, 'Сумма'),
    termMonths: integer(x.termMonths, product.minTerm, product.maxTerm, 'Срок'),
    purpose: x.purpose.trim(),
    consent: x.consent,
    financials: {
      monthlyRevenue: integer(f.monthlyRevenue, 0, 1000000000, 'Выручка'),
      monthlyExpenses: integer(f.monthlyExpenses, 0, 1000000000, 'Расходы'),
      monthlyDebtPayment: integer(f.monthlyDebtPayment, 0, 1000000000, 'Действующие платежи'),
    },
  };
}
const rounded = (n: bigint, d: bigint) => (n + d / 2n) / d;
const paymentCapacity = (cash: number) => Number((BigInt(cash) * 65n) / 100n);
export const maximumPayment = (result: ScenarioResult) =>
  Math.max(...result.schedule.map((row) => row.payment));
export function calculateScenario(
  amount: number,
  termMonths: number,
  rateBps: number,
  financials: Financials,
  startDate = now().slice(0, 10),
): ScenarioResult {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !Number.isFinite(Date.parse(`${startDate}T12:00:00Z`)) ||
    new Date(`${startDate}T12:00:00Z`).toISOString().slice(0, 10) !== startDate
  )
    throw new DomainError(
      'INVALID_SCENARIO',
      'Укажите существующую дату начала расчёта в формате ГГГГ-ММ-ДД.',
    );
  if (
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 30000000 ||
    !Number.isInteger(termMonths) ||
    termMonths < 1 ||
    termMonths > 60 ||
    !Number.isInteger(rateBps) ||
    rateBps < 0 ||
    rateBps > 10000
  )
    throw new DomainError('INVALID_SCENARIO', 'Некорректные параметры расчёта.');
  for (const v of Object.values(financials))
    if (!Number.isSafeInteger(v) || v < 0 || v > 1000000000)
      throw new DomainError('INVALID_SCENARIO', 'Некорректные финансовые показатели.');
  const D = 120000n,
    r = BigInt(rateBps),
    a = (D + r) ** BigInt(termMonths),
    b = D ** BigInt(termMonths);
  const payment =
    rateBps === 0
      ? Number(rounded(BigInt(amount), BigInt(termMonths)))
      : Number(rounded(BigInt(amount) * r * a, D * (a - b)));
  let balance = amount;
  const schedule = Array.from({ length: termMonths }, (_, i) => {
    const interest = Number(rounded(BigInt(balance) * r, D));
    const principal =
      i === termMonths - 1 ? balance : Math.min(balance, Math.max(0, payment - interest));
    balance -= principal;
    const date = new Date(`${startDate}T12:00:00Z`);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + i + 1);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
    return {
      month: i + 1,
      dueDate: date.toISOString().slice(0, 10),
      payment: principal + interest,
      principal,
      interest,
      balance,
    };
  });
  const totalRepayment = schedule.reduce((s, p) => s + p.payment, 0);
  const availableCash =
    financials.monthlyRevenue - financials.monthlyExpenses - financials.monthlyDebtPayment;
  const debtLoadBps =
    financials.monthlyRevenue > 0
      ? Number(
          rounded(
            BigInt(payment + financials.monthlyDebtPayment) * 10000n,
            BigInt(financials.monthlyRevenue),
          ),
        )
      : 10000;
  return {
    amount,
    termMonths,
    rateBps,
    monthlyPayment: payment,
    totalRepayment,
    totalInterest: totalRepayment - amount,
    schedule,
    debtLoadBps,
    availableCash,
    affordable:
      availableCash > 0 &&
      Math.max(...schedule.map((row) => row.payment)) <= paymentCapacity(availableCash),
    assumptions: [
      `Дата начала расчёта: ${startDate} (UTC). Первый платёж — через месяц.`,
      'Демонстрационный аннуитет, фиксированная ставка; суммы в целых рублях.',
      'Округление half-up; последний платёж закрывает остаток.',
      'Без комиссий, страховки и переноса выходных. Не является банковской офертой.',
    ],
    methodVersion: 'annuity-rub-bigint-v1',
  };
}
export function calculateBudgetScenario(value: unknown): BudgetScenarioResult {
  const body = value as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new DomainError('INVALID_BUDGET', 'Передайте параметры комфортного платежа.');
  const product = productById(String(body.productId ?? ''));
  const validated = validateInput({
    productId: product.id,
    amount: product.minAmount,
    termMonths: body.termMonths,
    financials: body.financials,
    purpose: 'Расчёт от комфортного платежа',
    consent: false,
  });
  const budgetInteger = (value: unknown, label: string) => {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 1000000000
    )
      throw new DomainError(
        'INVALID_BUDGET',
        `${label}: укажите целое число от 0 до 1 000 000 000 рублей.`,
      );
    return value;
  };
  const input = {
    productId: product.id,
    termMonths: validated.termMonths,
    financials: validated.financials,
    comfortablePayment: budgetInteger(body.comfortablePayment, 'Комфортный платёж'),
    monthlyReserve: budgetInteger(body.monthlyReserve, 'Запас в месяц'),
  };
  const availableCash =
    input.financials.monthlyRevenue -
    input.financials.monthlyExpenses -
    input.financials.monthlyDebtPayment;
  const policyPaymentLimit = paymentCapacity(Math.max(0, availableCash));
  const reservePaymentLimit = Math.max(0, availableCash - input.monthlyReserve);
  const effectivePaymentLimit = Math.min(
    input.comfortablePayment,
    policyPaymentLimit,
    reservePaymentLimit,
  );
  const scenario = (amount: number) =>
    calculateScenario(amount, input.termMonths, product.rateBps, input.financials);
  const largestPayment = (result: ScenarioResult) =>
    Math.max(...result.schedule.map((row) => row.payment));
  const minimumProductPayment = largestPayment(scenario(product.minAmount));
  const amountStep = 1000;
  let low = 0,
    high = product.maxAmount;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (scenario(middle).monthlyPayment <= effectivePaymentLimit) low = middle;
    else high = middle - 1;
  }
  let candidate = Math.floor(low / amountStep) * amountStep;
  let suggestion: ScenarioResult | null = null;
  while (candidate >= product.minAmount) {
    const result = scenario(candidate);
    if (largestPayment(result) <= effectivePaymentLimit) {
      suggestion = result;
      break;
    }
    candidate -= amountStep;
  }
  const maximumScheduledPayment = suggestion ? largestPayment(suggestion) : 0;
  const bindingLimits: BudgetScenarioResult['bindingLimits'] = [];
  if (effectivePaymentLimit === input.comfortablePayment) bindingLimits.push('comfortable_payment');
  if (effectivePaymentLimit === reservePaymentLimit) bindingLimits.push('monthly_reserve');
  if (effectivePaymentLimit === policyPaymentLimit) bindingLimits.push('policy');
  if (suggestion?.amount === product.maxAmount) bindingLimits.push('product_maximum');
  return {
    input,
    availableCash,
    policyPaymentLimit,
    reservePaymentLimit,
    effectivePaymentLimit,
    minimumProductPayment,
    maximumScheduledPayment,
    minimumRemainingCash: availableCash - maximumScheduledPayment,
    bindingLimits,
    suggestion,
    amountStep,
    assumptions: [
      'Сумма подбирается с шагом 1 000 ₽ в пределах выбранного продукта; ставка и срок фиксированы.',
      'Свободный поток = выручка − расходы − действующие платежи. Запас — остаток этого потока после нового платежа, а не сумма на счёте.',
      'Предел нового платежа — минимум вашего бюджета, потока за вычетом запаса и 65% потока по учебной модели.',
      'Каждый платёж, включая последний с поправкой на округление, проверяется по пределу. Деньги считаются в целых рублях.',
      'Без комиссий, страховки и изменения ставки. Проверки документов, регистрации и кредитной истории не выполняются. Это не решение банка.',
    ],
    methodVersion: 'budget-annuity-rub-bigint-v1',
  };
}
export function assess(
  input: ApplicationInput,
  org: Organization,
  documents: Pick<DocumentRecord, 'category'>[],
  actor = 'rule-engine',
  at = now(),
): Assessment {
  if ('organizationSnapshot' in input && input.organizationSnapshot)
    org = input.organizationSnapshot as Organization;
  const profile = businessProfile(org);
  const product = productById(input.productId),
    result = calculateScenario(
      input.amount,
      input.termMonths,
      product.rateBps,
      input.financials,
      at.slice(0, 10),
    );
  const peakPayment = maximumPayment(result);
  const stressRevenue = Math.floor(
    (input.financials.monthlyRevenue * (100 - profile.lowSeasonRevenueDropPct)) / 100,
  );
  const stressRemainingCash =
    stressRevenue -
    input.financials.monthlyExpenses -
    input.financials.monthlyDebtPayment -
    peakPayment;
  const margin = input.financials.monthlyRevenue
    ? (input.financials.monthlyRevenue - input.financials.monthlyExpenses) /
      input.financials.monthlyRevenue
    : 0;
  const factors = [
    {
      code: 'history',
      label: 'Платёжная дисциплина',
      points: org.overdueDays >= 60 ? -45 : org.overdueDays > 0 ? -20 : 20,
      detail: org.overdueDays
        ? `Просрочка ${org.overdueDays} дней в синтетической БКИ`
        : 'Просрочек в синтетической БКИ нет',
    },
    {
      code: 'tenure',
      label: 'Возраст бизнеса',
      points: org.monthsActive >= 24 ? 15 : org.monthsActive >= 12 ? 5 : -15,
      detail: `${org.monthsActive} месяцев деятельности`,
    },
    {
      code: 'margin',
      label: 'Операционная маржа',
      points: margin >= 0.25 ? 15 : margin >= 0.1 ? 5 : -15,
      detail: `${Math.round(margin * 100)}% до платежей по кредитам`,
    },
    {
      code: 'debt',
      label: 'Долговая нагрузка',
      points: result.debtLoadBps <= 1500 ? 10 : result.debtLoadBps <= 3000 ? 0 : -20,
      detail: `${(result.debtLoadBps / 100).toFixed(1)}% выручки после нового кредита`,
    },
    {
      code: 'cashflow',
      label: 'Покрытие нового платежа',
      points:
        result.availableCash <= 0
          ? -25
          : peakPayment > result.availableCash
            ? -15
            : peakPayment > paymentCapacity(result.availableCash)
              ? -10
              : 10,
      detail: `Свободный поток ${result.availableCash.toLocaleString('ru-RU')} ₽; максимальный платёж ${peakPayment.toLocaleString('ru-RU')} ₽`,
    },
    {
      code: 'concentration',
      label: 'Концентрация выручки',
      points:
        profile.largestCustomerSharePct > 70 ? -10 : profile.largestCustomerSharePct > 50 ? -5 : 0,
      detail: `Крупнейший покупатель: ${profile.largestCustomerSharePct}% выручки; сведения владельца`,
    },
  ];
  const value = Math.max(0, Math.min(100, 40 + factors.reduce((s, f) => s + f.points, 0)));
  const paymentLimit = Math.floor(
    (Math.max(0, result.availableCash) * (value >= 70 ? 65 : 50)) / 100,
  );
  const score: Score = {
    value,
    band: value >= 70 ? 'low' : value >= 45 ? 'medium' : 'high',
    factors,
    modelVersion: 'transparent-score-v2',
    evaluatedAt: at,
    profileVersion: profile.version,
    paymentLimit,
    stressRemainingCash,
  };
  const missing = product.requiredDocuments.filter(
    (category) => !documents.some((d) => d.category === category),
  );
  const staleFinancials =
    Math.floor((Date.parse(at.slice(0, 10)) - Date.parse(profile.financialsAsOf)) / 86400000) > 120;
  const checks: Assessment['checks'] = [
    {
      source: 'ФНС · локальный симулятор',
      simulated: true,
      status: org.registered ? 'passed' : 'failed',
      label: 'Регистрация бизнеса',
      details: org.registered
        ? `${org.name}: синтетическая запись активна`
        : 'В синтетическом реестре регистрация не подтверждена',
      checkedAt: at,
    },
    {
      source: 'БКИ · локальный симулятор',
      simulated: true,
      status: org.overdueDays >= 60 ? 'failed' : org.overdueDays ? 'warning' : 'passed',
      label: 'Кредитная история',
      details: `Просрочка: ${org.overdueDays} дней. Обращений во внешние сервисы нет.`,
      checkedAt: at,
    },
    {
      source: 'Проверка комплекта',
      simulated: true,
      status: missing.length || staleFinancials ? 'warning' : 'passed',
      label: 'Достаточность данных',
      details: missing.length
        ? `Не хватает: ${documentGuidance(profile, product.id)
            .filter((d) => missing.includes(d.category))
            .map((d) => d.title)
            .join(', ')}`
        : staleFinancials
          ? `Показатели от ${profile.financialsAsOf} старше 120 дней: обновите профиль и финансовый документ.`
          : 'Все категории документов представлены; подлинность в прототипе не проверяется',
      checkedAt: at,
    },
  ];
  let decision: CreditDecision = {
    outcome: 'approved',
    reasons: [
      `Платёж укладывается в ${value >= 70 ? 65 : 50}% свободного потока; скоринг ${value}/100.`,
    ],
    requestedDocuments: [],
    offer: result,
    ruleVersion: 'credit-policy-v2',
    decidedBy: actor,
    decidedAt: at,
  };
  if (
    !org.registered ||
    org.overdueDays >= 60 ||
    org.monthsActive < 6 ||
    result.availableCash <= 0 ||
    value < 40
  )
    decision = {
      ...decision,
      outcome: 'declined',
      offer: null,
      reasons: [
        !org.registered
          ? 'Регистрация бизнеса не подтверждена в симуляторе.'
          : org.overdueDays >= 60
            ? 'Просрочка 60 дней и более: ограничение демонстрационной кредитной политики.'
            : org.monthsActive < 6
              ? 'Бизнес работает менее шести месяцев.'
              : result.availableCash <= 0
                ? 'Свободного денежного потока недостаточно для обслуживания кредита.'
                : 'Скоринг ниже 40: проверьте маржу, долговую нагрузку и концентрацию выручки.',
      ],
    };
  else if (missing.length || staleFinancials || input.financials.monthlyRevenue === 0)
    decision = {
      ...decision,
      outcome: 'needs_info',
      offer: null,
      reasons: [
        staleFinancials
          ? `Финансовые показатели от ${profile.financialsAsOf} старше 120 дней. Обновите профиль и приложите свежий финансовый документ.`
          : 'Для решения нужен полный комплект данных.',
      ],
      requestedDocuments: [...new Set([...missing, ...(staleFinancials ? ['financials'] : [])])],
    };
  else if (peakPayment > paymentLimit) {
    const limitPayment = paymentLimit;
    let lo = 0,
      hi = input.amount;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (
        maximumPayment(
          calculateScenario(
            mid,
            input.termMonths,
            product.rateBps,
            input.financials,
            at.slice(0, 10),
          ),
        ) <= limitPayment
      )
        lo = mid;
      else hi = mid - 1;
    }
    const safeAmount = Math.floor(lo / 1000) * 1000;
    decision =
      safeAmount >= product.minAmount
        ? {
            ...decision,
            outcome: 'counter_offer',
            reasons: [
              'Запрошенная сумма создаёт повышенную нагрузку. Предлагаем меньшую сумму при том же сроке.',
            ],
            offer: calculateScenario(
              safeAmount,
              input.termMonths,
              product.rateBps,
              input.financials,
              at.slice(0, 10),
            ),
          }
        : {
            ...decision,
            outcome: 'declined',
            reasons: ['Доступный денежный поток не покрывает минимальную сумму продукта.'],
            offer: null,
          };
  }
  if (decision.offer) {
    const { amount, termMonths, rateBps, monthlyPayment, totalRepayment, totalInterest } =
      decision.offer;
    decision.offer = { amount, termMonths, rateBps, monthlyPayment, totalRepayment, totalInterest };
  }
  return { score, decision, checks };
}
export function newApplication(
  input: ApplicationInput,
  org: Organization,
  id = uid('app'),
  at = now(),
): Application {
  return {
    ...input,
    id,
    number: `DK-${id.slice(-6).toUpperCase()}`,
    organizationId: org.id,
    organizationName: org.name,
    status: 'draft',
    version: 1,
    score: null,
    decision: null,
    checks: [],
    createdAt: at,
    updatedAt: at,
    submittedAt: null,
    signedAt: null,
    fundedAt: null,
  };
}
