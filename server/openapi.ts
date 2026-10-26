import { PROFILE_SCHEMAS } from './profile-openapi.js';
import { APP_VERSION } from '../shared/release.js';
import { V9_PATHS, V9_SCHEMAS } from './v9-openapi.js';
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ 'application/json': { schema } });
const input = {
  type: 'object',
  required: ['productId', 'amount', 'termMonths', 'purpose', 'financials', 'consent'],
  properties: {
    productId: { type: 'string', enum: ['working_capital', 'equipment', 'credit_line'] },
    amount: {
      type: 'integer',
      minimum: 100000,
      maximum: 30000000,
      description: 'Целые RUB; дополнительно ограничено продуктом.',
    },
    termMonths: { type: 'integer', minimum: 6, maximum: 60 },
    purpose: { type: 'string', minLength: 3, maxLength: 500 },
    financials: ref('Financials'),
    consent: { type: 'boolean' },
  },
};
const object = { type: 'object', additionalProperties: true };
const rub = { type: 'integer', minimum: 0, maximum: 1_000_000_000, description: 'Целые RUB.' };
const signedRub = {
  type: 'integer',
  minimum: -Number.MAX_SAFE_INTEGER,
  maximum: Number.MAX_SAFE_INTEGER,
  description: 'Целые RUB; допускается отрицательный остаток.',
};
const statementRub = {
  type: 'integer',
  minimum: 0,
  maximum: 5_000_000_000_000,
  description: 'Целые RUB; сумма уникальных операций выбранного периода.',
};
const nullableStatementRub = { ...statementRub, type: ['integer', 'null'] };
const identifier = { type: 'string' };
const date = { type: 'string', format: 'date' };
const timestamp = { type: 'string', format: 'date-time' };
const version = { type: 'integer', minimum: 1 };
const stringList = { type: 'array', items: { type: 'string' } };
const productId = { type: 'string', enum: ['working_capital', 'equipment', 'credit_line'] };
const statementImportProperties = {
  version,
  csv: {
    type: 'string',
    minLength: 1,
    description:
      'UTF-8 до 1 МБ, от 1 до 5000 операций; BOM/CRLF и RFC-кавычки поддерживаются. Заголовок строго date;direction;amount;counterparty_id;counterparty;kind;reference. date — реальная ISO-дата внутри period. direction: in|out. amount — целые RUB 1..1000000000. kind: revenue(in), expense(out), transfer(in|out), loan(in), refund(in|out), debt(out). counterparty_id: 1..80, counterparty/reference: 1..200 символов после нормализации; начальные =,+,-,@ запрещены. Исходные принятые байты сохраняются без изменения.',
  },
  sourceName: { type: 'string', minLength: 1, maxLength: 255 },
  period: ref('StatementPeriod'),
  reviewed: {
    const: true,
    description:
      'Подтверждение проверки пользователем периода и классификации; обязательно при сохранении.',
  },
};
const cashflowInputProperties = {
  startingMonth: {
    type: 'string',
    pattern: '^20\\d{2}-(0[1-9]|1[0-2])$',
    description: 'Первый месяц, 2000–2099.',
  },
  horizonMonths: { type: 'integer', enum: [6, 12] },
  openingBalance: rub,
  monthlyInflow: rub,
  monthlyOperatingOutflow: rub,
  monthlyExistingDebtPayment: rub,
  investmentCost: rub,
  monthlyAdditionalNetCash: {
    ...rub,
    minimum: -1_000_000_000,
    description:
      'Дополнительный чистый денежный поток покупки, уже после её текущих расходов; целые RUB.',
  },
  benefitStartMonth: { type: 'integer', minimum: 1, maximum: 60 },
  seasonalRevenuePct: {
    type: 'array',
    minItems: 12,
    maxItems: 12,
    items: { type: 'integer', minimum: 0, maximum: 300 },
    description:
      'Множители поступлений для января–декабря. 100 означает обычный месяц; это допущения пользователя.',
  },
  assumptionsConfirmed: { const: true },
};
const V8_SCHEMAS = {
  StatementPeriod: {
    type: 'object',
    required: ['from', 'to'],
    additionalProperties: false,
    description:
      'Включительные начало и конец, не больше 731 дня. Полнота периода заявлена пользователем, не подтверждена банком. Полный месяц определяется границами периода, включая месяцы без операций.',
    properties: { from: date, to: date },
  },
  StatementImportInput: {
    type: 'object',
    required: ['version', 'csv', 'sourceName', 'period'],
    properties: statementImportProperties,
  },
  StatementSaveInput: {
    type: 'object',
    required: ['version', 'csv', 'sourceName', 'period', 'reviewed'],
    properties: statementImportProperties,
  },
  StatementFinding: {
    type: 'object',
    required: ['code', 'severity', 'title', 'detail'],
    additionalProperties: false,
    description:
      'Объяснимое правило, а не вероятность нарушения, доверие модели или автоматическое кредитное решение.',
    properties: {
      code: {
        type: 'string',
        enum: [
          'EXACT_DUPLICATES',
          'PARTIAL_PERIOD',
          'DECLARED_REVENUE_MISMATCH',
          'DECLARED_EXPENSES_MISMATCH',
          'DECLARED_DEBTPAYMENT_MISMATCH',
          'REVENUE_JUMP',
          'COUNTERPARTY_CONCENTRATION',
        ],
      },
      severity: { type: 'string', enum: ['info', 'attention'] },
      title: identifier,
      detail: identifier,
      rows: {
        type: 'array',
        maxItems: 5000,
        items: { type: 'integer', minimum: 2, maximum: 5001 },
        description: 'Номера логических CSV-записей с учётом заголовка.',
      },
    },
  },
  StatementAnalysis: {
    type: 'object',
    additionalProperties: false,
    required: [
      'methodVersion',
      'period',
      'rowCount',
      'uniqueRows',
      'duplicates',
      'months',
      'fullMonthCount',
      'averageMonthlyRevenue',
      'averageMonthlyExpenses',
      'averageMonthlyDebtPayment',
      'trendBps',
      'largestRevenueCounterparty',
      'regularity',
      'excludedTotals',
      'totals',
      'declaredFinancials',
      'findings',
    ],
    description:
      'Серверный расчёт по уникальным нормализованным операциям. revenue/expense — операционные потоки; transfer/loan/refund/debt исключены из них, debt отдельно считается кредитным платежом. Средние округлены до целого RUB по полным месяцам, без экстраполяции. Расхождение >10% от анкеты, рост соседних полных месяцев >=50% или после нуля, доля покупателя >=50%. Финансовые сведения, скоринг и решение не изменяются.',
    properties: {
      methodVersion: { const: 'statement-rules-1.0' },
      period: ref('StatementPeriod'),
      rowCount: { type: 'integer', minimum: 1, maximum: 5000 },
      uniqueRows: { type: 'integer', minimum: 1, maximum: 5000 },
      duplicates: {
        type: 'array',
        maxItems: 4999,
        items: {
          type: 'object',
          required: ['row', 'originalRow'],
          additionalProperties: false,
          properties: {
            row: { type: 'integer', minimum: 2, maximum: 5001 },
            originalRow: { type: 'integer', minimum: 2, maximum: 5001 },
          },
        },
      },
      months: {
        type: 'array',
        minItems: 1,
        maxItems: 26,
        items: {
          type: 'object',
          required: [
            'month',
            'fullMonth',
            'revenue',
            'expenses',
            'debtPayment',
            'inflow',
            'outflow',
          ],
          additionalProperties: false,
          properties: {
            month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
            fullMonth: { type: 'boolean' },
            revenue: statementRub,
            expenses: statementRub,
            debtPayment: statementRub,
            inflow: statementRub,
            outflow: statementRub,
          },
        },
      },
      fullMonthCount: { type: 'integer', minimum: 0, maximum: 25 },
      averageMonthlyRevenue: nullableStatementRub,
      averageMonthlyExpenses: nullableStatementRub,
      averageMonthlyDebtPayment: nullableStatementRub,
      trendBps: {
        type: ['integer', 'null'],
        description:
          'Последний полный месяц к предыдущему полному, 10000 = 100%. null при нехватке месяцев или нулевой базе.',
      },
      largestRevenueCounterparty: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            required: ['id', 'name', 'amount', 'shareBps'],
            additionalProperties: false,
            properties: {
              id: identifier,
              name: identifier,
              amount: statementRub,
              shareBps: { type: 'integer', minimum: 0, maximum: 10000 },
            },
          },
        ],
      },
      regularity: {
        type: 'object',
        required: ['activeRevenueDays', 'totalDays', 'activeRevenueWeeks', 'totalWeeks'],
        additionalProperties: false,
        description:
          'Активность выручки по уникальным календарным дням и неделям с понедельника; в знаменатель входят все дни/затронутые недели выбранного периода, в том числе неполные недели.',
        properties: {
          activeRevenueDays: { type: 'integer', minimum: 0, maximum: 731 },
          totalDays: { type: 'integer', minimum: 1, maximum: 731 },
          activeRevenueWeeks: { type: 'integer', minimum: 0, maximum: 106 },
          totalWeeks: { type: 'integer', minimum: 1, maximum: 106 },
        },
      },
      excludedTotals: {
        type: 'object',
        required: ['transfer', 'loan', 'refund', 'debt'],
        additionalProperties: false,
        properties: Object.fromEntries(
          ['transfer', 'loan', 'refund', 'debt'].map((kind) => [
            kind,
            {
              type: 'object',
              required: ['inflow', 'outflow'],
              additionalProperties: false,
              properties: { inflow: statementRub, outflow: statementRub },
            },
          ]),
        ),
      },
      totals: {
        type: 'object',
        required: ['inflow', 'outflow', 'revenue', 'expenses', 'debtPayment'],
        additionalProperties: false,
        properties: {
          inflow: statementRub,
          outflow: statementRub,
          revenue: statementRub,
          expenses: statementRub,
          debtPayment: statementRub,
        },
      },
      declaredFinancials: {
        ...ref('Financials'),
        description: 'Финансовые сведения заявки, с которыми сравнивали выписку в момент анализа.',
      },
      findings: { type: 'array', items: ref('StatementFinding') },
    },
  },
  StatementReport: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'applicationId',
      'organizationId',
      'documentId',
      'documentName',
      'sourceSha256',
      'sourceSize',
      'createdAt',
      'createdBy',
      'applicationVersion',
      'profileVersion',
      'analysis',
    ],
    description:
      'Неизменяемый сохранённый снимок анализа на момент импорта. GET не пересчитывает его по новому профилю. Документ содержит исходный CSV; hash вычислен сервером. Обычные SQL UPDATE/DELETE/REPLACE блокируются; контроль владельца файла БД не моделируется.',
    properties: {
      id: identifier,
      applicationId: identifier,
      organizationId: identifier,
      documentId: identifier,
      documentName: identifier,
      sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      sourceSize: { type: 'integer', minimum: 1, maximum: 1048576 },
      createdAt: timestamp,
      createdBy: identifier,
      applicationVersion: version,
      profileVersion: { type: ['integer', 'null'], minimum: 1 },
      analysis: ref('StatementAnalysis'),
    },
  },
  StatementReportResponse: {
    type: 'object',
    required: ['report'],
    additionalProperties: false,
    properties: { report: { anyOf: [ref('StatementReport'), { type: 'null' }] } },
  },
  FinancingIntent: {
    type: 'object',
    required: [
      'request',
      'amount',
      'termMonths',
      'productId',
      'evidence',
      'questions',
      'methodVersion',
    ],
    additionalProperties: false,
    description:
      'Детерминированный разбор текста без inference. Неоднозначные суммы, диапазоны, иностранная валюта и несколько целей требуют явного выбора; отсутствующие параметры остаются null.',
    properties: {
      request: { type: 'string', minLength: 3, maxLength: 500 },
      amount: { type: ['integer', 'null'], minimum: 1, maximum: 30000000 },
      termMonths: { type: ['integer', 'null'], minimum: 1, maximum: 60 },
      productId: { type: ['string', 'null'], enum: [...productId.enum, null] },
      evidence: {
        type: 'object',
        required: ['amount', 'term', 'goal'],
        additionalProperties: false,
        properties: {
          amount: { type: ['string', 'null'] },
          term: { type: ['string', 'null'] },
          goal: stringList,
        },
      },
      questions: stringList,
      methodVersion: { const: 'financing-intent-rules-1.0' },
    },
  },
  NavigatorAnalysis: {
    type: 'object',
    required: [
      'intent',
      'suggestedTermMonths',
      'profileVersion',
      'financialsAsOf',
      'generatedAt',
      'recommendation',
    ],
    additionalProperties: false,
    properties: {
      intent: ref('FinancingIntent'),
      suggestedTermMonths: { type: 'integer', minimum: 1, maximum: 60 },
      profileVersion: version,
      financialsAsOf: date,
      generatedAt: timestamp,
      recommendation: { anyOf: [ref('CreditRecommendation'), { type: 'null' }] },
    },
  },
  NavigatorPrepareInput: {
    type: 'object',
    required: ['expectedProfileVersion', 'productId', 'amount', 'termMonths', 'purpose'],
    description:
      'Подтверждённые пользователем параметры. Financials берутся только из своей организации на сервере; consent принудительно false. Проверяются границы и пауза продукта.',
    properties: {
      expectedProfileVersion: version,
      productId,
      amount: input.properties.amount,
      termMonths: input.properties.termMonths,
      purpose: input.properties.purpose,
    },
  },
  NavigatorDraft: {
    type: 'object',
    required: ['draft', 'product', 'calculation', 'profileVersion', 'financialsAsOf', 'notes'],
    additionalProperties: false,
    description:
      'Подготовленные параметры для формы, без создания и отправки заявки. Создание требует отдельного действия пользователя.',
    properties: {
      draft: {
        allOf: [
          ref('ApplicationInput'),
          { type: 'object', properties: { consent: { const: false } } },
        ],
      },
      product: ref('Product'),
      calculation: ref('ScenarioResult'),
      profileVersion: version,
      financialsAsOf: date,
      notes: stringList,
    },
  },
  CashflowInputs: {
    type: 'object',
    required: Object.keys(cashflowInputProperties),
    additionalProperties: false,
    properties: cashflowInputProperties,
  },
  CashflowRequest: {
    type: 'object',
    required: [...Object.keys(cashflowInputProperties), 'productId', 'amount', 'termMonths'],
    properties: {
      ...cashflowInputProperties,
      productId,
      amount: input.properties.amount,
      termMonths: input.properties.termMonths,
    },
    description:
      'Явный денежный сценарий, не бухгалтерская прибыль. Сервер сам строит кредитный график по каталогу; клиентский график и ставка не используются. Поступления/выплаты пользователь обязан проверить. Расчёт ничего не сохраняет.',
  },
  CashflowTrackRow: {
    type: 'object',
    required: ['openingBalance', 'netCash', 'endingBalance'],
    additionalProperties: false,
    properties: { openingBalance: signedRub, netCash: signedRub, endingBalance: signedRub },
  },
  CashflowTrackSummary: {
    type: 'object',
    required: ['minimumBalance', 'firstNegativeMonth', 'endingBalance'],
    additionalProperties: false,
    properties: {
      minimumBalance: signedRub,
      firstNegativeMonth: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}$' },
      endingBalance: signedRub,
    },
  },
  CashflowResult: {
    type: 'object',
    required: [
      'inputs',
      'loan',
      'rows',
      'noLoan',
      'withLoan',
      'generatedAt',
      'methodVersion',
      'assumptions',
    ],
    additionalProperties: false,
    description:
      'Пересчитанный сценарий по явным допущениям. Без кредита нет покупки и её эффекта; с кредитом сумма и покупка проходят в первом месяце, первый платёж — в следующем. Остатки на конец месяца не обнаруживают внутримесячные разрывы. Отрицательный остаток не покрывается овердрафтом. Не влияет на кредитное решение.',
    properties: {
      inputs: ref('CashflowInputs'),
      loan: {
        type: 'object',
        required: [
          'amount',
          'termMonths',
          'rateBps',
          'totalRepayment',
          'debtAfterHorizon',
          'paymentsAfterHorizon',
        ],
        additionalProperties: false,
        properties: {
          amount: input.properties.amount,
          termMonths: input.properties.termMonths,
          rateBps: { type: 'integer', minimum: 0, maximum: 10000 },
          totalRepayment: { ...signedRub, minimum: 0 },
          debtAfterHorizon: { ...signedRub, minimum: 0 },
          paymentsAfterHorizon: { ...signedRub, minimum: 0 },
        },
      },
      rows: {
        type: 'array',
        minItems: 6,
        maxItems: 12,
        items: {
          type: 'object',
          required: [
            'month',
            'revenueMultiplierPct',
            'inflow',
            'operatingOutflow',
            'existingDebtPayment',
            'additionalNetCash',
            'loanProceeds',
            'investmentOutflow',
            'loanPayment',
            'noLoan',
            'withLoan',
          ],
          additionalProperties: false,
          properties: {
            month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
            revenueMultiplierPct: { type: 'integer', minimum: 0, maximum: 300 },
            inflow: { ...rub, maximum: 3000000000 },
            operatingOutflow: rub,
            existingDebtPayment: rub,
            additionalNetCash: { ...rub, minimum: -1000000000 },
            loanProceeds: { ...rub, maximum: 30000000 },
            investmentOutflow: rub,
            loanPayment: rub,
            noLoan: ref('CashflowTrackRow'),
            withLoan: ref('CashflowTrackRow'),
          },
        },
      },
      noLoan: ref('CashflowTrackSummary'),
      withLoan: ref('CashflowTrackSummary'),
      generatedAt: timestamp,
      methodVersion: { const: 'cashflow-rub-explicit-v1' },
      assumptions: stringList,
      source: {
        type: 'object',
        required: ['organizationId', 'profileVersion', 'financialsAsOf'],
        additionalProperties: false,
        description:
          'Свой профиль, от которого начат сценарий; не доказательство, что все введённые суммы получены из него.',
        properties: { organizationId: identifier, profileVersion: version, financialsAsOf: date },
      },
    },
  },
};
const applicationStatus = {
  type: 'string',
  enum: [
    'draft',
    'submitted',
    'in_review',
    'needs_info',
    'approved',
    'counter_offer',
    'declined',
    'accepted',
    'signed',
    'funded',
  ],
};
const auditVersionProperties = {
  schemaVersion: { type: 'integer', const: 1 },
  applicationVersion: { type: 'integer', minimum: 1 },
  profileVersion: { type: 'integer', minimum: 1 },
  scoringVersion: { type: 'string' },
  policyVersion: { type: 'string' },
};
const auditRecordProperties = {
  id: { type: 'string' },
  organizationId: { type: ['string', 'null'] },
  applicationId: { type: ['string', 'null'] },
  actorId: { type: 'string' },
  actorName: { type: 'string' },
  action: { type: 'string' },
  detail: { type: 'string' },
  createdAt: { type: 'string', format: 'date-time' },
};
const versionBody = {
  type: 'object',
  required: ['version'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    confirmed: { type: 'boolean', description: 'Обязательно true для sign и fund.' },
  },
};
type RouteDescription = {
  method: string;
  path: string;
  summary: string;
  description?: string;
  tag: string;
  body?: object;
  response?: object;
  public?: boolean;
  status?: number;
};
const routes: RouteDescription[] = [
  {
    method: 'get',
    path: '/applications/{id}/statement',
    tag: 'Statements',
    summary: 'Client своей организации / bank после подачи: последний сохранённый анализ выписки',
    description:
      'Cookie или bearer. Проверяются права на заявку на сервере; admin не получает досье. Возвращает сохранённый report либо null, без пересчёта по изменившейся анкете. Исходный CSV доступен как связанный документ по обычным правилам доступа.',
    response: ref('StatementReportResponse'),
  },
  {
    method: 'post',
    path: '/applications/{id}/statement/preview',
    tag: 'Statements',
    summary: 'Client session: проверить CSV и рассчитать показатели без сохранения',
    description:
      'Только владелец организации, draft/needs_info и актуальная версия. Сервер заново анализирует CSV и вычисляет SHA-256; присланные результаты не используются. Предпросмотр не меняет заявку, документы или аудит.',
    body: ref('StatementImportInput'),
    response: {
      type: 'object',
      required: ['analysis', 'sourceSha256'],
      additionalProperties: false,
      properties: {
        analysis: ref('StatementAnalysis'),
        sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
  },
  {
    method: 'post',
    path: '/applications/{id}/statement',
    tag: 'Statements',
    status: 201,
    summary: 'Client session: сохранить проверенную выписку и неизменяемый анализ',
    description:
      'Владелец, draft/needs_info, reviewed=true и текущая version. Анализ, исходный CSV-документ, событие и увеличение версии заявки сохраняются атомарно. Максимум 20 документов на заявку. Финансовые значения, скоринг, решение и статус не заменяются. Повтор со старой версией получает 409; сбой записи откатывает весь пакет.',
    body: ref('StatementSaveInput'),
    response: {
      type: 'object',
      required: ['report'],
      additionalProperties: false,
      properties: { report: ref('StatementReport') },
    },
  },
  {
    method: 'post',
    path: '/navigator/analyze',
    tag: 'Navigator',
    summary: 'Client: разобрать задачу своими словами и предложить проверяемые параметры',
    description:
      'Cookie или bearer; только своя организация. Детерминированные правила без внешней модели, только каталог прототипа и сохранённый профиль. Ничего не создаёт; не является кредитным решением. Неоднозначные параметры остаются null и сопровождаются вопросами.',
    body: {
      type: 'object',
      required: ['request'],
      properties: { request: { type: 'string', minLength: 3, maxLength: 500 } },
    },
    response: ref('NavigatorAnalysis'),
  },
  {
    method: 'post',
    path: '/navigator/prepare',
    tag: 'Navigator',
    summary: 'Client session: проверить выбранные параметры для переноса в форму',
    description:
      'Только своя организация и актуальная expectedProfileVersion; проверяются диапазоны продукта и пауза приёма. Возвращает параметры и расчёт, не записывает заявку и не даёт согласие за пользователя. Финансы берутся с сервера; consent=false.',
    body: ref('NavigatorPrepareInput'),
    response: ref('NavigatorDraft'),
  },
  {
    method: 'post',
    path: '/scenario/cashflow',
    tag: 'Scenario',
    summary: 'Client: сравнить денежный поток с кредитом и без на 6 или 12 месяцев',
    description:
      'Cookie или bearer; своя организация. Все допущения задаются явно и требуют assumptionsConfirmed=true. График и ставку сервер рассчитывает по продукту. Расчёт в целых RUB с безопасной точностью; не сохраняется и не меняет профиль, заявку или решение. Admin и bank недоступен.',
    body: ref('CashflowRequest'),
    response: ref('CashflowResult'),
  },
  {
    method: 'get',
    path: '/business-profile',
    summary: 'Client: профиль своей организации и документы по правовой форме',
    tag: 'BusinessProfile',
    response: ref('BusinessProfileResponse'),
  },
  {
    method: 'put',
    path: '/business-profile',
    summary:
      'Client session: сохранить профиль с проверкой версии; отправленные заявки сохраняют снимок',
    tag: 'BusinessProfile',
    body: {
      type: 'object',
      required: ['version', 'profile', 'financials'],
      properties: {
        version: { type: 'integer', minimum: 1 },
        profile: ref('BusinessProfile'),
        financials: ref('Financials'),
      },
    },
    response: ref('BusinessProfileResponse'),
  },
  {
    method: 'get',
    path: '/recommendations',
    summary:
      'Client: детерминированный подбор по сохранённому профилю с причинами и рыночным срезом',
    tag: 'BusinessProfile',
    response: ref('RecommendationsResponse'),
  },
  {
    method: 'get',
    path: '/admin/overview',
    summary: 'Admin: агрегаты платформы; черновики только в счётчиках',
    tag: 'Administration',
  },
  {
    method: 'get',
    path: '/admin/users',
    summary: 'Admin: пользователи и количество действующих/истёкших сессий без секретов',
    tag: 'Administration',
  },
  {
    method: 'get',
    path: '/admin/products',
    summary: 'Admin: продукты и версионируемый статус приёма',
    tag: 'Administration',
  },
  {
    method: 'get',
    path: '/admin/registry',
    summary: 'Admin: метаданные отправленных заявок без досье и содержимого черновиков',
    tag: 'Administration',
  },
  {
    method: 'get',
    path: '/admin/audit',
    summary: 'Admin: 200 последних событий; контекст ограничен техническими версиями',
    tag: 'Administration',
    response: {
      type: 'object',
      required: ['events', 'limit'],
      additionalProperties: false,
      properties: {
        events: { type: 'array', maxItems: 200, items: ref('AdminAuditRecord') },
        limit: { type: 'integer', const: 200 },
      },
    },
  },
  {
    method: 'get',
    path: '/admin/export',
    summary: 'Admin: полный доступный реестр или аудит JSON/CSV; выгрузка аудируется',
    tag: 'Administration',
  },
  {
    method: 'patch',
    path: '/admin/products/{id}/intake',
    summary:
      'Admin: приостановить/возобновить первую отправку заявки; существующее рассмотрение продолжается',
    tag: 'Administration',
    body: {
      type: 'object',
      required: ['version', 'paused', 'reason'],
      properties: {
        version: { type: 'integer', minimum: 1 },
        paused: { type: 'boolean' },
        reason: { type: 'string', minLength: 5, maxLength: 300 },
      },
    },
  },
  {
    method: 'get',
    path: '/local-ai/status',
    summary: 'Готовность необязательной локальной модели; облачный runtime не запускает inference',
    tag: 'LocalAI',
  },
  {
    method: 'post',
    path: '/local-ai/explain',
    summary: 'Client/bank: объяснение доступной заявки локальной моделью без изменения решения',
    tag: 'LocalAI',
    body: {
      type: 'object',
      required: ['applicationId', 'version', 'topic'],
      properties: {
        applicationId: { type: 'string' },
        version: { type: 'integer', minimum: 1 },
        profileVersion: {
          type: 'integer',
          minimum: 1,
          description:
            'Ожидаемая версия бизнес-профиля для защиты от устаревшего объяснения черновика.',
        },
        topic: { type: 'string', enum: ['overview', 'payment', 'documents'] },
      },
    },
    response: {
      type: 'object',
      required: [
        'text',
        'method',
        'selectedFactIds',
        'model',
        'modelDigest',
        'topic',
        'applicationId',
        'applicationVersion',
        'profileVersion',
        'assessmentVersion',
        'generatedAt',
        'truncated',
      ],
      properties: {
        text: {
          type: 'string',
          description:
            'Текст собран сервером из проверенных русских фактов. Реальный статус и обязательное пояснение добавлены независимо от выбора модели; свободная генерация не возвращается.',
        },
        method: { const: 'verified-fact-selection-v1' },
        selectedFactIds: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: { type: 'string' },
          description:
            'Идентификаторы выбранных моделью фактов из разрешённого серверного списка текущей темы. Неизвестные ID и лишние поля отклоняются.',
        },
        model: { type: 'string' },
        modelDigest: { type: 'string' },
        topic: { type: 'string', enum: ['overview', 'payment', 'documents'] },
        applicationId: { type: 'string' },
        applicationVersion: { type: 'integer', minimum: 1 },
        profileVersion: { type: 'integer', minimum: 1 },
        assessmentVersion: { type: 'string' },
        generatedAt: { type: 'string', format: 'date-time' },
        truncated: {
          const: false,
          description: 'Усечённый ответ модели отклоняется и не выдаётся как успешное объяснение.',
        },
      },
    },
  },
  {
    method: 'post',
    path: '/applications/{id}/documents/ocr',
    summary:
      'Client: сохранить проверенную пользователем OCR-копию и происхождение; оригинал и подлинность не подтверждаются',
    tag: 'Documents',
    status: 201,
    body: {
      type: 'object',
      required: [
        'version',
        'category',
        'text',
        'sourceName',
        'sourceSha256',
        'sourceSize',
        'sourceMimeType',
        'pages',
        'engine',
        'reviewed',
      ],
      properties: {
        version: { type: 'integer', minimum: 1 },
        category: { type: 'string', enum: ['statement', 'financials', 'invoice', 'other'] },
        text: { type: 'string', minLength: 1, maxLength: 100000 },
        sourceName: { type: 'string', maxLength: 255 },
        sourceSha256: {
          type: 'string',
          pattern: '^[a-f0-9]{64}$',
          description: 'Хэш сообщён браузером, оригинал сервер не получает.',
        },
        sourceSize: { type: 'integer', minimum: 1, maximum: 10485760 },
        sourceMimeType: { type: 'string', enum: ['application/pdf', 'image/png', 'image/jpeg'] },
        pages: { type: 'integer', minimum: 1, maximum: 5 },
        engine: { const: 'tesseract.js@7.0.0' },
        reviewed: { const: true },
      },
    },
  },
  {
    method: 'get',
    path: '/health',
    summary: 'Состояние и режим прототипа',
    tag: 'System',
    public: true,
  },
  {
    method: 'get',
    path: '/openapi.json',
    summary: 'Спецификация API',
    tag: 'System',
    public: true,
  },
  {
    method: 'get',
    path: '/auth/demo-accounts',
    summary: 'Синтетические учётные записи и демонстрационный пароль',
    tag: 'Auth',
    public: true,
  },
  {
    method: 'post',
    path: '/auth/login',
    summary: 'Вход; выдаёт HttpOnly SameSite=Strict cookie',
    tag: 'Auth',
    public: true,
    body: {
      type: 'object',
      required: ['email', 'password'],
      properties: { email: { type: 'string' }, password: { type: 'string' } },
    },
    response: ref('AuthResponse'),
  },
  { method: 'post', path: '/auth/logout', summary: 'Удаление текущей сессии', tag: 'Auth' },
  {
    method: 'get',
    path: '/auth/me',
    summary: 'Пользователь и его организация',
    tag: 'Auth',
    response: ref('AuthResponse'),
  },
  {
    method: 'get',
    path: '/dashboard',
    summary: 'Агрегаты, заявки, персональная лента и следующие действия',
    tag: 'Workspace',
  },
  {
    method: 'get',
    path: '/products',
    summary: 'Каталог трёх продуктов',
    tag: 'Products',
    response: {
      type: 'object',
      properties: { products: { type: 'array', items: ref('Product') } },
    },
  },
  {
    method: 'get',
    path: '/applications',
    summary: 'Все доступные заявки, новые первыми',
    tag: 'Applications',
    response: {
      type: 'object',
      properties: { applications: { type: 'array', items: ref('Application') } },
    },
  },
  {
    method: 'post',
    path: '/applications',
    summary: 'Создание черновика своей организации',
    tag: 'Applications',
    body: ref('ApplicationInput'),
    status: 201,
    response: { type: 'object', properties: { application: ref('Application') } },
  },
  {
    method: 'get',
    path: '/applications/{id}',
    summary: 'Заявка, документы, история, компания и предварительная оценка',
    tag: 'Applications',
    response: ref('ApplicationDetail'),
  },
  {
    method: 'patch',
    path: '/applications/{id}',
    summary: 'Изменение полей только в draft/needs_info',
    tag: 'Applications',
    body: {
      type: 'object',
      required: ['version'],
      properties: { ...input.properties, version: { type: 'integer', minimum: 1 } },
    },
    response: { type: 'object', properties: { application: ref('Application') } },
  },
  {
    method: 'post',
    path: '/applications/{id}/actions/{action}',
    summary: 'Переход состояния: submit, supplement, accept-offer, sign, fund',
    tag: 'Applications',
    body: versionBody,
    response: ref('ApplicationDetail'),
  },
  {
    method: 'get',
    path: '/bank/queue',
    summary: 'Очередь банка; роль bank, все недрафтовые заявки',
    tag: 'Bank',
  },
  {
    method: 'post',
    path: '/bank/applications/{id}/review',
    summary: 'Начать рассмотрение submitted; локальные проверки и скоринг',
    tag: 'Bank',
    body: versionBody,
    response: ref('ApplicationDetail'),
  },
  {
    method: 'post',
    path: '/bank/applications/{id}/decision',
    summary: 'Зафиксировать решение политики или мотивированный запрос сведений',
    tag: 'Bank',
    body: {
      type: 'object',
      required: ['version'],
      properties: {
        version: { type: 'integer' },
        outcome: { type: 'string', enum: ['approved', 'needs_info', 'counter_offer', 'declined'] },
        reason: { type: 'string', maxLength: 1000 },
        requestedDocuments: {
          type: 'array',
          items: { type: 'string', enum: ['statement', 'financials', 'invoice', 'other'] },
        },
      },
    },
    response: ref('ApplicationDetail'),
  },
  {
    method: 'get',
    path: '/documents',
    summary: 'Метаданные всех доступных документов',
    tag: 'Documents',
  },
  {
    method: 'post',
    path: '/applications/{id}/documents',
    summary: 'Загрузить реальный файл до 1 МБ; увеличивает version заявки',
    tag: 'Documents',
    status: 201,
  },
  {
    method: 'post',
    path: '/applications/{id}/documents/sample',
    summary: 'Создать скачиваемый синтетический TXT; увеличивает version',
    tag: 'Documents',
    body: {
      type: 'object',
      required: ['category'],
      properties: {
        category: { type: 'string', enum: ['statement', 'financials', 'invoice', 'other'] },
      },
    },
    status: 201,
  },
  {
    method: 'get',
    path: '/documents/{id}/download',
    summary: 'Авторизованное скачивание attachment; без публичных URL',
    tag: 'Documents',
  },
  {
    method: 'post',
    path: '/scenario',
    summary: 'Детерминированный BigInt-аннуитет; целые RUB, без записи',
    tag: 'Calculation',
    body: {
      type: 'object',
      required: ['productId', 'amount', 'termMonths', 'financials'],
      properties: {
        productId: input.properties.productId,
        amount: input.properties.amount,
        termMonths: input.properties.termMonths,
        financials: ref('Financials'),
      },
    },
    response: ref('ScenarioResult'),
  },
  {
    method: 'post',
    path: '/scenario/affordability',
    summary: 'Сумма от комфортного платежа и запаса в месяц; без записи и банковского решения',
    tag: 'Calculation',
    body: {
      type: 'object',
      required: ['productId', 'termMonths', 'financials', 'comfortablePayment', 'monthlyReserve'],
      properties: {
        productId: input.properties.productId,
        termMonths: input.properties.termMonths,
        financials: ref('Financials'),
        comfortablePayment: { type: 'integer', minimum: 0, maximum: 1000000000 },
        monthlyReserve: { type: 'integer', minimum: 0, maximum: 1000000000 },
      },
    },
    response: ref('BudgetScenarioResult'),
  },
  {
    method: 'get',
    path: '/preferences',
    summary: 'Личные настройки интерфейса и интересы',
    tag: 'Workspace',
    response: ref('Preferences'),
  },
  {
    method: 'patch',
    path: '/preferences',
    summary: 'Сохранить подмножество личных настроек',
    tag: 'Workspace',
    body: ref('Preferences'),
    response: ref('Preferences'),
  },
  {
    method: 'get',
    path: '/feed',
    summary: 'Персональная синтетическая редакционная лента',
    tag: 'Workspace',
  },
  {
    method: 'get',
    path: '/search',
    summary: 'Поиск только по доступным данным, 2–100 символов',
    tag: 'Workspace',
  },
  {
    method: 'get',
    path: '/audit',
    summary: 'Client/bank: последние 200 доступных событий с сохранённым контекстом',
    tag: 'Workspace',
    response: {
      type: 'object',
      required: ['events'],
      additionalProperties: false,
      properties: { events: { type: 'array', maxItems: 200, items: ref('AuditRecord') } },
    },
  },
  {
    method: 'get',
    path: '/export',
    summary: 'Выгрузка своих заявок JSON или CSV; банк не выгружает клиентов',
    tag: 'Data',
  },
  {
    method: 'post',
    path: '/import/validate',
    summary: 'Проверить 1–20 записей; preview действует 30 минут',
    tag: 'Data',
    body: {
      type: 'object',
      required: ['applications'],
      properties: {
        applications: { type: 'array', minItems: 1, maxItems: 20, items: ref('ApplicationInput') },
      },
    },
  },
  {
    method: 'post',
    path: '/import/apply',
    summary: 'Применить свой preview атомарно; повторы не дублируют заявки',
    tag: 'Data',
    body: {
      type: 'object',
      required: ['previewId'],
      properties: { previewId: { type: 'string' } },
    },
    status: 201,
  },
  {
    method: 'get',
    path: '/integrations/tokens',
    summary: 'Метаданные собственных токенов, без открытых секретов',
    tag: 'Integrations',
  },
  {
    method: 'post',
    path: '/integrations/tokens',
    summary: 'Выдать токен чтения/расчётов на 7 дней; секрет показывается один раз',
    tag: 'Integrations',
    body: { type: 'object', properties: { name: { type: 'string', maxLength: 80 } } },
    status: 201,
  },
  {
    method: 'delete',
    path: '/integrations/tokens/{id}',
    summary: 'Отозвать собственный токен',
    tag: 'Integrations',
  },
  {
    method: 'post',
    path: '/mcp',
    summary:
      'MCP 2025-11-25 / 2025-03-26: stateless Streamable HTTP, JSON, одиннадцать инструментов чтения и расчёта',
    tag: 'Integrations',
    body: object,
  },
];
const paths: Record<string, Record<string, unknown>> = {};
for (const r of routes) {
  const parameters: object[] = [];
  for (const token of r.path.matchAll(/\{([^}]+)\}/g))
    parameters.push({
      name: token[1],
      in: 'path',
      required: true,
      schema:
        token[1] === 'action'
          ? { type: 'string', enum: ['submit', 'supplement', 'accept-offer', 'sign', 'fund'] }
          : { type: 'string' },
    });
  if (r.path === '/search')
    parameters.push({
      name: 'q',
      in: 'query',
      required: true,
      schema: { type: 'string', minLength: 2, maxLength: 100 },
    });
  if (r.path === '/export' || r.path === '/admin/export')
    parameters.push({
      name: 'format',
      in: 'query',
      schema: { type: 'string', enum: ['json', 'csv'], default: 'json' },
    });
  if (r.path === '/admin/export')
    parameters.push({
      name: 'kind',
      in: 'query',
      schema: { type: 'string', enum: ['registry', 'audit'], default: 'registry' },
    });
  const tokenAllowed =
    (r.method === 'get' &&
      [
        '/products',
        '/applications',
        '/applications/{id}',
        '/business-profile',
        '/recommendations',
        '/applications/{id}/statement',
      ].includes(r.path)) ||
    ['/scenario', '/scenario/cashflow', '/navigator/analyze', '/mcp'].includes(r.path);
  let requestBody: { required: boolean; content: Record<string, { schema: object }> } | undefined =
    r.body ? { required: true, content: json(r.body) } : undefined;
  if (r.path === '/applications/{id}/documents')
    requestBody = {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['file', 'category'],
            properties: {
              file: { type: 'string', format: 'binary' },
              category: { type: 'string', enum: ['statement', 'financials', 'invoice', 'other'] },
            },
          },
        },
      },
    };
  const operation = {
    summary: r.summary,
    ...(r.description ? { description: r.description } : {}),
    tags: [r.tag],
    operationId: `${r.method}_${r.path.replaceAll(/[{}]/g, '').replaceAll('/', '_').replaceAll('-', '_').replaceAll('.', '_')}`,
    security: r.public
      ? []
      : tokenAllowed
        ? [{ sessionCookie: [] }, { integrationToken: [] }]
        : [{ sessionCookie: [] }],
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: {
      [r.status ?? 200]: {
        description: 'Успешный ответ; все финансовые сведения синтетические.',
        content: json(r.response ?? object),
      },
      '400': { description: 'Некорректные данные', content: json(ref('Error')) },
      '401': { description: 'Нужна аутентификация', content: json(ref('Error')) },
      '403': { description: 'Недостаточно прав', content: json(ref('Error')) },
      '404': { description: 'Объект отсутствует или недоступен', content: json(ref('Error')) },
      '409': {
        description: 'Конфликт версии или недопустимый переход',
        content: json(ref('Error')),
      },
      '413': {
        description: 'Превышен размер тела запроса или CSV 1 МБ',
        content: json(ref('Error')),
      },
    },
  };
  (paths[r.path] ??= {})[r.method] = operation;
}
paths['/mcp'].post = {
  ...(paths['/mcp'].post as Record<string, unknown>),
  description:
    'initialize, notifications/initialized, ping, tools/list, tools/call. Tools: list_applications, calculate_scenario, get_business_profile, recommend_products, get_statement_analysis(applicationId), analyze_financing_request(request), calculate_cashflow. Bearer personal token or session. No OAuth, SSE, server sessions, writes or automatic inference. Statement report is the saved snapshot under dossier access rules; navigator and cashflow are non-mutating calculations for the owning client. Error in a tool result has isError=true. The same domain and access rules as REST apply.',
  parameters: [
    {
      name: 'MCP-Protocol-Version',
      in: 'header',
      schema: { type: 'string', enum: ['2025-11-25', '2025-03-26'] },
    },
  ],
  requestBody: {
    required: true,
    content: json({
      type: 'object',
      required: ['jsonrpc', 'method'],
      properties: {
        jsonrpc: { const: '2.0' },
        id: { type: ['string', 'integer'] },
        method: { type: 'string' },
        params: object,
      },
    }),
  },
  responses: {
    '200': {
      description: 'JSON-RPC response; tool execution failures use result.isError=true.',
      content: json(object),
    },
    '202': { description: 'Accepted notification; empty body.' },
    '400': {
      description: 'JSON-RPC parse, envelope, method, params or protocol-version error.',
      content: json(object),
    },
    '401': {
      description: 'Missing, expired or revoked token/session.',
      content: json(ref('Error')),
    },
    '403': { description: 'Origin or role denied.', content: json(ref('Error')) },
    '406': { description: 'Client must accept JSON responses.', content: json(object) },
    '413': { description: 'MCP request exceeds 32 KiB.', content: json(object) },
    '415': { description: 'Content-Type must be application/json.', content: json(object) },
    '500': { description: 'Sanitized JSON-RPC internal error.', content: json(object) },
  },
};
for (const method of ['get', 'delete'])
  paths['/mcp'][method] = {
    summary: 'Transport capability: no SSE stream or server session',
    tags: ['Integrations'],
    security: [{ sessionCookie: [] }, { integrationToken: [] }],
    responses: {
      '405': { description: 'Not supported; empty body and Allow: POST.' },
      '401': { description: 'Authentication required.' },
      '403': { description: 'Origin or role denied.' },
    },
  };
