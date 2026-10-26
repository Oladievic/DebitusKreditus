import type { Hono } from 'hono';
import type {
  AdminOverview,
  AdminProduct,
  AdminRegistryRow,
  AdminUserStatus,
  AuditRecord,
  AuditContext,
  ProductIntake,
  User,
} from '../shared/types.js';
import type { Database } from './db.js';
import type { AppEnv } from './http-types.js';
import { DomainError, now, productById, PRODUCTS } from './domain.js';
import { ACTION_TITLES, auditStatement, auditVersions } from './repository.js';
import { requireVersion } from './security.js';

interface IntakeRow {
  product_id: string;
  paused: number;
  reason: string;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

function intakeView(row: IntakeRow): ProductIntake {
  return {
    productId: row.product_id,
    paused: Boolean(row.paused),
    reason: row.reason,
    version: row.version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function productsWithIntake(db: Database): Promise<AdminProduct[]> {
  const rows = await db.query<IntakeRow>('SELECT * FROM product_intake');
  return PRODUCTS.map((product) => {
    const row = rows.find((item) => item.product_id === product.id);
    return {
      ...product,
      intake: row
        ? intakeView(row)
        : {
            productId: product.id,
            paused: true,
            reason: 'Статус приёма временно недоступен.',
            version: 0,
            updatedAt: '',
            updatedBy: null,
          },
    };
  });
}

function requireAdmin(user: User) {
  if (user.role !== 'admin')
    throw new DomainError('FORBIDDEN', 'Нужна роль администратора платформы.', 403);
}

async function platformOverview(db: Database): Promise<AdminOverview> {
  const at = now();
  const [totals] = await db.query<{
    organizations: number;
    users: number;
    active_sessions: number;
    paused_products: number;
    submitted_amount: number;
    funded_amount: number;
  }>(
    `SELECT (SELECT COUNT(*) FROM organizations) AS organizations,
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM sessions WHERE expires_at>?) AS active_sessions,
      (SELECT COUNT(*) FROM product_intake WHERE paused=1) AS paused_products,
      COALESCE(SUM(CASE WHEN status<>'draft' THEN json_extract(data,'$.amount') ELSE 0 END),0) AS submitted_amount,
      COALESCE(SUM(CASE WHEN status='funded' THEN json_extract(data,'$.decision.offer.amount') ELSE 0 END),0) AS funded_amount
      FROM applications`,
    [at],
  );
  const applicationCounts = await db.query<AdminOverview['applicationCounts'][number]>(
    'SELECT status,COUNT(*) AS count FROM applications GROUP BY status ORDER BY status',
  );
  return {
    generatedAt: at,
    organizations: totals.organizations,
    users: totals.users,
    activeSessions: totals.active_sessions,
    pausedProducts: totals.paused_products,
    submittedAmount: totals.submitted_amount,
    fundedAmount: totals.funded_amount,
    applicationCounts,
  };
}

async function platformRegistry(db: Database): Promise<AdminRegistryRow[]> {
  return db.query<AdminRegistryRow>(`SELECT id, json_extract(data,'$.number') AS number,
    json_extract(data,'$.organizationName') AS organizationName,
    json_extract(data,'$.productId') AS productId, status, json_extract(data,'$.amount') AS amount,
    json_extract(data,'$.termMonths') AS termMonths, created_at AS createdAt, updated_at AS updatedAt
    FROM applications WHERE status<>'draft' ORDER BY created_at DESC,id DESC`);
}

async function platformAudit(db: Database, limit?: number): Promise<AuditRecord[]> {
  const rows = await db.query<Omit<AuditRecord, 'context'> & { context: string | null }>(
    `SELECT id,organization_id AS organizationId,application_id AS applicationId,
    actor_id AS actorId,actor_name AS actorName,action,detail,created_at AS createdAt,context FROM audit
    WHERE application_id IN (SELECT id FROM applications WHERE status<>'draft')
    OR (application_id IS NULL AND action IN ('intake_paused','intake_resumed','platform_export'))
    ORDER BY created_at DESC,id DESC${limit ? ' LIMIT ?' : ''}`,
    limit ? [limit] : [],
  );
  return rows.map(({ context, ...event }) => ({
    ...event,
    detail: event.applicationId
      ? (ACTION_TITLES[event.action] ?? 'Операция по заявке')
      : event.detail,
    ...(context ? { context: auditVersions(JSON.parse(context) as AuditContext) } : {}),
  }));
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const escaped = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${escaped.replaceAll('"', '""')}"`;
}

export function registerAdminRoutes(app: Hono<AppEnv>, db: Database) {
  app.use('/api/admin/*', async (c, next) => {
    requireAdmin(c.get('user'));
    await next();
  });
  app.get('/api/admin/overview', async (c) => c.json(await platformOverview(db)));
  app.get('/api/admin/products', async (c) => c.json({ products: await productsWithIntake(db) }));
  app.get('/api/admin/registry', async (c) => c.json({ applications: await platformRegistry(db) }));
  app.get('/api/admin/audit', async (c) =>
    c.json({ events: await platformAudit(db, 200), limit: 200 }),
  );
  app.get('/api/admin/users', async (c) => {
    const users = await db.query<AdminUserStatus>(
      `SELECT u.id,u.email,u.name,u.role,u.organization_id AS organizationId,
      json_extract(o.data,'$.name') AS organizationName,
      COALESCE(SUM(CASE WHEN s.expires_at>? THEN 1 ELSE 0 END),0) AS activeSessions,
      COALESCE(SUM(CASE WHEN s.expires_at<=? THEN 1 ELSE 0 END),0) AS expiredSessions,
      MAX(s.expires_at) AS latestSessionExpiresAt FROM users u
      LEFT JOIN organizations o ON o.id=u.organization_id LEFT JOIN sessions s ON s.user_id=u.id
      GROUP BY u.id ORDER BY u.role,u.name`,
      [now(), now()],
    );
    return c.json({ users, generatedAt: now() });
  });
  app.patch('/api/admin/products/:id/intake', async (c) => {
    const product = productById(c.req.param('id'));
    const body: unknown = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new DomainError('INVALID_INPUT', 'Передайте параметры изменения приёма.');
    const input = body as Record<string, unknown>;
    if (
      typeof input.paused !== 'boolean' ||
      typeof input.reason !== 'string' ||
      input.reason.trim().length < 5 ||
      input.reason.trim().length > 300
    )
      throw new DomainError(
        'INVALID_INTAKE',
        'Укажите статус и причину изменения от 5 до 300 символов.',
      );
    const version = requireVersion(input.version);
    const paused = input.paused,
      reason = input.reason.trim(),
      user = c.get('user');
    const current = (
      await db.query<IntakeRow>('SELECT * FROM product_intake WHERE product_id=?', [product.id])
    )[0];
    if (!current || current.version !== version)
      throw new DomainError(
        'VERSION_CONFLICT',
        'Статус приёма уже изменился. Обновите данные и проверьте новое состояние.',
        409,
      );
    if (Boolean(current.paused) === paused)
      return c.json({ intake: intakeView(current), unchanged: true });
    const updatedAt = now();
    const results = await db.batch([
      {
        sql: 'UPDATE product_intake SET paused=?,reason=?,version=version+1,updated_at=?,updated_by=? WHERE product_id=? AND version=?',
        params: [paused ? 1 : 0, reason, updatedAt, user.id, product.id, version],
      },
      auditStatement(
        user,
        null,
        paused ? 'intake_paused' : 'intake_resumed',
        `${product.name}: ${reason}`,
        true,
      ),
    ]);
    if (results[0].changes !== 1)
      throw new DomainError(
        'VERSION_CONFLICT',
        'Статус приёма уже изменился. Обновите данные.',
        409,
      );
    return c.json({
      intake: {
        productId: product.id,
        paused,
        reason,
        version: version + 1,
        updatedAt,
        updatedBy: user.id,
      } satisfies ProductIntake,
    });
  });
  app.get('/api/admin/export', async (c) => {
    const kind = c.req.query('kind') ?? 'registry',
      format = c.req.query('format') ?? 'json';
    if (!['registry', 'audit'].includes(kind) || !['json', 'csv'].includes(format))
      throw new DomainError('EXPORT_FORMAT', 'Выберите реестр или аудит в формате JSON либо CSV.');
    const rows = kind === 'registry' ? await platformRegistry(db) : await platformAudit(db);
    await db.batch([
      auditStatement(
        c.get('user'),
        null,
        'platform_export',
        `${kind === 'registry' ? 'Реестр' : 'Журнал'}: ${rows.length} записей, ${format.toUpperCase()}.`,
      ),
    ]);
    c.header('Content-Disposition', `attachment; filename="debitus-platform-${kind}.${format}"`);
    if (format === 'json')
      return c.json({ schemaVersion: 1, moneyUnit: 'RUB_INTEGER', kind, exportedAt: now(), rows });
    const columns =
      kind === 'registry'
        ? [
            'id',
            'number',
            'organizationName',
            'productId',
            'status',
            'amount',
            'termMonths',
            'createdAt',
            'updatedAt',
          ]
        : [
            'id',
            'organizationId',
            'applicationId',
            'actorId',
            'actorName',
            'action',
            'detail',
            'createdAt',
          ];
    c.header('Content-Type', 'text/csv; charset=utf-8');
    return c.body(
      '\uFEFF' +
        [
          columns.map(csvCell).join(';'),
          ...rows.map((row) =>
            columns
              .map((key) => csvCell((row as unknown as Record<string, unknown>)[key]))
              .join(';'),
          ),
        ].join('\r\n'),
    );
  });
}
