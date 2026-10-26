import type { Hono } from 'hono';
import type { AppEnv } from './http-types.js';
import type { Database } from './db.js';
import type { User } from '../shared/types.js';
import { DomainError, now, uid } from './domain.js';
import { getApplication, listDocuments, saveApplication } from './repository.js';
import { requireVersion, safeFilename, sha256, toBase64 } from './security.js';
import {
  analyzeStatement,
  StatementValidationError,
  type StatementPeriod,
  type StatementReport,
} from '../shared/statements.js';

export async function getStatementReport(
  db: Database,
  user: User,
  applicationId: string,
): Promise<StatementReport | null> {
  const application = await getApplication(db, applicationId, user);
  const rows = await db.query<{ data: string }>(
    "SELECT data FROM statement_reports WHERE application_id=? AND organization_id=? ORDER BY CAST(json_extract(data,'$.applicationVersion') AS INTEGER) DESC LIMIT 1",
    [application.id, application.organizationId],
  );
  return rows[0] ? (JSON.parse(rows[0].data) as StatementReport) : null;
}
export function registerStatementRoutes(app: Hono<AppEnv>, db: Database) {
  app.get('/api/applications/:id/statement', async (c) => {
    return c.json({ report: await getStatementReport(db, c.get('user'), c.req.param('id')) });
  });
  for (const preview of [true, false]) {
    app.post(`/api/applications/:id/statement${preview ? '/preview' : ''}`, async (c) => {
      const user = c.get('user');
      if (user.role !== 'client' || !user.organizationId)
        throw new DomainError('FORBIDDEN', 'Выписку добавляет владелец заявки.', 403);
      const raw: unknown = await c.req.json();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new DomainError('INVALID_JSON_OBJECT', 'Передайте объект с CSV и периодом выписки.');
      const body = raw as Record<string, unknown>;
      const version = requireVersion(body.version);
      const application = await getApplication(db, c.req.param('id'), user);
      if (application.version !== version)
        throw new DomainError(
          'VERSION_CONFLICT',
          'Заявка изменилась. Обновите её перед анализом выписки.',
          409,
        );
      if (!['draft', 'needs_info'].includes(application.status))
        throw new DomainError(
          'INVALID_STATE',
          'Добавить выписку можно в черновик или при запросе дополнений.',
          409,
        );
      if (!preview && body.reviewed !== true)
        throw new DomainError(
          'STATEMENT_REVIEW_REQUIRED',
          'Сначала проверьте период, классификацию операций и результат анализа.',
        );
      if (
        typeof body.sourceName !== 'string' ||
        !body.sourceName.trim() ||
        body.sourceName.length > 255
      )
        throw new DomainError(
          'STATEMENT_FILENAME',
          'Укажите имя CSV-файла длиной до 255 символов.',
        );
      if (typeof body.csv !== 'string')
        throw new DomainError('STATEMENT_CSV', 'Передайте выписку текстом CSV.');
      const analysis = (() => {
        try {
          return analyzeStatement(
            body.csv as string,
            body.period as StatementPeriod,
            application.financials,
          );
        } catch (error) {
          if (error instanceof StatementValidationError)
            throw new DomainError(
              error.code,
              error.message,
              error.code === 'STATEMENT_SIZE' ? 413 : 400,
            );
          throw error;
        }
      })();
      const bytes = new TextEncoder().encode(body.csv);
      const sourceSha256 = await sha256(bytes);
      if (preview) return c.json({ analysis, sourceSha256 });
      if ((await listDocuments(db, user, application.id)).length >= 20)
        throw new DomainError('DOCUMENT_LIMIT', 'Для одной заявки допускается до 20 документов.');
      const timestamp = now();
      const report: StatementReport = {
        id: uid('statement'),
        applicationId: application.id,
        organizationId: application.organizationId,
        documentId: uid('doc'),
        documentName:
          safeFilename(body.sourceName.trim().replace(/\.csv$/i, '')).slice(0, 100) +
          '-statement.csv',
        sourceSha256,
        sourceSize: bytes.length,
        createdAt: timestamp,
        createdBy: user.id,
        applicationVersion: application.version + 1,
        profileVersion:
          application.organizationSnapshot?.profile?.version ??
          application.organizationSnapshotMeta?.profileVersion ??
          null,
        analysis,
      };
      await saveApplication(
        db,
        application,
        { ...application },
        user,
        'statement_analyzed',
        `Выписка ${report.documentName}: ${analysis.uniqueRows} операций, ${analysis.duplicates.length} повторов исключено; ${analysis.methodVersion}. Финансовые сведения и решение не изменены.`,
        [
          {
            sql: 'INSERT INTO documents(id,application_id,organization_id,name,category,mime_type,size,sha256,content,synthetic,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1',
            params: [
              report.documentId,
              application.id,
              application.organizationId,
              report.documentName,
              'statement',
              'text/csv',
              bytes.length,
              sourceSha256,
              toBase64(bytes),
              0,
              timestamp,
            ],
          },
          {
            sql: 'INSERT INTO statement_reports(id,application_id,organization_id,document_id,data) SELECT ?,?,?,?,? WHERE changes()=1',
            params: [
              report.id,
              application.id,
              application.organizationId,
              report.documentId,
              JSON.stringify(report),
            ],
          },
        ],
      );
      return c.json({ report }, 201);
    });
  }
}
