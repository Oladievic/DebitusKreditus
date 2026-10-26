import type {
  Application,
  ApplicationDetail,
  AuditRecord,
  AuditContext,
  AuditVersions,
  DocumentRecord,
  Organization,
  User,
  Role,
} from '../shared/types.js';
import type { Database, SqlStatement } from './db.js';
import { assess, DomainError, now, productById, uid } from './domain.js';
import { businessProfile } from '../shared/business-profile.js';
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  organization_id: string | null;
  password_hash: string;
  password_salt: string;
}
export function userView(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    organizationId: r.organization_id,
  };
}
export async function getOrganization(db: Database, id: string): Promise<Organization> {
  const rows = await db.query<{ data: string; profile_data: string | null }>(
    'SELECT organizations.data,business_profiles.data AS profile_data FROM organizations LEFT JOIN business_profiles ON business_profiles.organization_id=organizations.id WHERE organizations.id=?',
    [id],
  );
  if (!rows[0]) throw new DomainError('NOT_FOUND', 'Организация не найдена.', 404);
  const original: Organization = JSON.parse(rows[0].data);
  const stored = rows[0].profile_data ? JSON.parse(rows[0].profile_data) : {};
  return {
    ...original,
    ...stored.financials,
    profile: stored.profile ?? businessProfile(original),
  };
}
export async function getApplication(db: Database, id: string, user: User): Promise<Application> {
  requireCreditAccess(user);
  const rows = await db.query<{ data: string }>(
    `SELECT data FROM applications WHERE id=?${user.role === 'client' ? ' AND organization_id=?' : " AND status<>'draft'"}`,
    user.role === 'client' ? [id, user.organizationId] : [id],
  );
  if (!rows[0]) throw new DomainError('NOT_FOUND', 'Заявка не найдена.', 404);
  return JSON.parse(rows[0].data);
}
export async function listApplications(db: Database, user: User): Promise<Application[]> {
  requireCreditAccess(user);
  const rows = await db.query<{ data: string }>(
    `SELECT data FROM applications WHERE ${user.role === 'client' ? 'organization_id=?' : "status<>'draft'"} ORDER BY updated_at DESC, id DESC`,
    user.role === 'client' ? [user.organizationId] : [],
  );
  return rows.map((r) => JSON.parse(r.data));
}
export interface DocumentRow {
  id: string;
  application_id: string;
  organization_id: string;
  name: string;
  category: string;
  mime_type: string;
  size: number;
  sha256: string;
  content: string;
  synthetic: number;
  created_at: string;
  ocr_data?: string | null;
}
function requireCreditAccess(user: User) {
  if (user.role !== 'client' && user.role !== 'bank')
    throw new DomainError(
      'FORBIDDEN',
      'Администратор не имеет доступа к содержимому кредитного дела.',
      403,
    );
}
export function documentView(r: DocumentRow): DocumentRecord {
  return {
    id: r.id,
    applicationId: r.application_id,
    name: r.name,
    category: r.category,
    mimeType: r.mime_type,
    size: r.size,
    sha256: r.sha256,
    createdAt: r.created_at,
    downloadUrl: `/api/documents/${r.id}/download`,
    synthetic: Boolean(r.synthetic),
    ...(r.ocr_data ? { ocr: JSON.parse(r.ocr_data) } : {}),
  };
}
export async function listDocuments(
  db: Database,
  user: User,
  applicationId?: string,
): Promise<DocumentRecord[]> {
  requireCreditAccess(user);
  const where = [
    user.role === 'client'
      ? 'organization_id=?'
      : "application_id IN (SELECT id FROM applications WHERE status<>'draft')",
  ];
  const params: (string | null)[] = user.role === 'client' ? [user.organizationId] : [];
  if (applicationId) {
    where.push('application_id=?');
    params.push(applicationId);
  }
  const rows = await db.query<DocumentRow>(
    `SELECT id,application_id,organization_id,name,category,mime_type,size,sha256,synthetic,created_at,(SELECT data FROM document_ocr WHERE document_id=documents.id) AS ocr_data FROM documents WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
    params,
  );
  return rows.map(documentView);
}
export const ACTION_TITLES: Record<string, string> = {
  servicing_payment_recorded: 'Отмечен платёж в модели обслуживания',
  servicing_prepayment_recorded: 'Пересчитан график после досрочного погашения',
  statement_analyzed: 'Сохранён анализ выписки',
  created: 'Создан черновик',
  draft_updated: 'Черновик сохранён',
  submitted: 'Заявка отправлена',
  review_started: 'Банк начал рассмотрение',
  needs_info: 'Запрошены сведения',
  supplemented: 'Сведения дополнены',
  approved: 'Финансирование одобрено',
  counter_offer: 'Предложены другие условия',
  declined: 'Принято отрицательное решение',
  accepted: 'Условия приняты',
  signed: 'Документы подписаны в симуляторе',
  funded: 'Выдача смоделирована',
  document_added: 'Добавлен документ',
  imported: 'Импортирован черновик',
  legacy_context_captured: 'Закреплён контекст прежней заявки',
};
export function applicationAuditContext(application: Application): AuditContext {
  return {
    schemaVersion: 1,
    applicationVersion: application.version,
    profileVersion:
      application.organizationSnapshot?.profile?.version ??
      application.organizationSnapshotMeta?.profileVersion ??
      application.score?.profileVersion,
    scoringVersion: application.score?.modelVersion,
    policyVersion: application.decision?.ruleVersion,
    input: {
      status: application.status,
      productId: application.productId,
      productSnapshot: productById(application.productId),
      amount: application.amount,
      termMonths: application.termMonths,
      purpose: application.purpose,
      financials: application.financials,
      organizationSnapshot: application.organizationSnapshot,
      organizationSnapshotMeta: application.organizationSnapshotMeta,
    },
    ...(application.score || application.decision || application.checks.length
      ? {
          assessment: {
            score: application.score,
            decision: application.decision,
            checks: application.checks,
          },
        }
      : {}),
  };
}
export function auditVersions(context: AuditContext): AuditVersions {
  return {
    schemaVersion: context.schemaVersion,
    applicationVersion: context.applicationVersion,
    ...(context.profileVersion === undefined ? {} : { profileVersion: context.profileVersion }),
    ...(context.scoringVersion ? { scoringVersion: context.scoringVersion } : {}),
    ...(context.policyVersion ? { policyVersion: context.policyVersion } : {}),
  };
}
export function auditStatement(
  user: User,
  application: Application | null,
  action: string,
  detail: string,
  conditional = false,
): SqlStatement {
  return {
    sql: `INSERT INTO audit(id,organization_id,application_id,actor_id,actor_name,action,detail,created_at,context) SELECT ?,?,?,?,?,?,?,?,?${conditional ? ' WHERE changes()=1' : ''}`,
    params: [
      uid('audit'),
      application?.organizationId ?? user.organizationId,
      application?.id ?? null,
      user.id,
      user.name,
      action,
      detail.slice(0, 2000),
      now(),
      application ? JSON.stringify(applicationAuditContext(application)) : null,
    ],
  };
}
export async function saveApplication(
  db: Database,
  previous: Application,
  next: Application,
  user: User,
  action: string,
  detail: string,
  extra: SqlStatement[] = [],
  requireOpenIntake = false,
) {
  next.version = previous.version + 1;
  next.updatedAt = now();
  const result = await db.batch([
    {
      sql: `UPDATE applications SET data=?,status=?,version=?,updated_at=? WHERE id=? AND version=?${requireOpenIntake ? ' AND EXISTS (SELECT 1 FROM product_intake WHERE product_id=? AND paused=0)' : ''}`,
      params: [
        JSON.stringify(next),
        next.status,
        next.version,
        next.updatedAt,
        previous.id,
        previous.version,
        ...(requireOpenIntake ? [next.productId] : []),
      ],
    },
    auditStatement(user, next, action, detail, true),
    ...extra,
  ]);
  if (result[0].changes !== 1) {
    if (requireOpenIntake) {
      const intake = await db.query<{ paused: number; reason: string }>(
        'SELECT paused,reason FROM product_intake WHERE product_id=?',
        [next.productId],
      );
      if (!intake[0] || intake[0].paused)
        throw new DomainError(
          'INTAKE_PAUSED',
          `Приём новых заявок по продукту приостановлен.${intake[0]?.reason ? ` ${intake[0].reason}` : ''} Черновик сохранён.`,
          409,
        );
    }
    throw new DomainError(
      'VERSION_CONFLICT',
      'Заявка уже изменилась. Обновите страницу и повторите действие.',
      409,
    );
  }
}
export function insertApplicationStatement(a: Application): SqlStatement {
  return {
    sql: 'INSERT INTO applications(id,organization_id,status,version,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    params: [
      a.id,
      a.organizationId,
      a.status,
      a.version,
      JSON.stringify(a),
      a.createdAt,
      a.updatedAt,
    ],
  };
}
export async function detail(db: Database, id: string, user: User): Promise<ApplicationDetail> {
  const application = await getApplication(db, id, user);
  const organization =
    application.organizationSnapshot ?? (await getOrganization(db, application.organizationId));
  const documents = await listDocuments(db, user, id);
  const events = await db.query<{
    id: string;
    action: string;
    detail: string;
    actor_name: string;
    created_at: string;
    context: string | null;
  }>(
    'SELECT id,action,detail,actor_name,created_at,context FROM audit WHERE application_id=? ORDER BY created_at,id',
    [id],
  );
  return {
    application,
    documents,
    organization,
    product: productById(application.productId),
    timeline: events.map((e) => ({
      id: e.id,
      action: e.action,
      title: ACTION_TITLES[e.action] ?? e.action,
      detail: e.detail,
      actor: e.actor_name,
      createdAt: e.created_at,
      ...(e.context ? { context: JSON.parse(e.context) as AuditContext } : {}),
    })),
    assessment:
      application.score && application.decision
        ? { score: application.score, decision: application.decision, checks: application.checks }
        : assess(
            application,
            organization,
            documents,
            'rule-engine',
            application.submittedAt ?? application.updatedAt,
          ),
  };
}
export async function auditList(db: Database, user: User): Promise<AuditRecord[]> {
  requireCreditAccess(user);
  const rows = await db.query<Record<string, string>>(
    `SELECT * FROM audit WHERE ${user.role === 'client' ? 'organization_id=?' : "application_id IN (SELECT id FROM applications WHERE status<>'draft') OR (application_id IS NULL AND actor_id=?)"} ORDER BY created_at DESC,id DESC LIMIT 200`,
    user.role === 'client' ? [user.organizationId] : [user.id],
  );
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    applicationId: r.application_id,
    actorId: r.actor_id,
    actorName: r.actor_name,
    action: r.action,
    detail: r.detail,
    createdAt: r.created_at,
    ...(r.context ? { context: JSON.parse(r.context) as AuditContext } : {}),
  }));
}
