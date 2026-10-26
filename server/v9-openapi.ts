const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const str = { type: 'string' };
const integer = { type: 'integer' };
const nonnegative = { type: 'integer', minimum: 0 };
const boolean = { type: 'boolean' };
const date = { type: 'string', format: 'date' };
const datetime = { type: 'string', format: 'date-time' };
const array = (items: object) => ({ type: 'array', items });
const strings = array(str);
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const obj = (properties: Record<string, object>, required = Object.keys(properties)) => ({
  type: 'object',
  required,
  properties,
});
const assessment = obj({
  score: ref('Score'),
  decision: ref('Decision'),
  checks: array(ref('ExternalCheck')),
});
const intent = { type: 'string', enum: ['lower_payment', 'less_interest', 'closer_amount'] };
const mode = { type: 'string', enum: ['reduce_payment', 'reduce_term'] };
const serviceInput = {
  version: nonnegative,
  idempotencyKey: { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,100}$' },
  confirmed: { const: true },
};
const prepaymentInput = {
  version: nonnegative,
  amount: { type: 'integer', minimum: 1, maximum: 30000000 },
  mode,
};
const statementSnapshot = obj({
  id: str,
  applicationVersion: integer,
  createdAt: datetime,
  period: str,
  methodVersion: str,
  declaredFinancials: ref('Financials'),
  findings: array(obj({ code: str, title: str, detail: str })),
});
const assessmentSnapshot = obj({
  score: nullable(integer),
  outcome: nullable(str),
  scoringVersion: nullable(str),
  policyVersion: nullable(str),
});
const document = obj(
  {
    id: str,
    applicationId: str,
    name: str,
    category: str,
    mimeType: str,
    size: nonnegative,
    sha256: str,
    createdAt: datetime,
    downloadUrl: str,
    synthetic: boolean,
    ocr: { type: 'object' },
  },
  [
    'id',
    'applicationId',
    'name',
    'category',
    'mimeType',
    'size',
    'sha256',
    'createdAt',
    'downloadUrl',
    'synthetic',
  ],
);

