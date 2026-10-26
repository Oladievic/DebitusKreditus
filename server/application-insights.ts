import type { Hono } from 'hono';
import type { AppEnv } from './http-types.js';
import type { Database } from './db.js';
import type { User } from '../shared/types.js';
import type { StatementReport } from '../shared/statements.js';
import { buildApplicationActionPlan } from '../shared/application-actions.js';
import { buildApplicationChanges } from '../shared/application-changes.js';
import { detail, getOrganization } from './repository.js';
import { assess, DomainError, now } from './domain.js';
import { getLoanServicing } from './servicing.js';

async function reports(db: Database, applicationId: string, organizationId: string) {
  const rows = await db.query<{ data: string }>(
    'SELECT data FROM statement_reports WHERE application_id=? AND organization_id=?',
    [applicationId, organizationId],
  );
  return rows.map((row) => JSON.parse(row.data) as StatementReport);
}
export async function getApplicationActionPlan(db: Database, user: User, applicationId: string) {
  const dossier = await detail(db, applicationId, user);
  const current = ['draft', 'needs_info'].includes(dossier.application.status)
    ? await getOrganization(db, dossier.application.organizationId)
    : dossier.organization;
  const at = now();
  if (['draft', 'needs_info'].includes(dossier.application.status)) {
    const previewApplication = { ...dossier.application, organizationSnapshot: current };
    dossier.assessment = assess(
      previewApplication,
      current,
      dossier.documents,
      'action-plan-preview',
      at,
    );
  }
  return buildApplicationActionPlan(
    dossier,
    await reports(db, applicationId, dossier.application.organizationId),
    at,
    current,
    dossier.application.status === 'funded'
      ? await getLoanServicing(db, user, applicationId)
      : undefined,
  );
}
export async function getApplicationChanges(db: Database, user: User, applicationId: string) {
  if (user.role !== 'bank')
    throw new DomainError('FORBIDDEN', 'Сравнение пакетов доступно сотруднику банка.', 403);
  const dossier = await detail(db, applicationId, user);
  const at = now();
  dossier.assessment = assess(
    dossier.application,
    dossier.organization,
    dossier.documents,
    'comparison-preview',
    at,
  );
  return buildApplicationChanges(
    dossier,
    await reports(db, applicationId, dossier.application.organizationId),
    at,
  );
}
export function registerApplicationInsightRoutes(app: Hono<AppEnv>, db: Database) {
  app.get('/api/applications/:id/action-plan', async (c) =>
    c.json(await getApplicationActionPlan(db, c.get('user'), c.req.param('id'))),
  );
  app.get('/api/bank/applications/:id/changes', async (c) =>
    c.json(await getApplicationChanges(db, c.get('user'), c.req.param('id'))),
  );
}
