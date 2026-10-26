const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const strings = { type: 'array', items: { type: 'string' } };
export const PROFILE_SCHEMAS = {
  BusinessProfile: {
    type: 'object',
    required: [
      'legalForm',
      'taxSystem',
      'financingGoal',
      'requestedAmount',
      'preferredTermMonths',
      'lowSeasonRevenueDropPct',
      'largestCustomerSharePct',
      'cashReserve',
      'receivablesDays',
      'financialsAsOf',
      'version',
      'updatedAt',
    ],
    properties: {
      legalForm: { type: 'string', enum: ['ip', 'ooo', 'ao', 'other'] },
      taxSystem: {
        type: 'string',
        enum: ['osno', 'usn', 'patent', 'eshn', 'npd'],
        description:
          'patent/npd доступны в этом профиле только для ip; полная налоговая проверка не выполняется.',
      },
      financingGoal: { type: 'string', enum: ['working_capital', 'equipment', 'credit_line'] },
      requestedAmount: { type: 'integer', minimum: 100000, maximum: 30000000 },
      preferredTermMonths: { type: 'integer', minimum: 6, maximum: 60 },
      lowSeasonRevenueDropPct: { type: 'integer', minimum: 0, maximum: 80 },
      largestCustomerSharePct: { type: 'integer', minimum: 0, maximum: 100 },
      cashReserve: { type: 'integer', minimum: 0, maximum: 1000000000 },
      receivablesDays: { type: 'integer', minimum: 0, maximum: 365 },
      financialsAsOf: {
        type: 'string',
        format: 'date',
        description:
          'Существующая дата от 2000-01-01 до текущего дня UTC; показатели старше 120 дней требуют обновления.',
      },
      version: { type: 'integer', minimum: 1, readOnly: true },
      updatedAt: { type: 'string', format: 'date-time', readOnly: true },
    },
  },
  DocumentGuidance: {
    type: 'object',
    required: ['category', 'title', 'explanation', 'required'],
    properties: {
      category: { type: 'string' },
      title: { type: 'string' },
      explanation: { type: 'string' },
      required: { type: 'boolean' },
    },
  },
  BusinessProfileResponse: {
    type: 'object',
    required: ['organization', 'profile', 'documentGuidance'],
    properties: {
      organization: {
        type: 'object',
        description:
          'Своя организация с финансовыми данными и profile; организация определяется сервером.',
      },
      profile: ref('BusinessProfile'),
      documentGuidance: { type: 'array', items: ref('DocumentGuidance') },
    },
  },
  RecommendationsResponse: {
    type: 'object',
    required: [
      'generatedAt',
      'methodVersion',
      'profileVersion',
      'financialsAsOf',
      'staleFinancials',
      'market',
      'inputs',
      'recommendations',
    ],
    properties: {
      generatedAt: { type: 'string', format: 'date-time' },
      methodVersion: { type: 'string' },
      profileVersion: { type: 'integer' },
      financialsAsOf: { type: 'string', format: 'date' },
      staleFinancials: { type: 'boolean' },
      market: {
        type: 'object',
        properties: {
          reviewedAt: { type: 'string', format: 'date' },
          keyRateBps: { type: 'integer' },
          keyRateAsOf: { type: 'string', format: 'date' },
          smeShortTermRateBps: { type: 'integer' },
          smeLongTermRateBps: { type: 'integer' },
          smePeriod: { type: 'string' },
          note: { type: 'string' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                url: { type: 'string', format: 'uri' },
                publishedAt: { type: 'string', format: 'date' },
                checkedAt: { type: 'string', format: 'date' },
              },
            },
          },
        },
      },
      inputs: {
        type: 'object',
        properties: {
          financials: ref('Financials'),
          profile: ref('BusinessProfile'),
          monthsActive: { type: 'integer' },
          overdueDays: { type: 'integer' },
          registered: { type: 'boolean' },
        },
      },
      recommendations: { type: 'array', items: ref('CreditRecommendation') },
    },
  },
  CreditRecommendation: {
    type: 'object',
    properties: {
      product: ref('Product'),
      rank: { type: 'integer' },
      fitScore: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Индекс соответствия, не вероятность одобрения.',
      },
      eligible: { type: 'boolean' },
      reasons: strings,
      cautions: strings,
      blockers: strings,
      proposedAmount: { type: 'integer' },
      proposedTermMonths: { type: 'integer' },
      calculation: { anyOf: [ref('ScenarioResult'), { type: 'null' }] },
      stressRemainingCash: { type: ['integer', 'null'] },
      reserveCoverageMonths: {
        type: ['number', 'null'],
        description:
          'Резерв/дефицит стресс-сценария с округлением вниз до 0,1 месяца. null означает отсутствие дефицита или расчёта.',
      },
      score: { anyOf: [ref('Score'), { type: 'null' }] },
      documentGuidance: { type: 'array', items: ref('DocumentGuidance') },
    },
  },
};