export const V9_SCHEMAS = {
  ApplicationActionSource: obj(
    {
      kind: {
        type: 'string',
        enum: ['application', 'document', 'statement', 'profile', 'decision', 'calculation'],
      },
      label: str,
      at: datetime,
      version: integer,
      href: str,
      detail: str,
    },
    ['kind', 'label', 'at', 'href'],
  ),
  ApplicationActionItem: obj({
    id: str,
    priority: { type: 'string', enum: ['required', 'review', 'next'] },
    category: {
      type: 'string',
      enum: ['documents', 'financials', 'statement', 'decision', 'consent', 'process'],
    },
    title: str,
    what: str,
    why: str,
    href: str,
    actionLabel: str,
    sources: array(ref('ApplicationActionSource')),
  }),
  ApplicationActionPlan: obj({
    applicationId: str,
    applicationVersion: integer,
    generatedAt: datetime,
    methodVersion: str,
    status: str,
    headline: str,
    items: array(ref('ApplicationActionItem')),
    limitations: strings,
  }),
  ApplicationChanges: obj({
    applicationId: str,
    currentVersion: integer,
    generatedAt: datetime,
    methodVersion: str,
    baseline: obj(
      {
        available: boolean,
        kind: {
          type: 'string',
          enum: ['information_request', 'bank_review', 'submission', 'unavailable'],
        },
        version: integer,
        at: datetime,
        label: str,
        limitation: str,
      },
      ['available', 'kind', 'label'],
    ),
    fields: array(
      obj({
        key: str,
        label: str,
        before: { type: ['number', 'string', 'boolean', 'null'] },
        after: { type: ['number', 'string', 'boolean', 'null'] },
      }),
    ),
    factors: array(
      obj({
        code: str,
        label: str,
        beforePoints: nullable(integer),
        afterPoints: nullable(integer),
        beforeDetail: nullable(str),
        afterDetail: nullable(str),
      }),
    ),
    checks: array(
      obj({
        key: str,
        label: str,
        beforeStatus: nullable(str),
        afterStatus: nullable(str),
        beforeDetail: nullable(str),
        afterDetail: nullable(str),
      }),
    ),
    documents: obj({ added: array(document), uncertain: array(document), note: str }),
    statements: obj({
      comparable: boolean,
      before: nullable(statementSnapshot),
      current: nullable(statementSnapshot),
      note: str,
    }),
    assessment: obj({
      before: nullable(assessmentSnapshot),
      current: assessmentSnapshot,
      note: str,
    }),
    hasChanges: boolean,
    limitations: strings,
  }),
  FinancingAlternative: obj({
    id: str,
    intent,
    title: str,
    explanation: str,
    calculation: ref('ScenarioResult'),
    maximumPayment: nonnegative,
    minimumRemainingCash: integer,
    assessment,
    blockers: strings,
    deltas: obj({
      amount: integer,
      termMonths: integer,
      maximumPayment: integer,
      totalInterest: integer,
    }),
    draft: ref('ApplicationInput'),
  }),
  FinancingAlternatives: obj({
    applicationId: str,
    applicationVersion: integer,
    profileVersion: integer,
    financialsAsOf: date,
    generatedAt: datetime,
    source: { type: 'string', enum: ['current_profile', 'submission_snapshot'] },
    snapshotCapturedAt: nullable(datetime),
    product: obj({ id: str, name: str, intakePaused: boolean }),
    purpose: str,
    financials: ref('Financials'),
    baseline: obj({ calculation: ref('ScenarioResult'), maximumPayment: nonnegative, assessment }),
    options: array(ref('FinancingAlternative')),
    unavailable: array(obj({ intent, reason: str })),
    blockers: strings,
    assumptions: strings,
    search: obj({
      termStepMonths: { const: 1 },
      amountStep: { const: 1000 },
      termsChecked: nonnegative,
      evaluations: nonnegative,
    }),
    methodVersion: str,
  }),
  ServicingPaymentRow: obj({
    month: { type: 'integer', minimum: 1, maximum: 60 },
    dueDate: date,
    payment: nonnegative,
    principal: nonnegative,
    interest: nonnegative,
    balance: nonnegative,
  }),
  ServicingEvent: obj(
    {
      id: str,
      kind: { type: 'string', enum: ['payment', 'prepayment'] },
      recordedAt: datetime,
      effectiveDate: date,
      amount: nonnegative,
      principal: nonnegative,
      interest: nonnegative,
      balance: nonnegative,
      mode,
      actor: str,
    },
    [
      'id',
      'kind',
      'recordedAt',
      'effectiveDate',
      'amount',
      'principal',
      'interest',
      'balance',
      'actor',
    ],
  ),
  LoanServicingState: obj({
    applicationId: str,
    version: nonnegative,
    methodVersion: str,
    simulated: { const: true },
    status: { type: 'string', enum: ['active', 'closed'] },
    offer: ref('Offer'),
    fundedAt: datetime,
    balance: nonnegative,
    paymentsRecorded: nonnegative,
    paidPrincipal: nonnegative,
    paidInterest: nonnegative,
    totalRecorded: nonnegative,
    remainingInterest: nonnegative,
    remainingPayments: nonnegative,
    nextPayment: nullable(ref('ServicingPaymentRow')),
    schedule: array(ref('ServicingPaymentRow')),
    history: array(ref('ServicingEvent')),
    prepaymentAvailable: boolean,
    boundaryDate: nullable(date),
    assumptions: strings,
  }),
  ServicingResponse: obj({ servicing: ref('LoanServicingState') }),
  ServicingPaymentInput: { ...obj(serviceInput), additionalProperties: false },
  PrepaymentPreviewInput: { ...obj(prepaymentInput), additionalProperties: false },
  PrepaymentInput: { ...obj({ ...serviceInput, ...prepaymentInput }), additionalProperties: false },
  PrepaymentPreview: obj({
    version: nonnegative,
    amount: nonnegative,
    mode,
    effectiveDate: date,
    previousBalance: nonnegative,
    balance: nonnegative,
    previousPayment: nonnegative,
    nextPayment: nonnegative,
    previousTermMonths: nonnegative,
    remainingTermMonths: nonnegative,
    interestSaved: integer,
    remainingInterest: nonnegative,
    schedule: array(ref('ServicingPaymentRow')),
    methodVersion: str,
  }),
};

