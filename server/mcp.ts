import type { Hono } from 'hono';
import type { AppEnv } from './http-types.js';
import type { Database } from './db.js';
import type { User } from '../shared/types.js';
import { calculateScenario, DomainError, productById, validateInput } from './domain.js';
import { getOrganization, listApplications } from './repository.js';
import { getStatementReport } from './statements.js';
import { analyzeFinancingRequest } from './navigator.js';
import { calculateCashflowForOrganization } from './cashflow.js';
import { getFinancingAlternatives } from './alternatives.js';
import { getApplicationActionPlan, getApplicationChanges } from './application-insights.js';
import { getLoanServicing } from './servicing.js';
import { requireProfileOwner } from './profile.js';
import { productsWithIntake } from './admin.js';
import { APP_VERSION } from '../shared/release.js';

export const MCP_VERSIONS = ['2025-11-25', '2025-03-26'] as const;
const emptyInput = { type: 'object', properties: {}, additionalProperties: false };
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const money = { type: 'integer', minimum: 0, maximum: 1000000000 };
export const MCP_TOOLS = [
  ...[
    [
      'get_application_action_plan',
      'Следующие действия по заявке',
      'План действий со ссылками на источники и версии. Не меняет данные и не принимает банковское решение.',
    ],
    [
      'get_financing_alternatives',
      'Сравнить варианты кредита',
      'Детерминированное сравнение суммы и срока того же продукта. Не заменяет сохранённое предложение и не создаёт заявку.',
    ],
    [
      'get_application_changes',
      'Изменения после уточнения',
      'Только для банка: сравнение доступного досье с историческим снимком. Отсутствующие источники обозначаются явно.',
    ],
    [
      'get_loan_servicing',
      'График и история обслуживания',
      'Доступное сопровождение выданной заявки. Чтение не отмечает платежи и не создаёт перевод денег.',
    ],
  ].map(([name, title, description]) => ({
    name,
    title,
    description,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['applicationId'],
      properties: { applicationId: { type: 'string', minLength: 1, maxLength: 128 } },
    },
    annotations,
  })),
  {
    name: 'get_statement_analysis',
    title: 'Сохранённый анализ выписки',
    description:
      'Последний сохранённый отчёт доступной заявки. Проверка доступа такая же, как в кабинете. Не пересчитывает старый отчёт.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['applicationId'],
      properties: { applicationId: { type: 'string', minLength: 1, maxLength: 128 } },
    },
    annotations,
  },
  {
    name: 'analyze_financing_request',
    title: 'Разобрать задачу для кредита',
    description:
      'Разбор короткого запроса по открытым правилам в контексте своей компании. Не создаёт заявку и не запускает модель.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['request'],
      properties: { request: { type: 'string', minLength: 3, maxLength: 500 } },
    },
    annotations,
  },
  {
    name: 'calculate_cashflow',
    title: 'Сравнить остаток с кредитом и без',
    description:
      'Сценарий на 6 или 12 месяцев с явными допущениями, покупкой и аннуитетным графиком. Требует подтверждения допущений, не обещает доход или одобрение.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'productId',
        'amount',
        'termMonths',
        'startingMonth',
        'horizonMonths',
        'openingBalance',
        'monthlyInflow',
        'monthlyOperatingOutflow',
        'monthlyExistingDebtPayment',
        'investmentCost',
        'monthlyAdditionalNetCash',
        'benefitStartMonth',
        'seasonalRevenuePct',
        'assumptionsConfirmed',
      ],
      properties: {
        productId: { type: 'string', enum: ['working_capital', 'equipment', 'credit_line'] },
        amount: { type: 'integer', minimum: 100000, maximum: 30000000 },
        termMonths: { type: 'integer', minimum: 6, maximum: 60 },
        startingMonth: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
        horizonMonths: { type: 'integer', enum: [6, 12] },
        openingBalance: money,
        monthlyInflow: money,
        monthlyOperatingOutflow: money,
        monthlyExistingDebtPayment: money,
        investmentCost: money,
        monthlyAdditionalNetCash: { type: 'integer', minimum: -1000000000, maximum: 1000000000 },
        benefitStartMonth: { type: 'integer', minimum: 1, maximum: 60 },
        seasonalRevenuePct: {
          type: 'array',
          minItems: 12,
          maxItems: 12,
          items: { type: 'integer', minimum: 0, maximum: 300 },
        },
        assumptionsConfirmed: { type: 'boolean', const: true },
      },
    },
    annotations,
  },
  {
    name: 'list_applications',
    title: 'Мои заявки',
    description: 'Список заявок, доступных текущему пользователю. Без содержимого документов.',
    inputSchema: emptyInput,
    annotations,
  },
  {
    name: 'calculate_scenario',
    title: 'Рассчитать платёж',
    description: 'Детерминированный расчёт в целых рублях. Не создаёт и не изменяет заявку.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['productId', 'amount', 'termMonths', 'financials'],
      properties: {
        productId: { type: 'string', enum: ['working_capital', 'equipment', 'credit_line'] },
        amount: { type: 'integer', minimum: 100000, maximum: 30000000 },
        termMonths: { type: 'integer', minimum: 6, maximum: 60 },
        financials: {
          type: 'object',
          additionalProperties: false,
          required: ['monthlyRevenue', 'monthlyExpenses', 'monthlyDebtPayment'],
          properties: { monthlyRevenue: money, monthlyExpenses: money, monthlyDebtPayment: money },
        },
      },
    },
    annotations,
  },
  {
    name: 'get_business_profile',
    title: 'Профиль моего бизнеса',
    description:
      'Сохранённый профиль своей компании и данные, влияющие на подбор. Компания определяется правами пользователя.',
    inputSchema: emptyInput,
    annotations,
  },
  {
    name: 'recommend_products',
    title: 'Подобрать кредитный продукт',
    description:
      'Персональный подбор по сохранённому профилю своей компании с объяснениями и ограничениями. Не является банковским решением.',
    inputSchema: emptyInput,
    annotations,
  },
];

