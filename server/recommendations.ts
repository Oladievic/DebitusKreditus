import type {
  CreditRecommendation,
  Financials,
  Organization,
  Product,
  RecommendationsResponse,
} from '../shared/types.js';
import { businessProfile, documentGuidance } from '../shared/business-profile.js';
import { assess, calculateScenario, maximumPayment, now, PRODUCTS } from './domain.js';

export const MARKET_CONTEXT: RecommendationsResponse['market'] = {
  reviewedAt: '2026-10-20',
  keyRateBps: 1400,
  keyRateAsOf: '2026-10-20',
  smeShortTermRateBps: 1640,
  smeLongTermRateBps: 1420,
  smePeriod: '2026-08',
  sources: [
    {
      title: 'Банк России · ключевая ставка',
      url: 'https://www.cbr.ru/hd_base/KeyRate/',
      publishedAt: '2026-10-20',
    },
    {
      title: 'Банк России · ставки по кредитам МСП за август',
      url: 'https://www.cbr.ru/statistics/bank_sector/int_rat/0826/',
      publishedAt: '2026-10-08',
    },
    {
      title: 'Альфа-Банк · кредитование юридических лиц',
      url: 'https://alfabank.ru/sme/profits/kredit-dlya-ooo/',
      checkedAt: '2026-10-20',
    },
    {
      title: 'ФНС · налог на профессиональный доход',
      url: 'https://npd.nalog.ru/',
      checkedAt: '2026-10-20',
    },
  ],
  note: 'Рыночный срез сохранён локально, автоматически не обновляется. Средние ставки ЦБ не являются доступной каждому ценой кредита. Ставки каталога 21,9–26,9% — фиксированное допущение модели, без комиссий, страхования, залога и льготных программ.',
};

export function financialsAgeDays(date: string, at: string): number {
  return Math.floor((Date.parse(at.slice(0, 10)) - Date.parse(date)) / 86400000);
}