const security = [{ sessionCookie: [] }, { integrationToken: [] }];
const parameter = [
  {
    in: 'path',
    name: 'id',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  },
];
const json = (schema: object) => ({ 'application/json': { schema } });
const errors = {
  '400': { description: 'Проверьте параметры.', content: json(ref('Error')) },
  '401': { description: 'Нет действующей сессии или токена.', content: json(ref('Error')) },
  '403': { description: 'Нет полномочий роли или scope токена.', content: json(ref('Error')) },
  '404': { description: 'Заявка не найдена или недоступна.', content: json(ref('Error')) },
  '409': {
    description: 'Версия устарела, нет исходного снимка или действие недоступно в этом состоянии.',
    content: json(ref('Error')),
  },
};
const read = (summary: string, description: string, schema: string) => ({
  summary,
  description,
  tags: ['Applications'],
  security,
  parameters: parameter,
  responses: {
    '200': {
      description: 'Актуальный расчёт или доступный сохранённый источник; без записи в БД.',
      content: json(ref(schema)),
    },
    ...errors,
  },
});
const mutate = (summary: string, input: string, output: object, preview = false) => ({
  summary,
  description: preview
    ? 'Только клиент своей организации в cookie-сессии. funded, актуальная версия сопровождения. Одно досрочное погашение на границе последнего отмеченного периода; дневные проценты и комиссии не моделируются. Ничего не сохраняет.'
    : 'Только клиент своей организации в cookie-сессии. Требуются confirmed=true, актуальная независимая версия сопровождения и уникальный ключ. Деньги не переводятся. Агрегат, неизменяемое событие и аудит сохраняются атомарно. Точный повтор ключа возвращает прежний результат (200), несовпадающий payload или устаревшая версия — 409. Принятое предложение и статус funded не изменяются.',
  tags: ['Servicing'],
  security: [{ sessionCookie: [] }],
  parameters: parameter,
  requestBody: { required: true, content: json(ref(input)) },
  responses: {
    '200': {
      description: preview ? 'Предпросмотр без записи.' : 'Результат ранее выполненного запроса.',
      content: json(output),
    },
    ...(!preview ? { '201': { description: 'Имитация записана.', content: json(output) } } : {}),
    ...errors,
  },
});

export const V9_PATHS = {
  '/applications/{id}/action-plan': {
    get: read(
      'Следующие действия по заявке',
      'Клиент своей компании или банк с доступом к отправленной заявке. Каждый пункт содержит причину, источник, дату, версию и переход. Не подтверждает подлинность и не меняет финансовые поля.',
      'ApplicationActionPlan',
    ),
  },
  '/bank/applications/{id}/changes': {
    get: read(
      'Банк: изменения после уточнения',
      'Только сотрудник банка. Исторический baseline выбирается по версии, отсутствующий контекст не выдумывается. Сравниваются поля, документы, оценка и сопоставимые отчёты. Расчёт не принимает нового решения.',
      'ApplicationChanges',
    ),
  },
  '/applications/{id}/alternatives': {
    get: read(
      'Сравнить варианты финансирования',
      'Доступная заявка; тот же продукт и цель. Перебираются целые сроки каталога; снижение суммы с шагом 1000 RUB. Сохраняются стоп-факторы, комплект документов, ограничение платежа и пауза приёма. Может быть меньше трёх неповторяющихся вариантов. Новая заявка не создаётся.',
      'FinancingAlternatives',
    ),
  },
  '/applications/{id}/servicing': {
    get: read(
      'График и история сопровождения',
      'Только funded. Клиент своей компании или банк в режиме чтения. Начальный график вычисляется из сохранённого предложения и даты выдачи, без записи. Полностью погашенное сопровождение имеет status=closed; исходная заявка остаётся funded.',
      'ServicingResponse',
    ),
  },
  '/applications/{id}/servicing/payment': {
    post: mutate(
      'Отметить следующий платёж в модели',
      'ServicingPaymentInput',
      ref('ServicingResponse'),
    ),
  },
  '/applications/{id}/servicing/prepayment/preview': {
    post: mutate(
      'Рассчитать досрочное погашение',
      'PrepaymentPreviewInput',
      obj({ preview: ref('PrepaymentPreview') }),
      true,
    ),
  },
  '/applications/{id}/servicing/prepayment': {
    post: mutate(
      'Подтвердить имитацию досрочного погашения',
      'PrepaymentInput',
      ref('ServicingResponse'),
    ),
  },
};
