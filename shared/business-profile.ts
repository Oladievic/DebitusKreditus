import type { BusinessProfile, DocumentGuidance, Organization } from './types.js';

export const legalFormLabels: Record<BusinessProfile['legalForm'], string> = {
  ip: 'ИП',
  ooo: 'ООО',
  ao: 'АО',
  other: 'Другое юридическое лицо',
};
export const taxSystemLabels: Record<BusinessProfile['taxSystem'], string> = {
  osno: 'ОСНО',
  usn: 'УСН',
  patent: 'Патент',
  eshn: 'ЕСХН',
  npd: 'НПД',
};
export function businessProfile(org: Organization): BusinessProfile {
  if (org.profile) return org.profile;
  const coffee = org.id === 'org_terra';
  return {
    legalForm: coffee ? 'ip' : 'ooo',
    taxSystem: coffee ? 'usn' : 'osno',
    financingGoal: org.industry.includes('мебели')
      ? 'equipment'
      : coffee
        ? 'working_capital'
        : 'credit_line',
    requestedAmount: coffee ? 1000000 : 2000000,
    preferredTermMonths: coffee ? 24 : 36,
    lowSeasonRevenueDropPct: coffee ? 15 : 10,
    largestCustomerSharePct: coffee ? 5 : 25,
    cashReserve: coffee ? 300000 : 1200000,
    receivablesDays: coffee ? 0 : 30,
    financialsAsOf: '2026-10-01',
    version: 1,
    updatedAt: '2026-10-20T09:00:00.000Z',
  };
}
export function documentGuidance(
  profile: BusinessProfile,
  productId: string = profile.financingGoal,
): DocumentGuidance[] {
  const personal = profile.legalForm === 'ip';
  const financialTitle = personal
    ? profile.taxSystem === 'patent'
      ? 'Книга учёта доходов и патент'
      : profile.taxSystem === 'npd'
        ? 'Справка о доходах НПД'
        : 'Налоговая декларация или книга учёта'
    : 'Баланс и отчёт о финансовых результатах';
  return [
    {
      category: 'statement',
      title: 'Выписка по счёту',
      explanation: 'Поступления и списания за последние 6 месяцев для проверки денежного потока.',
      required: true,
    },
    {
      category: 'financials',
      title: financialTitle,
      explanation: personal
        ? 'Для ИП принимаем налоговые или управленческие сведения. Баланс юридического лица не требуется.'
        : 'Допустима управленческая отчётность с выручкой, расходами и обязательствами за тот же период.',
      required: true,
    },
    ...(productId === 'equipment'
      ? [
          {
            category: 'invoice',
            title: 'Счёт или предложение поставщика',
            explanation: 'Подтверждает стоимость оборудования и цель финансирования.',
            required: true,
          },
        ]
      : []),
    ...(profile.legalForm === 'ao'
      ? [
          {
            category: 'other',
            title: 'Структура акционеров и полномочия подписанта',
            explanation:
              'В этом прототипе — справочная рекомендация; персональные документы не требуются.',
            required: false,
          },
        ]
      : []),
  ];
}
