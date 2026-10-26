import type { Hono } from 'hono';
import type {
  BusinessProfile,
  BusinessProfileResponse,
  Financials,
  Organization,
  User,
} from '../shared/types.js';
import { businessProfile, documentGuidance } from '../shared/business-profile.js';
import type { Database } from './db.js';
import type { AppEnv } from './http-types.js';
import { DomainError, now, uid, validateInput } from './domain.js';
import { auditStatement, getOrganization } from './repository.js';
import { productsWithIntake } from './admin.js';
import { recommendProducts } from './recommendations.js';
import { requireVersion } from './security.js';

export function profileView(organization: Organization): BusinessProfileResponse {
  const profile = businessProfile(organization);
  return {
    organization: { ...organization, profile },
    profile,
    documentGuidance: documentGuidance(profile),
  };
}
export function requireProfileOwner(user: User) {
  if (user.role !== 'client' || !user.organizationId)
    throw new DomainError(
      'FORBIDDEN',
      'Профиль бизнеса доступен представителю своей организации.',
      403,
    );
  return user.organizationId;
}
export function validateBusinessProfile(
  value: unknown,
  current: BusinessProfile,
  at = now(),
): BusinessProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DomainError('INVALID_PROFILE', 'Передайте профиль бизнеса.');
  const p = value as Record<string, unknown>;
  const labels: Record<string, string> = {
    legalForm: 'Организационно-правовая форма',
    taxSystem: 'Налоговый режим',
    financingGoal: 'Цель финансирования',
    requestedAmount: 'Нужная сумма',
    preferredTermMonths: 'Желаемый срок',
    lowSeasonRevenueDropPct: 'Спад выручки в слабый месяц',
    largestCustomerSharePct: 'Доля крупнейшего покупателя',
    cashReserve: 'Денежный резерв',
    receivablesDays: 'Срок оплаты клиентов',
  };
  const choice = <T extends string>(key: string, options: readonly T[]): T => {
    if (typeof p[key] !== 'string' || !options.includes(p[key] as T))
      throw new DomainError('INVALID_PROFILE', `${labels[key]}: выберите значение из списка.`);
    return p[key] as T;
  };
  const integer = (key: string, min: number, max: number): number => {
    const value = p[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
      throw new DomainError(
        'INVALID_PROFILE',
        `${labels[key]}: укажите целое число от ${min.toLocaleString('ru-RU')} до ${max.toLocaleString('ru-RU')}.`,
      );
    return value;
  };
  const legalForm = choice('legalForm', ['ip', 'ooo', 'ao', 'other'] as const);
  const taxSystem = choice('taxSystem', ['osno', 'usn', 'patent', 'eshn', 'npd'] as const);
  if (legalForm !== 'ip' && ['patent', 'npd'].includes(taxSystem))
    throw new DomainError(
      'INVALID_PROFILE',
      'Патент и НПД в этом профиле можно выбрать только для ИП.',
    );
  const date = p.financialsAsOf;
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    date > at.slice(0, 10) ||
    date < '2000-01-01'
  )
    throw new DomainError(
      'INVALID_PROFILE',
      'Укажите существующую дату финансовых данных, не позднее сегодняшней.',
    );
  return {
    legalForm,
    taxSystem,
    financingGoal: choice('financingGoal', [
      'working_capital',
      'equipment',
      'credit_line',
    ] as const),
    requestedAmount: integer('requestedAmount', 100000, 30000000),
    preferredTermMonths: integer('preferredTermMonths', 6, 60),
    lowSeasonRevenueDropPct: integer('lowSeasonRevenueDropPct', 0, 80),
    largestCustomerSharePct: integer('largestCustomerSharePct', 0, 100),
    cashReserve: integer('cashReserve', 0, 1000000000),
    receivablesDays: integer('receivablesDays', 0, 365),
    financialsAsOf: date,
    version: current.version + 1,
    updatedAt: at,
  };
}
export function registerProfileRoutes(app: Hono<AppEnv>, db: Database) {
  app.get('/api/business-profile', async (c) =>
    c.json(profileView(await getOrganization(db, requireProfileOwner(c.get('user'))))),
  );
  app.put('/api/business-profile', async (c) => {
    const user = c.get('user');
    const id = requireProfileOwner(user);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new DomainError('INVALID_PROFILE', 'Передайте объект профиля.');
    const version = requireVersion(body.version);
    const organization = await getOrganization(db, id);
    const current = businessProfile(organization);
    if (version !== current.version)
      throw new DomainError(
        'VERSION_CONFLICT',
        'Профиль уже изменён. Обновите страницу перед сохранением.',
        409,
      );
    const profile = validateBusinessProfile(body.profile, current);
    const financials: Financials = validateInput({
      productId: 'working_capital',
      amount: 100000,
      termMonths: 6,
      purpose: 'Показатели профиля',
      financials: body.financials,
      consent: false,
    }).financials;
    const captureId = uid('context');
    const snapshotMeta = {
      source: 'legacy_recovery',
      capturedAt: profile.updatedAt,
      profileVersion: current.version,
      captureId,
    };
    const result = await db.batch([
      {
        sql: "INSERT OR IGNORE INTO business_profiles(organization_id,version,data) VALUES(?,1,'{}')",
        params: [id],
      },
      {
        sql: `UPDATE applications SET version=version+1,updated_at=?,data=json_set(data,'$.organizationSnapshot',json(?),'$.organizationSnapshotMeta',json(?),'$.version',version+1,'$.updatedAt',?) WHERE organization_id=? AND status<>'draft' AND json_extract(data,'$.organizationSnapshot') IS NULL AND EXISTS(SELECT 1 FROM business_profiles WHERE organization_id=? AND version=?)`,
        params: [
          profile.updatedAt,
          JSON.stringify(organization),
          JSON.stringify(snapshotMeta),
          profile.updatedAt,
          id,
          id,
          version,
        ],
      },
      {
        sql: `INSERT INTO audit(id,organization_id,application_id,actor_id,actor_name,action,detail,created_at,context)
          SELECT ?||'_'||id,organization_id,id,?,?, 'legacy_context_captured',?,?,json_patch(json_object(
            'schemaVersion',1,
            'applicationVersion',version,
            'profileVersion',json_extract(data,'$.organizationSnapshotMeta.profileVersion'),
            'input',json_object(
              'status',status,
              'productId',json_extract(data,'$.productId'),
              'amount',json_extract(data,'$.amount'),
              'termMonths',json_extract(data,'$.termMonths'),
              'purpose',json_extract(data,'$.purpose'),
              'financials',json_extract(data,'$.financials'),
              'organizationSnapshot',json_extract(data,'$.organizationSnapshot'),
              'organizationSnapshotMeta',json_extract(data,'$.organizationSnapshotMeta')
            ),
            'assessment',json_object(
              'score',json_extract(data,'$.score'),
              'decision',json_extract(data,'$.decision'),
              'checks',COALESCE(json_extract(data,'$.checks'),json('[]'))
            )
          ),json_object(
            'scoringVersion',json_extract(data,'$.score.modelVersion'),
            'policyVersion',json_extract(data,'$.decision.ruleVersion')
          )) FROM applications WHERE organization_id=? AND json_extract(data,'$.organizationSnapshotMeta.captureId')=?`,
        params: [
          captureId,
          user.id,
          user.name,
          'Контекст старой заявки закреплён перед изменением профиля из доступных на этот момент данных. Исходный исторический снимок отсутствовал; сохранённое решение не изменено.',
          profile.updatedAt,
          id,
          captureId,
        ],
      },
      {
        sql: 'UPDATE business_profiles SET version=?,data=? WHERE organization_id=? AND version=?',
        params: [profile.version, JSON.stringify({ profile, financials }), id, version],
      },
      auditStatement(
        user,
        null,
        'business_profile_updated',
        `Обновлён профиль бизнеса, версия ${profile.version}. Ранее отправленные заявки сохраняют свой снимок.`,
        true,
      ),
    ]);
    if (result[3].changes !== 1)
      throw new DomainError(
        'VERSION_CONFLICT',
        'Профиль уже изменён. Обновите страницу перед сохранением.',
        409,
      );
    return c.json(profileView({ ...organization, ...financials, profile }));
  });
  app.get('/api/recommendations', async (c) => {
    const organization = await getOrganization(db, requireProfileOwner(c.get('user')));
    return c.json(recommendProducts(organization, await productsWithIntake(db)));
  });
}
