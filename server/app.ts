import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import type {
  Application,
  ApplicationInput,
  FeedItem,
  ImportPreview,
  Preferences,
  User,
} from '../shared/types.js';
import type { Database, SqlStatement } from './db.js';
import {
  assess,
  calculateScenario,
  calculateBudgetScenario,
  DomainError,
  newApplication,
  now,
  productById,
  PRODUCTS,
  uid,
  validateInput,
} from './domain.js';
import { DEMO_ACCOUNTS } from './seed.js';
import { createLoanContract } from './loan-contract.js';
import { APP_VERSION } from '../shared/release.js';
import {
  auditList,
  auditStatement,
  detail,
  documentView,
  getApplication,
  getOrganization,
  insertApplicationStatement,
  listApplications,
  listDocuments,
  saveApplication,
  userView,
  type DocumentRow,
  type UserRow,
} from './repository.js';
import {
  equalHash,
  fromBase64,
  passwordHash,
  randomToken,
  requireVersion,
  safeFilename,
  sha256,
  toBase64,
} from './security.js';
import { OPENAPI } from './openapi.js';
import { documentLabels, normalizeSearch } from '../shared/document-labels.js';
import { documentRequestStatus } from '../shared/document-requests.js';
import type { AppEnv } from './http-types.js';
import { productsWithIntake, registerAdminRoutes } from './admin.js';
import { registerLocalAIRoutes, type LocalAIService } from './local-ai.js';
import { registerOCRRoutes } from './ocr.js';
import { registerStatementRoutes } from './statements.js';
import { registerCashflowRoutes } from './cashflow.js';
import { registerNavigatorRoutes } from './navigator.js';
import { registerAlternativeRoutes } from './alternatives.js';
import { registerApplicationInsightRoutes } from './application-insights.js';
import { getLoanServicing, registerServicingRoutes } from './servicing.js';
import { profileView, registerProfileRoutes, requireProfileOwner } from './profile.js';
import { recommendProducts } from './recommendations.js';
import { registerMCPRoutes } from './mcp.js';