Object.assign(paths, V9_PATHS);
export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'Debitus-Kreditus demo API',
    version: APP_VERSION,
    description:
      'Связанный синтетический кредитный конвейер. Локальные симуляторы ФНС/БКИ. Подписание, выдача и обслуживание не имеют юридических или денежных последствий. Money = integer RUB. Cookie auth для кабинета. Bearer: доступные products/applications/details/business-profile/recommendations/statement/action-plan/alternatives/servicing, банковское changes только для роли bank, POST scenario/scenario-cashflow/navigator-analyze/mcp. Одиннадцать MCP-инструментов чтения и расчёта. GET/DELETE mcp возвращают 405: SSE и серверные сессии не используются. Токен не разрешает запись или подтверждение обслуживания. Все расчёты детерминированы; внешнее inference не используется.',
  },
  servers: [{ url: '/api' }],
  paths,
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'dk_session' },
      integrationToken: {
        type: 'http',
        scheme: 'bearer',
        description: 'Read-only + calculate; нельзя создавать или менять заявки.',
      },
    },
    schemas: {
      ...PROFILE_SCHEMAS,
      ...V8_SCHEMAS,
      ...V9_SCHEMAS,
      Financials: {
        type: 'object',
        required: ['monthlyRevenue', 'monthlyExpenses', 'monthlyDebtPayment'],
        properties: {
          monthlyRevenue: { type: 'integer', minimum: 0, maximum: 1000000000 },
          monthlyExpenses: { type: 'integer', minimum: 0, maximum: 1000000000 },
          monthlyDebtPayment: { type: 'integer', minimum: 0, maximum: 1000000000 },
        },
      },
      Organization: {
        type: 'object',
        required: [
          'id',
          'name',
          'inn',
          'industry',
          'city',
          'monthsActive',
          'monthlyRevenue',
          'monthlyExpenses',
          'monthlyDebtPayment',
          'overdueDays',
          'registered',
          'scenario',
        ],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          inn: { type: 'string' },
          industry: { type: 'string' },
          city: { type: 'string' },
          monthsActive: { type: 'integer', minimum: 0 },
          monthlyRevenue: { type: 'integer', minimum: 0 },
          monthlyExpenses: { type: 'integer', minimum: 0 },
          monthlyDebtPayment: { type: 'integer', minimum: 0 },
          overdueDays: { type: 'integer', minimum: 0 },
          registered: { type: 'boolean' },
          scenario: { type: 'string', enum: ['strong', 'missing', 'overdue'] },
          profile: ref('BusinessProfile'),
        },
      },
      OrganizationSnapshotMeta: {
        type: 'object',
        required: ['source', 'capturedAt', 'profileVersion'],
        properties: {
          source: {
            type: 'string',
            enum: ['submission', 'synthetic_seed', 'legacy_recovery'],
            description:
              'submission — при отправке; synthetic_seed — из синтетического набора; legacy_recovery — доступный контекст старой заявки при закреплении, не её отсутствовавший исторический снимок.',
          },
          capturedAt: { type: 'string', format: 'date-time' },
          profileVersion: { type: 'integer', minimum: 1 },
          captureId: { type: 'string' },
        },
      },
      AuditVersions: {
        type: 'object',
        required: ['schemaVersion', 'applicationVersion'],
        additionalProperties: false,
        description:
          'Только технические версии события. В административном журнале и его JSON-экспорте input/assessment отсутствуют; старые события могут не иметь context.',
        properties: auditVersionProperties,
      },
      AuditContext: {
        type: 'object',
        required: ['schemaVersion', 'applicationVersion'],
        additionalProperties: false,
        description:
          'Снимок на момент нового события, сохранённый вместе с изменением заявки. assessment содержит только реально сохранённые score/decision/checks, без пересчёта. Старые события не дополняются задним числом. Доступен клиенту своей организации и банку после подачи заявки; администратору не выдаётся.',
        properties: {
          ...auditVersionProperties,
          input: {
            type: 'object',
            required: ['status', 'productId', 'amount', 'termMonths', 'purpose', 'financials'],
            additionalProperties: false,
            properties: {
              status: applicationStatus,
              productId: { type: 'string' },
              productSnapshot: ref('Product'),
              amount: { type: 'integer' },
              termMonths: { type: 'integer' },
              purpose: { type: 'string' },
              financials: ref('Financials'),
              organizationSnapshot: ref('Organization'),
              organizationSnapshotMeta: ref('OrganizationSnapshotMeta'),
            },
          },
          assessment: {
            type: 'object',
            required: ['score', 'decision', 'checks'],
            additionalProperties: false,
            properties: {
              score: { anyOf: [ref('Score'), { type: 'null' }] },
              decision: { anyOf: [ref('Decision'), { type: 'null' }] },
              checks: { type: 'array', items: ref('ExternalCheck') },
            },
          },
        },
      },
      AuditRecord: {
        type: 'object',
        required: Object.keys(auditRecordProperties),
        additionalProperties: false,
        properties: { ...auditRecordProperties, context: ref('AuditContext') },
      },
      AdminAuditRecord: {
        type: 'object',
        required: Object.keys(auditRecordProperties),
        additionalProperties: false,
        description:
          'Событие платформы без финансового досье: detail заявки заменён общим названием действия, context содержит только AuditVersions. Исходные финансовые показатели, снимок организации, факторы и причины решения не возвращаются.',
        properties: { ...auditRecordProperties, context: ref('AuditVersions') },
      },
      TimelineEvent: {
        type: 'object',
        required: ['id', 'action', 'title', 'detail', 'actor', 'createdAt'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          action: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
          actor: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          context: ref('AuditContext'),
        },
      },
      ExternalCheck: {
        type: 'object',
        required: ['source', 'simulated', 'status', 'label', 'details', 'checkedAt'],
        properties: {
          source: { type: 'string' },
          simulated: { type: 'boolean', const: true },
          status: { type: 'string', enum: ['passed', 'warning', 'failed'] },
          label: { type: 'string' },
          details: { type: 'string' },
          checkedAt: { type: 'string', format: 'date-time' },
        },
      },
      ApplicationInput: input,
      Application: {
        allOf: [
          ref('ApplicationInput'),
          {
            type: 'object',
            required: ['id', 'organizationId', 'status', 'version'],
            properties: {
              id: { type: 'string' },
              number: { type: 'string' },
              organizationId: { type: 'string' },
              organizationName: { type: 'string' },
              organizationSnapshot: {
                ...ref('Organization'),
                description:
                  'Зафиксированный профиль организации; происхождение указано в organizationSnapshotMeta. Изменения профиля не переписывают снимок.',
              },
              organizationSnapshotMeta: ref('OrganizationSnapshotMeta'),
              status: applicationStatus,
              version: { type: 'integer', minimum: 1 },
              score: { anyOf: [ref('Score'), { type: 'null' }] },
              decision: { anyOf: [ref('Decision'), { type: 'null' }] },
              checks: { type: 'array', items: ref('ExternalCheck') },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        ],
      },
      Score: {
        type: 'object',
        properties: {
          value: { type: 'integer', minimum: 0, maximum: 100 },
          band: { type: 'string', enum: ['low', 'medium', 'high'] },
          factors: {
            type: 'array',
            items: {
              type: 'object',
              required: ['code', 'label', 'points', 'detail'],
              properties: {
                code: { type: 'string' },
                label: { type: 'string' },
                points: { type: 'integer' },
                detail: { type: 'string' },
              },
            },
          },
          modelVersion: { type: 'string' },
          evaluatedAt: { type: 'string', format: 'date-time' },
          profileVersion: { type: 'integer' },
          paymentLimit: { type: 'integer', description: 'Предел каждого нового платежа в рублях.' },
          stressRemainingCash: { type: 'integer' },
        },
      },
      Decision: {
        type: 'object',
        properties: {
          outcome: {
            type: 'string',
            enum: ['approved', 'needs_info', 'counter_offer', 'declined'],
          },
          reasons: { type: 'array', items: { type: 'string' } },
          requestedDocuments: { type: 'array', items: { type: 'string' } },
          documentRequest: {
            type: 'object',
            required: ['id', 'requestedAt', 'baselineDocumentIds', 'categories', 'methodVersion'],
            properties: {
              id: { type: 'string' },
              requestedAt: { type: 'string', format: 'date-time' },
              baselineDocumentIds: { type: 'array', items: { type: 'string' } },
              categories: { type: 'array', items: { type: 'string' } },
              methodVersion: { const: 'document-id-baseline-v1' },
            },
            description:
              'Снимок файлов при запросе сведений. Для каждой категории нужно новое вложение; это не подтверждение его содержания. Отсутствует у прежних решений, где используется явно описанное ограничение дат.',
          },
          offer: { anyOf: [ref('Offer'), { type: 'null' }] },
          ruleVersion: { type: 'string' },
          decidedBy: { type: 'string' },
          decidedAt: { type: 'string', format: 'date-time' },
        },
      },
      Offer: {
        type: 'object',
        properties: {
          amount: { type: 'integer' },
          termMonths: { type: 'integer' },
          rateBps: { type: 'integer' },
          monthlyPayment: { type: 'integer' },
          totalRepayment: { type: 'integer' },
          totalInterest: { type: 'integer' },
        },
      },
      ScenarioResult: {
        allOf: [
          ref('Offer'),
          {
            type: 'object',
            properties: {
              schedule: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    month: { type: 'integer' },
                    dueDate: { type: 'string', format: 'date' },
                    payment: { type: 'integer' },
                    principal: { type: 'integer' },
                    interest: { type: 'integer' },
                    balance: { type: 'integer' },
                  },
                },
              },
              assumptions: { type: 'array', items: { type: 'string' } },
              methodVersion: { type: 'string' },
              affordable: { type: 'boolean' },
              availableCash: { type: 'integer' },
              debtLoadBps: { type: 'integer' },
            },
          },
        ],
      },
      BudgetScenarioResult: {
        type: 'object',
        properties: {
          input: { type: 'object' },
          availableCash: { type: 'integer' },
          policyPaymentLimit: { type: 'integer' },
          reservePaymentLimit: { type: 'integer' },
          effectivePaymentLimit: { type: 'integer' },
          minimumProductPayment: { type: 'integer' },
          maximumScheduledPayment: { type: 'integer' },
          minimumRemainingCash: { type: 'integer' },
          bindingLimits: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['comfortable_payment', 'monthly_reserve', 'policy', 'product_maximum'],
            },
          },
          suggestion: { anyOf: [ref('ScenarioResult'), { type: 'null' }] },
          amountStep: { type: 'integer' },
          assumptions: { type: 'array', items: { type: 'string' } },
          methodVersion: { type: 'string' },
        },
      },
      Product: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          minAmount: { type: 'integer' },
          maxAmount: { type: 'integer' },
          minTerm: { type: 'integer' },
          maxTerm: { type: 'integer' },
          rateBps: { type: 'integer' },
          requiredDocuments: { type: 'array', items: { type: 'string' } },
          intake: ref('ProductIntake'),
        },
      },
      ProductIntake: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          paused: { type: 'boolean' },
          reason: { type: 'string' },
          version: { type: 'integer' },
          updatedAt: { type: 'string', format: 'date-time' },
          updatedBy: { type: ['string', 'null'] },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string' },
              role: { type: 'string', enum: ['client', 'bank', 'admin'] },
              organizationId: { type: ['string', 'null'] },
            },
          },
          organization: { type: ['object', 'null'] },
        },
      },
      ApplicationDetail: {
        type: 'object',
        properties: {
          application: ref('Application'),
          organization: ref('Organization'),
          product: ref('Product'),
          documents: { type: 'array', items: object },
          timeline: { type: 'array', items: ref('TimelineEvent') },
          assessment: {
            type: 'object',
            properties: {
              score: ref('Score'),
              decision: ref('Decision'),
              checks: { type: 'array', items: ref('ExternalCheck') },
            },
          },
        },
      },
      Preferences: {
        type: 'object',
        properties: {
          theme: { type: 'string', enum: ['light', 'dark'] },
          accent: { type: 'string', enum: ['red', 'mint', 'violet', 'amber'] },
          density: { type: 'string', enum: ['comfortable', 'compact'] },
          reducedMotion: { type: 'boolean' },
          widgets: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['applications', 'feed', 'actions', 'products', 'stats', 'simulator'],
            },
          },
          interests: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['growth', 'cashflow', 'equipment', 'documents', 'risk'],
            },
          },
        },
      },
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
          },
        },
      },
    },
  },
};