export function recommendProducts(
  org: Organization,
  products: Product[] = PRODUCTS,
  at = now(),
): RecommendationsResponse {
  const profile = businessProfile(org);
  const financials: Financials = {
    monthlyRevenue: org.monthlyRevenue,
    monthlyExpenses: org.monthlyExpenses,
    monthlyDebtPayment: org.monthlyDebtPayment,
  };
  const freeCash =
    financials.monthlyRevenue - financials.monthlyExpenses - financials.monthlyDebtPayment;
  const stressCash =
    Math.floor((financials.monthlyRevenue * (100 - profile.lowSeasonRevenueDropPct)) / 100) -
    financials.monthlyExpenses -
    financials.monthlyDebtPayment;
  const staleFinancials = financialsAgeDays(profile.financialsAsOf, at) > 120;
  const recommendations = products
    .map((product): CreditRecommendation => {
      const term = Math.max(
        product.minTerm,
        Math.min(profile.preferredTermMonths, product.maxTerm),
      );
      const requested = Math.max(
        product.minAmount,
        Math.min(profile.requestedAmount, product.maxAmount),
      );
      const input = {
        productId: product.id,
        amount: requested,
        termMonths: term,
        financials,
        purpose: product.purposes[0],
        consent: false,
      };
      const evaluation = assess(
        input,
        org,
        product.requiredDocuments.map((category) => ({ category })),
        'recommendation-engine',
        at,
      );
      const blockers: string[] = [];
      if (profile.requestedAmount < product.minAmount)
        blockers.push(
          `Минимальная сумма продукта ${product.minAmount.toLocaleString('ru-RU')} ₽ больше вашей потребности. Выберите продукт с меньшим минимумом.`,
        );
      if (product.intake?.paused) blockers.push(`Приём приостановлен: ${product.intake.reason}`);
      if (evaluation.decision.outcome === 'declined') blockers.push(...evaluation.decision.reasons);
      if (staleFinancials)
        blockers.push('Финансовые показатели старше 120 дней. Обновите период и суммы в профиле.');
      const offer = evaluation.decision.offer;
      const proposedAmount = offer?.amount ?? requested;
      const calculation = offer
        ? calculateScenario(proposedAmount, term, product.rateBps, financials, at.slice(0, 10))
        : null;
      const peakPayment = calculation ? maximumPayment(calculation) : null;
      const stressRemainingCash = peakPayment === null ? null : stressCash - peakPayment;
      const reasons = [
        product.id === profile.financingGoal
          ? `Соответствует вашей цели: ${product.subtitle.toLocaleLowerCase('ru')}.`
          : `Альтернатива: ${product.subtitle.toLocaleLowerCase('ru')}.`,
      ];
      const cautions: string[] = [];
      if (peakPayment !== null)
        reasons.push(
          `После максимального платежа остаётся ${(freeCash - peakPayment).toLocaleString('ru-RU')} ₽ в месяц.`,
        );
      if (product.id === 'credit_line' && profile.receivablesDays >= 30)
        reasons.push(
          `Оплата от клиентов приходит через ${profile.receivablesDays} дней: резерв помогает планировать разрыв поступлений.`,
        );
      if (product.id === 'equipment')
        reasons.push(
          'Длинный срок распределяет стоимость оборудования; сравните итоговые проценты.',
        );
      if (proposedAmount !== profile.requestedAmount)
        cautions.push(
          `Вместо ${profile.requestedAmount.toLocaleString('ru-RU')} ₽ рассчитано ${proposedAmount.toLocaleString('ru-RU')} ₽: учитываем границы продукта и денежный поток.`,
        );
      if (term !== profile.preferredTermMonths)
        cautions.push(`Срок скорректирован до ${term} месяцев по условиям продукта.`);
      if (stressRemainingCash !== null && stressRemainingCash < 0)
        cautions.push(
          `При снижении выручки на ${profile.lowSeasonRevenueDropPct}% не хватает ${Math.abs(stressRemainingCash).toLocaleString('ru-RU')} ₽ в месяц. Резерв не считается регулярным доходом.`,
        );
      if (profile.largestCustomerSharePct > 50)
        cautions.push(
          `Один покупатель приносит ${profile.largestCustomerSharePct}% выручки: задержка его оплаты заметно изменит поток.`,
        );
      if (product.id === 'credit_line')
        cautions.push(
          'Расчёт линии упрощён: один полный транш и равные платежи, без повторного использования лимита.',
        );
      if (profile.legalForm === 'other')
        cautions.push(
          'Для иной организационно-правовой формы состав подтверждений уточняется при рассмотрении.',
        );
      if (profile.taxSystem === 'npd')
        cautions.push(
          financials.monthlyRevenue * 12 > 2400000
            ? 'Текущий средний месяц даёт годовой ориентир выше лимита НПД 2,4 млн ₽. Уточните налоговый режим и фактический доход за год: ориентир не равен налоговой базе.'
            : 'Для НПД проверьте фактический доход с начала года и отсутствие работников по трудовым договорам. Модель не проверяет право на этот режим.',
        );
      const fitScore = Math.max(
        0,
        Math.min(
          100,
          40 +
            (product.id === profile.financingGoal ? 35 : 0) +
            (proposedAmount === profile.requestedAmount ? 10 : -10) +
            (term === profile.preferredTermMonths ? 5 : 0) +
            (stressRemainingCash !== null && stressRemainingCash >= 0 ? 10 : -10) +
            (product.id === 'credit_line' && profile.receivablesDays >= 30 ? 5 : 0),
        ),
      );
      return {
        product,
        rank: 0,
        fitScore,
        eligible: blockers.length === 0 && calculation !== null,
        reasons: reasons.slice(0, 3),
        cautions,
        blockers,
        proposedAmount,
        proposedTermMonths: term,
        calculation,
        stressRemainingCash,
        reserveCoverageMonths:
          stressRemainingCash !== null && stressRemainingCash < 0
            ? Math.floor((profile.cashReserve / -stressRemainingCash) * 10) / 10
            : null,
        score: evaluation.score,
        documentGuidance: documentGuidance(profile, product.id),
      };
    })
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        b.fitScore - a.fitScore ||
        (a.calculation?.totalInterest ?? Infinity) - (b.calculation?.totalInterest ?? Infinity) ||
        a.product.id.localeCompare(b.product.id),
    );
  recommendations.forEach((item, index) => {
    item.rank = index + 1;
  });
  return {
    generatedAt: at,
    methodVersion: 'purpose-cashflow-fit-v1',
    profileVersion: profile.version,
    financialsAsOf: profile.financialsAsOf,
    staleFinancials,
    market: MARKET_CONTEXT,
    inputs: {
      financials,
      profile,
      monthsActive: org.monthsActive,
      overdueDays: org.overdueDays,
      registered: org.registered,
    },
    recommendations,
  };
}