const DEFAULT_PREFERENCES: Preferences = {
  theme: 'light',
  accent: 'red',
  density: 'comfortable',
  reducedMotion: false,
  widgets: ['applications', 'feed', 'actions', 'simulator'],
  interests: ['growth', 'cashflow'],
};
const CATEGORIES = ['statement', 'financials', 'invoice', 'other'];
const MAX_FILE_SIZE = 1024 * 1024;
const MAX_IMPORT_ROWS = 20;
async function readObject(c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, any>> {
  const value = await c.req.json();
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new DomainError('INVALID_JSON_OBJECT', 'Передайте JSON-объект.');
  return value as Record<string, any>;
}
const requireClient = (u: User) => {
  if (u.role !== 'client' || !u.organizationId)
    throw new DomainError('FORBIDDEN', 'Это действие доступно представителю компании.', 403);
};
const requireBank = (u: User) => {
  if (u.role !== 'bank')
    throw new DomainError('FORBIDDEN', 'Нужна роль сотрудника кредитного центра.', 403);
};
const checkVersion = (a: Application, v: unknown) => {
  if (a.version !== requireVersion(v))
    throw new DomainError(
      'VERSION_CONFLICT',
      'Заявка изменилась. Обновите данные перед действием.',
      409,
    );
};
function requireState(a: Application, states: Application['status'][]) {
  if (!states.includes(a.status))
    throw new DomainError(
      'INVALID_TRANSITION',
      'Это действие недоступно на текущем этапе заявки.',
      409,
    );
}
async function getPreferences(db: Database, u: User): Promise<Preferences> {
  const rows = await db.query<{ data: string }>('SELECT data FROM preferences WHERE user_id=?', [
    u.id,
  ]);
  return rows[0]
    ? { ...DEFAULT_PREFERENCES, ...JSON.parse(rows[0].data) }
    : { ...DEFAULT_PREFERENCES };
}
async function personalizedFeed(db: Database, u: User): Promise<FeedItem[]> {
  const applications = await listApplications(db, u),
    preferences = await getPreferences(db, u);
  const org = u.organizationId ? await getOrganization(db, u.organizationId) : null;
  const items: FeedItem[] = [];
  const add = (
    id: string,
    category: string,
    title: string,
    body: string,
    reason: string,
    href: string,
    actionLabel = 'Подробнее',
  ) =>
    items.push({
      id,
      category,
      title,
      body,
      reason,
      href,
      actionLabel,
      publishedAt: '2026-10-19',
      synthetic: true,
    });
  const needs = applications.find((a) => a.status === 'needs_info');
  if (u.role === 'bank') {
    const waiting = applications.filter((a) => ['submitted', 'in_review'].includes(a.status));
    add(
      'bank-queue',
      'Рабочая очередь',
      'Заявки, ожидающие решения',
      `В очереди рассмотрения: ${waiting.length}. Откройте заявку, проверьте сведения и сохраните решение с объяснением.`,
      'По текущим состояниям отправленных заявок',
      '/bank',
      'Открыть очередь',
    );
    if (needs)
      add(
        'bank-supplements',
        'Дополнение сведений',
        'Компания готовит дополнительные документы',
        `По заявке ${needs.number} ожидаются сведения от ${needs.organizationName}. После дополнения заявка вернётся в очередь.`,
        'По запросу сведений банка',
        `/applications/${needs.id}`,
        'Посмотреть заявку',
      );
    add(
      'bank-policy',
      'Правила рассмотрения',
      'Условия продукта и решение проверяются отдельно',
      'Комплект документов, регистрация, кредитная история и денежный поток участвуют в учебной политике. Балл риска не заменяет решение.',
      'Для сотрудника кредитного центра',
      '/products',
      'Посмотреть продукты',
    );
    return items;
  }
  if (needs)
    add(
      'next-document',
      'Следующий шаг',
      'До решения не хватает одного шага',
      'Загрузите запрошенные сведения и верните заявку на рассмотрение. Уже введённые данные сохранятся.',
      `По вашей заявке ${needs.number}`,
      `/applications/${needs.id}`,
      'Дополнить заявку',
    );
  if (org?.scenario === 'overdue')
    add(
      'credit-history',
      'Платёжная дисциплина',
      'Сначала — разобраться с просрочкой',
      'В демонстрационной БКИ есть просрочка 75 дней. Новая заявка её не отменяет: полезно уточнить источник и подготовить план погашения.',
      'По синтетической кредитной истории компании',
      '/simulator',
      'Разобрать ситуацию',
    );
  if (org?.industry.includes('мебели') || preferences.interests.includes('growth'))
    add(
      'equipment-guide',
      'Развитие',
      'Срок кредита должен работать вместе с оборудованием',
      'Сравните платёж на 24 и 36 месяцев. Меньший платёж может увеличить общую сумму процентов — покажем оба значения.',
      org?.industry.includes('мебели')
        ? 'Для производственного бизнеса'
        : 'Вы выбрали интерес «Развитие»',
      '/simulator',
      'Сравнить сценарии',
    );
  if (preferences.interests.includes('cashflow'))
    add(
      'cash-buffer',
      'Денежный поток',
      'Не отдавайте кредиту весь свободный остаток',
      'В модели кабинета платёж ограничен 65% свободного потока после расходов и действующих обязательств. Остаток помогает пережить сезонность.',
      'Вы выбрали интерес «Денежный поток»',
      '/simulator',
      'Проверить нагрузку',
    );
  if (preferences.interests.includes('risk'))
    add(
      'risk-checklist',
      'Риски',
      'Проверьте, что останется после платежа',
      'Снижение выручки меняет запас для обслуживания долга. Проверьте в симуляторе месяц со слабой выручкой и сравните нагрузку до отправки заявки.',
      'Вы выбрали интерес «Риски»',
      '/simulator',
      'Проверить устойчивость',
    );
  if (org?.industry.includes('Кофейни'))
    add(
      'seasonal-guide',
      'Ваш бизнес',
      'Сезонная закупка: проверьте цикл возврата денег',
      'Для запаса кофе и упаковки сравните срок продажи партии со сроком кредита. В калькуляторе можно проверить несколько сумм без отправки заявки.',
      'Для кофеен и пекарен',
      '/products',
      'Выбрать продукт',
    );
  add(
    'demo-rules',
    'Как устроено решение',
    'Почему оценка риска — ещё не решение банка',
    'Баллы описывают риск, а решение учитывает комплект документов, ограничения продукта и доступный денежный поток. Все причины доступны в карточке заявки.',
    'Объяснение прозрачной модели прототипа',
    '/simulator',
  );
  return items.slice(0, 5);
}
export function createApp(
  db: Database,
  options: { allowedOrigins?: string[]; localAI?: LocalAIService } = {},
) {
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const app = new Hono<AppEnv>();
  app.onError((error, c) => {
    if (error instanceof DomainError)
      return new Response(
        JSON.stringify({
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        }),
        { status: error.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
      );
    if (error instanceof SyntaxError)
      return c.json(
        { error: { code: 'INVALID_JSON', message: 'Не удалось прочитать JSON.' } },
        400,
      );
    console.error('Request failed', error instanceof Error ? error.message : 'unknown');
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Не удалось выполнить действие. Попробуйте ещё раз.',
        },
      },
      500,
    );
  });
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_FILE_SIZE + 128 * 1024,
      onError: (c) =>
        c.json(
          { error: { code: 'BODY_TOO_LARGE', message: 'Файл должен быть не больше 1 МБ.' } },
          413,
        ),
    }),
  );
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    const origin = c.req.header('origin');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      origin &&
      origin !== new URL(c.req.url).origin &&
      !allowedOrigins.has(origin)
    )
      throw new DomainError('ORIGIN_DENIED', 'Запрос с другого сайта отклонён.', 403);
    await next();
  });
  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      service: 'Debitus-Kreditus',
      version: APP_VERSION,
      mode: 'synthetic-demo',
      moneyUnit: 'RUB_INTEGER',
      externalCalls: false,
    }),
  );
  app.get('/api/openapi.json', (c) => c.json(OPENAPI));
  app.get('/api/auth/demo-accounts', (c) => c.json({ accounts: DEMO_ACCOUNTS, synthetic: true }));
  const loginAttempts = new Map<string, { count: number; reset: number }>();
  app.post('/api/auth/login', async (c) => {
    const input = await readObject(c);
    const email =
      typeof input.email === 'string' ? input.email.trim().toLowerCase().slice(0, 254) : '';
    const password = typeof input.password === 'string' ? input.password.slice(0, 128) : '';
    const existingAttempt = loginAttempts.get(email);
    if (existingAttempt && existingAttempt.reset > Date.now() && existingAttempt.count >= 15)
      throw new DomainError('RATE_LIMITED', 'Слишком много попыток. Повторите через минуту.', 429);
    const attempt =
      existingAttempt && existingAttempt.reset > Date.now()
        ? existingAttempt
        : { count: 0, reset: Date.now() + 60000 };
    attempt.count++;
    if (loginAttempts.size > 1000) loginAttempts.clear();
    loginAttempts.set(email, attempt);
    const users = await db.query<UserRow>('SELECT * FROM users WHERE email=?', [email]);
    const u = users[0];
    const candidate = await passwordHash(password, u?.password_salt ?? 'missing-user-placeholder');
    if (!u || !equalHash(u.password_hash, candidate))
      throw new DomainError('INVALID_CREDENTIALS', 'Неверная почта или пароль.', 401);
    loginAttempts.delete(email);
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 12 * 3600000).toISOString();
    const oldToken = getCookie(c, 'dk_session');
    if (oldToken) await db.run('DELETE FROM sessions WHERE id=?', [await sha256(oldToken)]);
    await db.run('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)', [
      await sha256(token),
      u.id,
      expiresAt,
    ]);
    setCookie(c, 'dk_session', token, {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === 'https:',
      sameSite: 'Strict',
      path: '/',
      maxAge: 43200,
    });
    return c.json({
      user: userView(u),
      organization: u.organization_id ? await getOrganization(db, u.organization_id) : null,
    });
  });
  app.use('/api/*', async (c, next) => {
    const bearer = c.req.header('authorization');
    let row: UserRow | undefined;
    let sessionHash: string | null = null;
    let tokenAuth = false;
    if (bearer?.startsWith('Bearer ')) {
      const id = await sha256(bearer.slice(7));
      const rows = await db.query<UserRow>(
        'SELECT u.* FROM integration_tokens t JOIN users u ON u.id=t.user_id WHERE t.id=? AND t.revoked_at IS NULL AND t.expires_at>?',
        [id, now()],
      );
      row = rows[0];
      tokenAuth = true;
      const permitted =
        (c.req.method === 'GET' && /^\/api\/(products|applications)(\/[^/]+)?$/.test(c.req.path)) ||
        (c.req.method === 'GET' &&
          ['/api/business-profile', '/api/recommendations'].includes(c.req.path)) ||
        (c.req.method === 'GET' &&
          /^\/api\/applications\/[^/]+\/(statement|action-plan|alternatives|servicing)$/.test(
            c.req.path,
          )) ||
        (c.req.method === 'GET' &&
          /^\/api\/bank\/applications\/[^/]+\/changes$/.test(c.req.path)) ||
        (c.req.method === 'POST' && c.req.path === '/api/scenario') ||
        (c.req.method === 'POST' &&
          ['/api/scenario/cashflow', '/api/navigator/analyze'].includes(c.req.path)) ||
        (['GET', 'POST', 'DELETE'].includes(c.req.method) && c.req.path === '/api/mcp');
      if (!permitted)
        throw new DomainError(
          'TOKEN_SCOPE_DENIED',
          'Токен разрешает только чтение своего профиля, заявок, продуктов, рекомендаций и расчёты.',
          403,
        );
    } else {
      const token = getCookie(c, 'dk_session');
      if (token) {
        sessionHash = await sha256(token);
        row = (
          await db.query<UserRow>(
            'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?',
            [sessionHash, now()],
          )
        )[0];
      }
    }
    if (!row) throw new DomainError('UNAUTHORIZED', 'Войдите в демонстрационный кабинет.', 401);
    c.set('user', userView(row));
    c.set('tokenAuth', tokenAuth);
    c.set('sessionHash', sessionHash);
    if (
      row.role === 'admin' &&
      !c.req.path.startsWith('/api/admin/') &&
      ![
        '/api/auth/me',
        '/api/auth/logout',
        '/api/preferences',
        '/api/products',
        '/api/local-ai/status',
      ].includes(c.req.path)
    )
      throw new DomainError(
        'FORBIDDEN',
        'Администратор управляет платформой; кредитные действия доступны компании и банку.',
        403,
      );
    await next();
  });
  registerAdminRoutes(app, db);
  registerLocalAIRoutes(app, db, options.localAI);
  registerOCRRoutes(app, db);
  registerStatementRoutes(app, db);
  registerCashflowRoutes(app, db);
  registerNavigatorRoutes(app, db);
  registerAlternativeRoutes(app, db);
  registerApplicationInsightRoutes(app, db);
  registerServicingRoutes(app, db);
  registerProfileRoutes(app, db);
  app.get('/api/auth/me', async (c) => {
    const u = c.get('user');
    return c.json({
      user: u,
      organization: u.organizationId ? await getOrganization(db, u.organizationId) : null,
    });
  });
  app.post('/api/auth/logout', async (c) => {
    const hash = c.get('sessionHash');
    if (hash) await db.run('DELETE FROM sessions WHERE id=?', [hash]);
    deleteCookie(c, 'dk_session', { path: '/' });
    return c.json({ ok: true });
  });
  app.get('/api/products', async (c) => c.json({ products: await productsWithIntake(db) }));
  app.get('/api/applications', async (c) =>
    c.json({ applications: await listApplications(db, c.get('user')) }),
  );
  app.post('/api/applications', async (c) => {
    const u = c.get('user');
    requireClient(u);
    const input = validateInput(await readObject(c));
    const a = newApplication(input, await getOrganization(db, u.organizationId!));
    await db.batch([
      insertApplicationStatement(a),
      auditStatement(u, a, 'created', 'Создан черновик заявки.'),
    ]);
    return c.json({ application: a }, 201);
  });
  app.get('/api/applications/:id', async (c) =>
    c.json(await detail(db, c.req.param('id'), c.get('user'))),
  );
  app.patch('/api/applications/:id', async (c) => {
    const u = c.get('user');
    requireClient(u);
    const body = await readObject(c);
    const a = await getApplication(db, c.req.param('id'), u);
    checkVersion(a, body.version);
    requireState(a, ['draft', 'needs_info']);
    const input = validateInput({ ...a, ...body });
    const next = { ...a, ...input };
    await saveApplication(
      db,
      a,
      next,
      u,
      'draft_updated',
      'Параметры и финансовые показатели сохранены.',
    );
    return c.json({ application: next });
  });
  app.post('/api/applications/:id/actions/:action', async (c) => {
    const u = c.get('user');
    requireClient(u);
    const a = await getApplication(db, c.req.param('id'), u);
    const action = c.req.param('action');
    const body = await readObject(c);
    if (
      (action === 'sign' && ['signed', 'funded'].includes(a.status)) ||
      (action === 'fund' && a.status === 'funded')
    )
      return c.json(await detail(db, a.id, u));
    checkVersion(a, body.version);
    const next = { ...a };
    let event = '';
    let message = '';
    const extra: SqlStatement[] = [];
    if (action === 'submit' || action === 'supplement') {
      requireState(a, action === 'submit' ? ['draft'] : ['needs_info']);
      if (!a.consent)
        throw new DomainError(
          'CONSENT_REQUIRED',
          'Подтвердите демонстрационную проверку данных перед отправкой.',
        );
      if (action === 'supplement') {
        const docs = await listDocuments(db, u, a.id);
        const request = documentRequestStatus(a.decision, docs);
        const missing = request.categories
          .filter((category) => !category.satisfied)
          .map((category) => category.category);
        if (missing.length)
          throw new DomainError(
            'DOCUMENTS_REQUIRED',
            'Добавьте новый файл в каждую запрошенную категорию. Прежние вложения не закрывают этот запрос.',
            400,
            { missing, requestId: request.requestId, mode: request.mode },
          );
      }
      next.status = 'submitted';
      next.submittedAt = now();
      next.organizationSnapshot = await getOrganization(db, a.organizationId);
      next.organizationSnapshotMeta = {
        source: 'submission',
        capturedAt: next.submittedAt,
        profileVersion: next.organizationSnapshot.profile?.version ?? 1,
      };
      next.score = null;
      next.checks = [];
      next.decision = null;
      event = action === 'submit' ? 'submitted' : 'supplemented';
      message =
        action === 'submit'
          ? 'Заявка поступила в очередь кредитного центра.'
          : 'Сведения дополнены, заявка возвращена на рассмотрение.';
    } else if (action === 'accept-offer') {
      requireState(a, ['approved', 'counter_offer']);
      if (!a.decision?.offer)
        throw new DomainError('OFFER_MISSING', 'Предложение условий не найдено.', 409);
      next.status = 'accepted';
      event = 'accepted';
      message = 'Клиент принял предложенные сумму, срок и ставку.';
      const offer = a.decision.offer;
      const bytes = new TextEncoder().encode(createLoanContract(a, offer));
      extra.push({
        sql: 'INSERT INTO documents(id,application_id,organization_id,name,category,mime_type,size,sha256,content,synthetic,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1',
        params: [
          uid('doc'),
          a.id,
          a.organizationId,
          `Договор-${a.number}.txt`,
          'contract',
          'text/plain',
          bytes.length,
          await sha256(bytes),
          toBase64(bytes),
          1,
          now(),
        ],
      });
    } else if (action === 'sign') {
      requireState(a, ['accepted']);
      if (body.confirmed !== true)
        throw new DomainError(
          'CONFIRMATION_REQUIRED',
          'Подтвердите ознакомление с демонстрационным договором.',
        );
      next.status = 'signed';
      next.signedAt = now();
      event = 'signed';
      message = 'Подписание смоделировано. Юридическая электронная подпись не создаётся.';
      extra.push({
        sql: 'INSERT INTO action_receipts(application_id,action,created_at) SELECT ?,?,? WHERE changes()=1',
        params: [a.id, 'sign', next.signedAt],
      });
    } else if (action === 'fund') {
      requireState(a, ['signed']);
      if (body.confirmed !== true)
        throw new DomainError('CONFIRMATION_REQUIRED', 'Подтвердите запуск симуляции выдачи.');
      next.status = 'funded';
      next.fundedAt = now();
      event = 'funded';
      message = 'Деньги условно зачислены на демонстрационный счёт. Реального перевода нет.';
      extra.push({
        sql: 'INSERT INTO action_receipts(application_id,action,created_at) SELECT ?,?,? WHERE changes()=1',
        params: [a.id, 'fund', next.fundedAt],
      });
    } else throw new DomainError('ACTION_NOT_FOUND', 'Действие не найдено.', 404);
    await saveApplication(db, a, next, u, event, message, extra, action === 'submit');
    return c.json(await detail(db, a.id, u));
  });
  app.get('/api/bank/queue', async (c) => {
    requireBank(c.get('user'));
    return c.json({
      applications: (await listApplications(db, c.get('user'))).filter((a) => a.status !== 'draft'),
    });
  });
  app.post('/api/bank/applications/:id/review', async (c) => {
    const u = c.get('user');
    requireBank(u);
    const body = await readObject(c);
    const a = await getApplication(db, c.req.param('id'), u);
    checkVersion(a, body.version);
    requireState(a, ['submitted']);
    const evaluated = assess(
      a,
      await getOrganization(db, a.organizationId),
      await listDocuments(db, u, a.id),
      u.id,
    );
    const next = {
      ...a,
      status: 'in_review' as const,
      score: evaluated.score,
      checks: evaluated.checks,
    };
    await saveApplication(
      db,
      a,
      next,
      u,
      'review_started',
      'Выполнены локальные симуляции ФНС, БКИ и проверка комплекта.',
    );
    return c.json(await detail(db, a.id, u));
  });
  app.post('/api/bank/applications/:id/decision', async (c) => {
    const u = c.get('user');
    requireBank(u);
    const body = await readObject(c);
    const a = await getApplication(db, c.req.param('id'), u);
    checkVersion(a, body.version);
    requireState(a, ['in_review']);
    const decisionDocuments = await listDocuments(db, u, a.id);
    const evaluated = assess(
      a,
      await getOrganization(db, a.organizationId),
      decisionDocuments,
      u.id,
    );
    if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 1000))
      throw new DomainError(
        'INVALID_COMMENT',
        'Комментарий должен содержать не более 1000 символов.',
      );
    const comment = typeof body.reason === 'string' ? body.reason.trim() : '';
    const customRequest = body.outcome === 'needs_info' && body.requestedDocuments !== undefined;
    if (body.outcome && body.outcome !== evaluated.decision.outcome && !customRequest)
      throw new DomainError(
        'POLICY_MISMATCH',
        'Решение должно соответствовать правилам. Для запроса сведений выберите документы и укажите причину.',
      );
    if (customRequest) {
      if (
        comment.length < 5 ||
        !Array.isArray(body.requestedDocuments) ||
        !body.requestedDocuments.length ||
        body.requestedDocuments.some(
          (d: unknown) => typeof d !== 'string' || !CATEGORIES.includes(d),
        )
      )
        throw new DomainError(
          'INVALID_INFORMATION_REQUEST',
          'Выберите категории документов и укажите причину длиной от пяти символов.',
        );
      const required =
        evaluated.decision.outcome === 'needs_info' ? evaluated.decision.requestedDocuments : [];
      evaluated.decision = {
        ...evaluated.decision,
        outcome: 'needs_info',
        reasons: [comment],
        requestedDocuments: [...new Set<string>([...required, ...body.requestedDocuments])],
        offer: null,
      };
    } else if (comment)
      evaluated.decision.reasons = [
        ...evaluated.decision.reasons,
        `Комментарий сотрудника: ${comment}`,
      ];
    if (evaluated.decision.outcome === 'needs_info')
      evaluated.decision.documentRequest = {
        id: uid('document_request'),
        requestedAt: evaluated.decision.decidedAt,
        baselineDocumentIds: decisionDocuments.map((document) => document.id),
        categories: [...evaluated.decision.requestedDocuments],
        methodVersion: 'document-id-baseline-v1',
      };
    const next = {
      ...a,
      status: evaluated.decision.outcome,
      score: evaluated.score,
      checks: evaluated.checks,
      decision: evaluated.decision,
    };
    await saveApplication(db, a, next, u, next.status, evaluated.decision.reasons.join(' '));
    return c.json(await detail(db, a.id, u));
  });
  app.get('/api/documents', async (c) =>
    c.json({ documents: await listDocuments(db, c.get('user')) }),
  );
  async function attachDocument(
    u: User,
    id: string,
    name: string,
    category: string,
    mimeType: string,
    bytes: Uint8Array,
    synthetic: boolean,
  ) {
    requireClient(u);
    if (!CATEGORIES.includes(category))
      throw new DomainError('INVALID_CATEGORY', 'Выберите категорию документа.');
    if (!bytes.length || bytes.length > MAX_FILE_SIZE)
      throw new DomainError('FILE_SIZE', 'Допустимый размер документа: от 1 байта до 1 МБ.', 413);
    const a = await getApplication(db, id, u);
    requireState(a, ['draft', 'needs_info']);
    if ((await listDocuments(db, u, id)).length >= 20)
      throw new DomainError('DOCUMENT_LIMIT', 'Для одной заявки допускается до 20 документов.');
    const row: DocumentRow = {
      id: uid('doc'),
      application_id: id,
      organization_id: a.organizationId,
      name: safeFilename(name),
      category,
      mime_type: mimeType,
      size: bytes.length,
      sha256: await sha256(bytes),
      content: toBase64(bytes),
      synthetic: synthetic ? 1 : 0,
      created_at: now(),
    };
    const next = { ...a };
    await saveApplication(
      db,
      a,
      next,
      u,
      'document_added',
      `${synthetic ? 'Синтетический пример' : 'Загруженный файл'}: ${row.name}`,
      [
        {
          sql: 'INSERT INTO documents(id,application_id,organization_id,name,category,mime_type,size,sha256,content,synthetic,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1',
          params: [
            row.id,
            row.application_id,
            row.organization_id,
            row.name,
            row.category,
            row.mime_type,
            row.size,
            row.sha256,
            row.content,
            row.synthetic,
            row.created_at,
          ],
        },
      ],
    );
    return documentView(row);
  }
  app.post('/api/applications/:id/documents/sample', async (c) => {
    const body = await readObject(c);
    const u = c.get('user');
    requireClient(u);
    const org = await getOrganization(db, u.organizationId!);
    const category = String(body.category ?? '');
    const bytes = new TextEncoder().encode(
      `СИНТЕТИЧЕСКИЙ ПРИМЕР\n${org.name}\nКатегория: ${category}\nВыручка: ${org.monthlyRevenue} RUB\nРасходы: ${org.monthlyExpenses} RUB\nЭтот файл создан для проверки прототипа, не подтверждает реальные сведения.\n`,
    );
    return c.json(
      {
        document: await attachDocument(
          u,
          c.req.param('id'),
          `${category}-demo.txt`,
          category,
          'text/plain',
          bytes,
          true,
        ),
      },
      201,
    );
  });
  app.post('/api/applications/:id/documents', async (c) => {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new DomainError('FILE_REQUIRED', 'Выберите файл.');
    if (file.size > MAX_FILE_SIZE)
      throw new DomainError('FILE_SIZE', 'Размер файла превышает 1 МБ.', 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = file.name.split('.').pop()?.toLowerCase();
    let mime = '';
    if (extension === 'pdf' && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-')
      mime = 'application/pdf';
    else if (extension === 'png' && bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10')
      mime = 'image/png';
    else if (
      ['jpg', 'jpeg'].includes(extension ?? '') &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    )
      mime = 'image/jpeg';
    else if (['txt', 'csv'].includes(extension ?? '')) {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (text.includes('\0') || /<(script|html|svg|iframe)\b/i.test(text)) throw new Error();
        mime = extension === 'csv' ? 'text/csv' : 'text/plain';
      } catch {
        throw new DomainError('UNSAFE_FILE', 'Нужен текст UTF-8 без исполняемого HTML.');
      }
    }
    if (!mime)
      throw new DomainError(
        'UNSUPPORTED_FILE',
        'Разрешены PDF, PNG, JPEG, TXT и CSV с соответствующим содержимым.',
      );
    return c.json(
      {
        document: await attachDocument(
          c.get('user'),
          c.req.param('id'),
          file.name,
          String(form.get('category') ?? ''),
          mime,
          bytes,
          false,
        ),
      },
      201,
    );
  });
  app.get('/api/documents/:id/download', async (c) => {
    const u = c.get('user');
    const row = (
      await db.query<DocumentRow>(
        `SELECT * FROM documents WHERE id=?${u.role === 'client' ? ' AND organization_id=?' : ''}`,
        u.role === 'client' ? [c.req.param('id'), u.organizationId] : [c.req.param('id')],
      )
    )[0];
    if (!row) throw new DomainError('NOT_FOUND', 'Документ не найден.', 404);
    await getApplication(db, row.application_id, u);
    c.header('Content-Type', row.mime_type);
    c.header(
      'Content-Disposition',
      `attachment; filename="document.${row.name.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    );
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return c.body(fromBase64(row.content));
  });
  app.post('/api/scenario', async (c) => {
    const body = await readObject(c);
    const p = productById(String(body.productId ?? 'working_capital'));
    const input = validateInput({
      ...body,
      purpose: 'Проверка сценария',
      consent: false,
      productId: p.id,
    });
    return c.json(calculateScenario(input.amount, input.termMonths, p.rateBps, input.financials));
  });
  app.post('/api/scenario/affordability', async (c) =>
    c.json(calculateBudgetScenario(await readObject(c))),
  );
  app.get('/api/preferences', async (c) => c.json(await getPreferences(db, c.get('user'))));
  app.patch('/api/preferences', async (c) => {
    const u = c.get('user'),
      current = await getPreferences(db, u),
      body = await readObject(c);
    if (body.expectedUserId !== undefined && body.expectedUserId !== u.id)
      throw new DomainError(
        'PREFERENCES_USER_CHANGED',
        'Учётная запись изменилась. Обновите страницу перед изменением настроек.',
        403,
      );
    const next: Preferences = {
      theme: body.theme ?? current.theme,
      accent: body.accent ?? current.accent,
      density: body.density ?? current.density,
      reducedMotion: body.reducedMotion ?? current.reducedMotion,
      widgets: body.widgets ?? current.widgets,
      interests: body.interests ?? current.interests,
    };
    if (
      !['light', 'dark'].includes(next.theme) ||
      !['red', 'mint', 'violet', 'amber'].includes(next.accent) ||
      !['comfortable', 'compact'].includes(next.density) ||
      typeof next.reducedMotion !== 'boolean' ||
      !Array.isArray(next.widgets) ||
      next.widgets.length > 8 ||
      next.widgets.some(
        (x) => !['applications', 'feed', 'actions', 'products', 'stats', 'simulator'].includes(x),
      ) ||
      !Array.isArray(next.interests) ||
      next.interests.length > 8 ||
      next.interests.some(
        (x) => !['growth', 'cashflow', 'equipment', 'documents', 'risk'].includes(x),
      )
    )
      throw new DomainError('INVALID_PREFERENCES', 'Проверьте выбранные настройки.');
    await db.run(
      'INSERT INTO preferences(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',
      [u.id, JSON.stringify(next)],
    );
    return c.json(next);
  });
  app.get('/api/feed', async (c) => c.json({ items: await personalizedFeed(db, c.get('user')) }));
  app.get('/api/dashboard', async (c) => {
    const u = c.get('user'),
      applications = await listApplications(db, u);
    const funded = applications.filter((a) => a.status === 'funded');
    const servicing = await Promise.all(funded.map((a) => getLoanServicing(db, u, a.id)));
    return c.json({
      organization: u.organizationId ? await getOrganization(db, u.organizationId) : null,
      stats: {
        activeApplications: applications.filter((a) => !['declined', 'funded'].includes(a.status))
          .length,
        requestedAmount: applications
          .filter((a) => a.status !== 'declined')
          .reduce((s, a) => s + a.amount, 0),
        fundedAmount: funded.reduce((s, a) => s + (a.decision?.offer?.amount ?? 0), 0),
        nextPayment: servicing.reduce((s, loan) => s + (loan.nextPayment?.payment ?? 0), 0),
      },
      applications,
      products: await productsWithIntake(db),
      feed: await personalizedFeed(db, u),
      actions:
        u.role === 'bank'
          ? applications
              .filter((a) => ['submitted', 'in_review'].includes(a.status))
              .map((a) => ({
                title:
                  a.status === 'submitted' ? 'Проверьте новую заявку' : 'Примите решение по заявке',
                description: `${a.number} · ${a.organizationName}`,
                href: `/applications/${a.id}`,
                priority: 'normal',
              }))
          : applications
              .filter((a) =>
                [
                  'draft',
                  'needs_info',
                  'approved',
                  'counter_offer',
                  'accepted',
                  'signed',
                  'funded',
                ].includes(a.status),
              )
              .map((a) => ({
                title:
                  a.status === 'funded'
                    ? 'Открыть график и историю платежей'
                    : a.status === 'needs_info'
                      ? 'Дополните сведения'
                      : a.status === 'draft'
                        ? 'Продолжите заявку'
                        : a.status === 'signed'
                          ? 'Смоделируйте выдачу'
                          : 'Следующий шаг по заявке',
                description: `${a.number} · ${a.purpose}`,
                href: `/applications/${a.id}${a.status === 'funded' ? '#application-servicing' : '#application-action-plan'}`,
                priority: a.status === 'needs_info' ? 'high' : 'normal',
              })),
    });
  });
  app.get('/api/search', async (c) => {
    const u = c.get('user');
    const q = normalizeSearch(c.req.query('q') ?? '').slice(0, 100);
    if (q.length < 2) return c.json({ results: [] });
    const apps = await listApplications(db, u),
      docs = await listDocuments(db, u);
    const results = [
      ...apps
        .filter((a) =>
          normalizeSearch(`${a.number} ${a.purpose} ${a.organizationName}`).includes(q),
        )
        .map((a) => ({
          id: a.id,
          type: 'application',
          title: a.number,
          description: a.purpose,
          href: `/applications/${a.id}`,
        })),
      ...PRODUCTS.filter((p) => normalizeSearch(`${p.name} ${p.description}`).includes(q)).map(
        (p) => ({
          id: p.id,
          type: 'product',
          title: p.name,
          description: p.subtitle,
          href: `/products?product=${p.id}`,
        }),
      ),
      ...docs
        .filter((d) =>
          normalizeSearch(`${d.name} ${d.category} ${documentLabels[d.category] ?? ''}`).includes(
            q,
          ),
        )
        .map((d) => ({
          id: d.id,
          type: 'document',
          title: d.name,
          description: documentLabels[d.category] ?? 'Документ заявки',
          href: `/applications/${d.applicationId}`,
        })),
    ];
    return c.json({ results: results.slice(0, 30) });
  });
  app.get('/api/audit', async (c) => c.json({ events: await auditList(db, c.get('user')) }));
  app.get('/api/export', async (c) => {
    const u = c.get('user');
    requireClient(u);
    const applications = await listApplications(db, u);
    const format = c.req.query('format') ?? 'json';
    if (!['json', 'csv'].includes(format))
      throw new DomainError('EXPORT_FORMAT', 'Доступны JSON и CSV.');
    await db.batch([
      auditStatement(
        u,
        null,
        'export_created',
        `Экспорт ${format}; ${applications.length} заявок.`,
      ),
    ]);
    if (format === 'json') {
      c.header('Content-Disposition', 'attachment; filename="debitus-export.json"');
      return c.json({
        schemaVersion: '1',
        exportedAt: now(),
        synthetic: true,
        moneyUnit: 'RUB_INTEGER',
        organization: await getOrganization(db, u.organizationId!),
        applications,
        documents: await listDocuments(db, u),
      });
    }
    const cell = (v: unknown) => {
      let text = String(v ?? '');
      if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const csv = [
      ['Номер', 'Цель', 'Сумма RUB', 'Срок', 'Статус'],
      ...applications.map((a) => [a.number, a.purpose, a.amount, a.termMonths, a.status]),
    ]
      .map((row) => row.map(cell).join(';'))
      .join('\r\n');
    c.header('Content-Disposition', 'attachment; filename="debitus-export.csv"');
    c.header('Content-Type', 'text/csv; charset=utf-8');
    return c.body('\ufeff' + csv);
  });
  app.post('/api/import/validate', async (c) => {
    const u = c.get('user');
    requireClient(u);
    const body = await readObject(c);
    if (
      !Array.isArray(body.applications) ||
      body.applications.length < 1 ||
      body.applications.length > MAX_IMPORT_ROWS
    )
      throw new DomainError('IMPORT_SIZE', 'Передайте от 1 до 20 заявок в поле applications.');
    const rows: ApplicationInput[] = [],
      errors: ImportPreview['errors'] = [];
    body.applications.forEach((x: unknown, i: number) => {
      try {
        rows.push(validateInput(x));
      } catch (e) {
        errors.push({
          row: i + 1,
          field: 'application',
          message: e instanceof Error ? e.message : 'Некорректные данные',
        });
      }
    });
    const preview: ImportPreview = {
      previewId: uid('import'),
      valid: !errors.length,
      count: body.applications.length,
      rows,
      errors,
      expiresAt: new Date(Date.now() + 1800000).toISOString(),
    };
    if (preview.valid)
      await db.run(
        'INSERT INTO import_previews(id,organization_id,user_id,data,expires_at) VALUES(?,?,?,?,?)',
        [preview.previewId, u.organizationId, u.id, JSON.stringify(rows), preview.expiresAt],
      );
    return c.json(preview);
  });
  app.post('/api/import/apply', async (c) => {
    const u = c.get('user');
    requireClient(u);
    const body = await readObject(c);
    const preview = (
      await db.query<{ id: string; data: string; expires_at: string; applied_at: string | null }>(
        'SELECT * FROM import_previews WHERE id=? AND organization_id=? AND user_id=?',
        [String(body.previewId ?? ''), u.organizationId, u.id],
      )
    )[0];
    if (!preview) throw new DomainError('NOT_FOUND', 'Предпросмотр импорта не найден.', 404);
    if (preview.applied_at)
      return c.json({
        applications: (await listApplications(db, u)).filter((a) => a.id.startsWith(preview.id)),
        alreadyApplied: true,
      });
    if (preview.expires_at < now())
      throw new DomainError(
        'PREVIEW_EXPIRED',
        'Предпросмотр устарел. Проверьте файл повторно.',
        409,
      );
    const rows: ApplicationInput[] = JSON.parse(preview.data);
    const org = await getOrganization(db, u.organizationId!);
    const applications = rows.map((row, i) => newApplication(row, org, `${preview.id}_${i}`));
    const marker = uid('commit');
    const statements: SqlStatement[] = [
      {
        sql: 'UPDATE import_previews SET applied_at=? WHERE id=? AND applied_at IS NULL',
        params: [marker, preview.id],
      },
    ];
    for (const a of applications) {
      statements.push(
        {
          sql: 'INSERT INTO applications(id,organization_id,status,version,data,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM import_previews WHERE id=? AND applied_at=?)',
          params: [
            a.id,
            a.organizationId,
            a.status,
            a.version,
            JSON.stringify(a),
            a.createdAt,
            a.updatedAt,
            preview.id,
            marker,
          ],
        },
        auditStatement(u, a, 'imported', 'Черновик создан из подтверждённого JSON-импорта.', true),
      );
    }
    const result = await db.batch(statements);
    if (!result[0].changes)
      return c.json({
        applications: (await listApplications(db, u)).filter((a) => a.id.startsWith(preview.id)),
        alreadyApplied: true,
      });
    return c.json({ applications, alreadyApplied: false }, 201);
  });
  app.get('/api/integrations/tokens', async (c) => {
    const u = c.get('user');
    requireClient(u);
    const tokens = await db.query(
      'SELECT id,name,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt FROM integration_tokens WHERE user_id=? ORDER BY created_at DESC',
      [u.id],
    );
    return c.json({ tokens });
  });
  app.post('/api/integrations/tokens', async (c) => {
    const u = c.get('user');
    requireClient(u);
    const body = await readObject(c);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : 'Личный агент';
    if (!name) throw new DomainError('INVALID_NAME', 'Укажите имя подключения.');
    const active = await db.query(
      'SELECT id FROM integration_tokens WHERE user_id=? AND revoked_at IS NULL AND expires_at>?',
      [u.id, now()],
    );
    if (active.length >= 5)
      throw new DomainError('TOKEN_LIMIT', 'Сначала отзовите один из пяти активных токенов.');
    const token = `dk_${randomToken()}`,
      id = await sha256(token),
      expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    await db.batch([
      {
        sql: 'INSERT INTO integration_tokens(id,user_id,name,created_at,expires_at) VALUES(?,?,?,?,?)',
        params: [id, u.id, name, now(), expiresAt],
      },
      auditStatement(
        u,
        null,
        'integration_created',
        `Создан токен только чтения и расчётов: ${name}.`,
      ),
    ]);
    return c.json({ token, id, expiresAt, scopes: ['portfolio:read', 'scenarios:calculate'] }, 201);
  });
  app.delete('/api/integrations/tokens/:id', async (c) => {
    const u = c.get('user');
    requireClient(u);
    const result = await db.run(
      'UPDATE integration_tokens SET revoked_at=? WHERE id=? AND user_id=?',
      [now(), c.req.param('id'), u.id],
    );
    if (!result.changes) throw new DomainError('NOT_FOUND', 'Подключение не найдено.', 404);
    await db.batch([auditStatement(u, null, 'integration_revoked', 'Токен агента отозван.')]);
    return c.json({ ok: true });
  });
  registerMCPRoutes(
    app,
    db,
    {
      getBusinessProfile: async (user) =>
        profileView(await getOrganization(db, requireProfileOwner(user))),
      recommendProducts: async (user) =>
        recommendProducts(
          await getOrganization(db, requireProfileOwner(user)),
          await productsWithIntake(db),
        ),
    },
    [...allowedOrigins],
  );
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Маршрут не найден.' } }, 404));
  return app;
}