type ObjectValue = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (id: unknown): id is string | number =>
  (typeof id === 'string' && id.length <= 128) ||
  (typeof id === 'number' && Number.isSafeInteger(id));

export interface MCPBusinessTools {
  getBusinessProfile(user: User): Promise<unknown>;
  recommendProducts(user: User): Promise<unknown>;
}

export function registerMCPRoutes(
  app: Hono<AppEnv>,
  db: Database,
  business: MCPBusinessTools,
  allowedOrigins: string[] = [],
) {
  app.use('/api/mcp', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin && !allowedOrigins.includes(origin))
      return c.json(
        { error: { code: 'ORIGIN_DENIED', message: 'Запрос с другого сайта отклонён.' } },
        403,
      );
    const version = c.req.header('mcp-protocol-version');
    if (version && !MCP_VERSIONS.some((supported) => supported === version))
      return c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Неподдерживаемая версия MCP.',
            data: { supported: MCP_VERSIONS },
          },
        },
        400,
      );
    await next();
  });
  app.on(['GET', 'DELETE'], '/api/mcp', (c) => {
    c.header('Allow', 'POST');
    return c.body(null, 405);
  });
  app.post('/api/mcp', async (c) => {
    let id: string | number | null = null;
    const error = (code: number, message: string, status: 400 | 406 | 413 | 415 | 500 = 400) =>
      c.json({ jsonrpc: '2.0', id, error: { code, message } }, status);
    const respond = (result: unknown) => c.json({ jsonrpc: '2.0', id, result });
    const accept = c.req.header('accept');
    if (accept && !accept.includes('application/json') && !accept.includes('*/*'))
      return error(-32600, 'Клиент должен принимать application/json и text/event-stream.', 406);
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json'))
      return error(-32600, 'Ожидается Content-Type: application/json.', 415);
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength > 32 * 1024) return error(-32600, 'Запрос MCP превышает 32 КиБ.', 413);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return error(-32700, 'Не удалось прочитать JSON.');
    }
    if (
      !isObject(body) ||
      body.jsonrpc !== '2.0' ||
      typeof body.method !== 'string' ||
      (Object.hasOwn(body, 'id') && !validId(body.id)) ||
      (body.params !== undefined && !isObject(body.params))
    )
      return error(-32600, 'Некорректный запрос JSON-RPC 2.0.');
    if (validId(body.id)) id = body.id;
    const params = isObject(body.params) ? body.params : {};
    if (!Object.hasOwn(body, 'id')) {
      if (!body.method.startsWith('notifications/'))
        return error(-32600, 'Для метода нужен идентификатор запроса.');
      return c.body(null, 202);
    }
    if (body.method === 'initialize') {
      if (
        typeof params.protocolVersion !== 'string' ||
        !isObject(params.capabilities) ||
        !isObject(params.clientInfo) ||
        typeof params.clientInfo.name !== 'string' ||
        typeof params.clientInfo.version !== 'string'
      )
        return error(-32602, 'Укажите protocolVersion, capabilities и clientInfo.');
      return respond({
        protocolVersion:
          MCP_VERSIONS.find((version) => version === params.protocolVersion) ?? MCP_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'debitus-kreditus', version: APP_VERSION },
        instructions:
          'Только чтение доступных данных и детерминированные расчёты. Данные синтетические. Подключение не запускает LLM. HTTP JSON без SSE, OAuth и серверных сессий.',
      });
    }
    if (body.method === 'ping') return respond({});
    if (body.method === 'tools/list') {
      if (params.cursor !== undefined)
        return error(-32602, 'Список инструментов не использует cursor.');
      return respond({ tools: MCP_TOOLS });
    }
    if (body.method !== 'tools/call') return error(-32601, 'Метод не поддерживается.');
    if (typeof params.name !== 'string' || !MCP_TOOLS.some((tool) => tool.name === params.name))
      return error(-32602, 'Инструмент не найден.');
    const args = params.arguments ?? {};
    if (!isObject(args)) return error(-32602, 'Аргументы инструмента должны быть объектом.');
    try {
      let result: unknown;
      if (
        [
          'get_application_action_plan',
          'get_financing_alternatives',
          'get_application_changes',
          'get_loan_servicing',
        ].includes(params.name)
      ) {
        if (
          Object.keys(args).some((key) => key !== 'applicationId') ||
          typeof args.applicationId !== 'string' ||
          !args.applicationId ||
          args.applicationId.length > 128
        )
          throw new DomainError('INVALID_INPUT', 'Укажите только идентификатор доступной заявки.');
        if (params.name === 'get_application_action_plan')
          result = await getApplicationActionPlan(db, c.get('user'), args.applicationId);
        else if (params.name === 'get_financing_alternatives')
          result = await getFinancingAlternatives(db, c.get('user'), args.applicationId);
        else if (params.name === 'get_application_changes')
          result = await getApplicationChanges(db, c.get('user'), args.applicationId);
        else result = { servicing: await getLoanServicing(db, c.get('user'), args.applicationId) };
      } else if (params.name === 'get_statement_analysis') {
        if (
          Object.keys(args).some((key) => key !== 'applicationId') ||
          typeof args.applicationId !== 'string' ||
          !args.applicationId ||
          args.applicationId.length > 128
        )
          throw new DomainError('INVALID_INPUT', 'Укажите только идентификатор доступной заявки.');
        result = { report: await getStatementReport(db, c.get('user'), args.applicationId) };
      } else if (params.name === 'analyze_financing_request') {
        if (Object.keys(args).some((key) => key !== 'request'))
          throw new DomainError('INVALID_INPUT', 'Передайте только текст задачи.');
        result = analyzeFinancingRequest(
          await getOrganization(db, requireProfileOwner(c.get('user'))),
          args.request,
          await productsWithIntake(db),
        );
      } else if (params.name === 'calculate_cashflow') {
        const allowed = [
          'productId',
          'amount',
          'termMonths',
          'startingMonth',
          'horizonMonths',
          'openingBalance',
          'monthlyInflow',
          'monthlyOperatingOutflow',
          'monthlyExistingDebtPayment',
          'investmentCost',
          'monthlyAdditionalNetCash',
          'benefitStartMonth',
          'seasonalRevenuePct',
          'assumptionsConfirmed',
        ];
        if (Object.keys(args).some((key) => !allowed.includes(key)))
          throw new DomainError(
            'INVALID_INPUT',
            'Расчёт принимает только параметры денежного сценария.',
          );
        result = calculateCashflowForOrganization(
          await getOrganization(db, requireProfileOwner(c.get('user'))),
          args,
        );
      } else if (params.name === 'calculate_scenario') {
        if (
          Object.keys(args).some(
            (key) => !['productId', 'amount', 'termMonths', 'financials'].includes(key),
          ) ||
          (isObject(args.financials) &&
            Object.keys(args.financials).some(
              (key) => !['monthlyRevenue', 'monthlyExpenses', 'monthlyDebtPayment'].includes(key),
            ))
        )
          throw new DomainError(
            'INVALID_INPUT',
            'Расчёт принимает только продукт, сумму, срок и три финансовых показателя.',
          );
        const input = validateInput({ ...args, purpose: 'Расчёт агента', consent: false });
        result = calculateScenario(
          input.amount,
          input.termMonths,
          productById(input.productId).rateBps,
          input.financials,
        );
      } else {
        if (Object.keys(args).length)
          throw new DomainError(
            'INVALID_INPUT',
            'Инструмент использует текущего пользователя и не принимает параметры.',
          );
        if (params.name === 'list_applications')
          result = { applications: await listApplications(db, c.get('user')) };
        else {
          const user = c.get('user');
          if (user.role !== 'client' || !user.organizationId)
            throw new DomainError(
              'FORBIDDEN',
              'Профиль и подбор доступны представителю своей компании.',
              403,
            );
          result =
            params.name === 'get_business_profile'
              ? await business.getBusinessProfile(user)
              : await business.recommendProducts(user);
        }
      }
      return respond({
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      });
    } catch (caught) {
      if (caught instanceof DomainError) {
        const failure = { code: caught.code, message: caught.message };
        return respond({
          content: [{ type: 'text', text: JSON.stringify(failure) }],
          structuredContent: failure,
          isError: true,
        });
      }
      return error(-32603, 'Не удалось выполнить инструмент. Повторите запрос.', 500);
    }
  });
}
