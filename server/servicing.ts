import type { Hono } from 'hono';
import type { AppEnv } from './http-types.js';
import type { Database } from './db.js';
import type { Application, User } from '../shared/types.js';
import { DomainError, now, uid } from './domain.js';
import { auditStatement, getApplication } from './repository.js';
import { sha256 } from './security.js';
import {
  initialServicing,
  previewPrepayment,
  recordPrepayment,
  recordScheduledPayment,
  ServicingError,
  type LoanServicingState,
  type PrepaymentMode,
} from '../shared/servicing.js';

interface StoredRequest {
  request_hash: string;
  response: string;
}
function convertError(error: unknown): never {
  if (error instanceof ServicingError)
    throw new DomainError('INVALID_SERVICING', error.message, 409);
  throw error;
}
async function stateFor(db: Database, application: Application): Promise<LoanServicingState> {
  if (application.status !== 'funded')
    throw new DomainError(
      'SERVICING_NOT_FUNDED',
      'Сопровождение доступно после смоделированной выдачи кредита.',
      409,
    );
  const rows = await db.query<{ data: string }>(
    'SELECT data FROM loan_servicing WHERE application_id=? AND organization_id=?',
    [application.id, application.organizationId],
  );
  if (rows[0]) return JSON.parse(rows[0].data) as LoanServicingState;
  try {
    return initialServicing(application);
  } catch (error) {
    convertError(error);
  }
}
export async function getLoanServicing(
  db: Database,
  user: User,
  applicationId: string,
): Promise<LoanServicingState> {
  return stateFor(db, await getApplication(db, applicationId, user));
}
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new DomainError(
      'VERSION_REQUIRED',
      'Обновите сопровождение и передайте его текущую версию.',
      409,
    );
  return value;
}
async function readBody(
  c: { req: { json: () => Promise<unknown> } },
  kind: 'payment' | 'prepayment',
  preview = false,
) {
  const value = await c.req.json();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DomainError('INVALID_INPUT', 'Передайте параметры операции.');
  const body = value as Record<string, unknown>;
  const keys = [
    'version',
    ...(kind === 'prepayment' ? ['amount', 'mode'] : []),
    ...(!preview ? ['idempotencyKey', 'confirmed'] : []),
  ];
  if (Object.keys(body).some((key) => !keys.includes(key)))
    throw new DomainError(
      'INVALID_INPUT',
      'Передайте только сумму, вариант и параметры подтверждения. График рассчитывает сервер.',
    );
  version(body.version);
  if (!preview) {
    if (body.confirmed !== true)
      throw new DomainError(
        'SERVICING_CONFIRMATION',
        'Подтвердите имитацию операции без перевода денег.',
      );
    if (
      typeof body.idempotencyKey !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(body.idempotencyKey)
    )
      throw new DomainError(
        'IDEMPOTENCY_REQUIRED',
        'Передайте уникальный ключ операции длиной от 8 до 100 символов.',
      );
  }
  if (
    kind === 'prepayment' &&
    (typeof body.amount !== 'number' ||
      !Number.isSafeInteger(body.amount) ||
      body.amount < 1 ||
      body.amount > 30_000_000 ||
      !['reduce_payment', 'reduce_term'].includes(String(body.mode)))
  )
    throw new DomainError(
      'INVALID_INPUT',
      'Укажите сумму в целых рублях и вариант досрочного погашения.',
    );
  return body;
}
function checkVersion(state: LoanServicingState, requested: unknown) {
  if (state.version !== requested)
    throw new DomainError(
      'VERSION_CONFLICT',
      'График изменился. Обновите сопровождение и проверьте расчёт заново.',
      409,
    );
}
export function registerServicingRoutes(app: Hono<AppEnv>, db: Database) {
  app.get('/api/applications/:id/servicing', async (c) =>
    c.json({ servicing: await getLoanServicing(db, c.get('user'), c.req.param('id')) }),
  );
  app.post('/api/applications/:id/servicing/prepayment/preview', async (c) => {
    const user = c.get('user');
    if (user.role !== 'client' || !user.organizationId || c.get('tokenAuth'))
      throw new DomainError(
        'FORBIDDEN',
        'Расчёт досрочного погашения доступен владельцу в кабинете.',
        403,
      );
    const body = await readBody(c, 'prepayment', true);
    const state = await getLoanServicing(db, user, c.req.param('id'));
    checkVersion(state, body.version);
    try {
      return c.json({
        preview: previewPrepayment(state, body.amount as number, body.mode as PrepaymentMode),
      });
    } catch (error) {
      convertError(error);
    }
  });
  for (const kind of ['payment', 'prepayment'] as const) {
    app.post(`/api/applications/:id/servicing/${kind}`, async (c) => {
      const user = c.get('user');
      if (user.role !== 'client' || !user.organizationId || c.get('tokenAuth'))
        throw new DomainError(
          'FORBIDDEN',
          'Отметки в модели сопровождения доступны владельцу в кабинете.',
          403,
        );
      const application = await getApplication(db, c.req.param('id'), user);
      const body = await readBody(c, kind);
      const requestHash = await sha256(
        JSON.stringify({
          actor: user.id,
          kind,
          version: body.version,
          ...(kind === 'prepayment' ? { amount: body.amount, mode: body.mode } : {}),
        }),
      );
      const prior = async () => {
        const rows = await db.query<StoredRequest>(
          'SELECT request_hash,response FROM loan_servicing_events WHERE application_id=? AND idempotency_key=?',
          [application.id, body.idempotencyKey as string],
        );
        if (!rows[0]) return null;
        if (rows[0].request_hash !== requestHash)
          throw new DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Этот ключ уже использован для другой операции. Обновите данные.',
            409,
          );
        return JSON.parse(rows[0].response) as { servicing: LoanServicingState };
      };
      const previousResponse = await prior();
      if (previousResponse) return c.json(previousResponse);
      const state = await stateFor(db, application);
      checkVersion(state, body.version);
      const metadata = { id: uid('service'), actor: user.name, recordedAt: now() };
      let next: LoanServicingState;
      try {
        next =
          kind === 'payment'
            ? recordScheduledPayment(state, metadata)
            : recordPrepayment(
                state,
                previewPrepayment(state, body.amount as number, body.mode as PrepaymentMode),
                metadata,
              );
      } catch (error) {
        convertError(error);
      }
      const response = { servicing: next };
      const scope =
        "EXISTS(SELECT 1 FROM applications WHERE id=? AND organization_id=? AND version=? AND status='funded')";
      const result = await db.batch([
        state.version === 0
          ? {
              sql: `INSERT INTO loan_servicing(application_id,organization_id,version,data) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM loan_servicing WHERE application_id=?) AND ${scope}`,
              params: [
                application.id,
                application.organizationId,
                next.version,
                JSON.stringify(next),
                application.id,
                application.id,
                application.organizationId,
                application.version,
              ],
            }
          : {
              sql: `UPDATE loan_servicing SET version=?,data=? WHERE application_id=? AND organization_id=? AND version=? AND ${scope}`,
              params: [
                next.version,
                JSON.stringify(next),
                application.id,
                application.organizationId,
                state.version,
                application.id,
                application.organizationId,
                application.version,
              ],
            },
        {
          sql: 'INSERT INTO loan_servicing_events(id,application_id,organization_id,version,idempotency_key,request_hash,data,response) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1',
          params: [
            metadata.id,
            application.id,
            application.organizationId,
            next.version,
            body.idempotencyKey as string,
            requestHash,
            JSON.stringify(next.history.at(-1)),
            JSON.stringify(response),
          ],
        },
        auditStatement(
          user,
          application,
          kind === 'payment' ? 'servicing_payment_recorded' : 'servicing_prepayment_recorded',
          `${kind === 'payment' ? 'Отмечен платёж' : 'Смоделировано досрочное погашение'}: ${next.history.at(-1)!.amount} ₽, период ${next.history.at(-1)!.effectiveDate}; остаток ${next.balance} ₽; версия сопровождения ${next.version}, ${next.methodVersion}. Деньги не переводились.`,
          true,
        ),
      ]);
      if (result[0].changes !== 1) {
        const concurrent = await prior();
        if (concurrent) return c.json(concurrent);
        throw new DomainError(
          'VERSION_CONFLICT',
          'График уже изменился. Обновите сопровождение и повторите расчёт.',
          409,
        );
      }
      return c.json(response, 201);
    });
  }
}
