import type { Hono } from 'hono';
import type { AppEnv } from './http-types.js';
import type { Database } from './db.js';
import type { DocumentRecord } from '../shared/types.js';
import { DomainError, now, uid } from './domain.js';
import {
  documentView,
  getApplication,
  listDocuments,
  saveApplication,
  type DocumentRow,
} from './repository.js';
import { requireVersion, safeFilename, sha256, toBase64 } from './security.js';

export function registerOCRRoutes(app: Hono<AppEnv>, db: Database) {
  app.post('/api/applications/:id/documents/ocr', async (c) => {
    const user = c.get('user');
    if (user.role !== 'client')
      throw new DomainError('FORBIDDEN', 'Распознанные документы добавляет владелец заявки.', 403);
    let body: Record<string, unknown>;
    try {
      const raw: unknown = await c.req.json();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
      body = raw as Record<string, unknown>;
    } catch {
      throw new DomainError('INVALID_JSON', 'Передайте объект с проверенным текстом документа.');
    }
    const version = requireVersion(body.version);
    const application = await getApplication(db, c.req.param('id'), user);
    if (application.version !== version)
      throw new DomainError(
        'VERSION_CONFLICT',
        'Заявка изменилась. Обновите её перед сохранением документа.',
        409,
      );
    if (!['draft', 'needs_info'].includes(application.status))
      throw new DomainError(
        'INVALID_STATE',
        'Добавлять документы можно в черновик или при запросе дополнений.',
        409,
      );
    if (body.reviewed !== true)
      throw new DomainError(
        'OCR_REVIEW_REQUIRED',
        'Сначала сверьте распознанный текст с оригиналом.',
      );
    if (
      typeof body.category !== 'string' ||
      !['statement', 'financials', 'invoice', 'other'].includes(body.category)
    )
      throw new DomainError('INVALID_CATEGORY', 'Выберите категорию документа.');
    if (
      typeof body.text !== 'string' ||
      !body.text.trim() ||
      body.text.length > 100_000 ||
      /\0|<(script|html|svg|iframe)\b/i.test(body.text)
    )
      throw new DomainError(
        'OCR_TEXT',
        'Нужен проверенный текст от 1 до 100 000 символов без исполняемого HTML.',
      );
    if (
      typeof body.sourceName !== 'string' ||
      !body.sourceName.trim() ||
      body.sourceName.length > 255 ||
      typeof body.sourceSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.sourceSha256) ||
      typeof body.sourceSize !== 'number' ||
      !Number.isSafeInteger(body.sourceSize) ||
      body.sourceSize < 1 ||
      body.sourceSize > 10 * 1024 * 1024 ||
      typeof body.sourceMimeType !== 'string' ||
      !['application/pdf', 'image/png', 'image/jpeg'].includes(body.sourceMimeType) ||
      typeof body.pages !== 'number' ||
      !Number.isInteger(body.pages) ||
      body.pages < 1 ||
      body.pages > 5 ||
      (body.sourceMimeType !== 'application/pdf' && body.pages !== 1) ||
      body.engine !== 'tesseract.js@7.0.0'
    )
      throw new DomainError(
        'OCR_METADATA',
        'Сведения об исходном файле повреждены. Распознайте документ заново.',
      );
    if ((await listDocuments(db, user, application.id)).length >= 20)
      throw new DomainError('DOCUMENT_LIMIT', 'Для одной заявки допускается до 20 документов.');
    const timestamp = now();
    const metadata: NonNullable<DocumentRecord['ocr']> = {
      sourceName: safeFilename(body.sourceName),
      sourceSha256: body.sourceSha256,
      sourceSize: body.sourceSize,
      sourceMimeType: body.sourceMimeType,
      pages: body.pages,
      engine: body.engine,
      reviewedAt: timestamp,
      reviewedBy: user.id,
    };
    const text = `ПРОВЕРЕННАЯ ТЕКСТОВАЯ КОПИЯ\nИсточник: ${metadata.sourceName}\nSHA-256 исходника (сообщён браузером): ${metadata.sourceSha256}\nРаспознавание: ${metadata.engine}, rus+eng, ${metadata.pages} стр.\nПроверено пользователем ${user.name}: ${timestamp}\nОригинал не включён. Текст мог быть исправлен пользователем. Подлинность и достоверность не проверены.\n\n${body.text.trim()}\n`;
    const bytes = new TextEncoder().encode(text);
    const row: DocumentRow = {
      id: uid('doc'),
      application_id: application.id,
      organization_id: application.organizationId,
      name: `${safeFilename(metadata.sourceName.replace(/\.[^.]+$/, '')).slice(0, 95)}-ocr.txt`,
      category: body.category,
      mime_type: 'text/plain',
      size: bytes.length,
      sha256: await sha256(bytes),
      content: toBase64(bytes),
      synthetic: 0,
      created_at: timestamp,
      ocr_data: JSON.stringify(metadata),
    };
    await saveApplication(
      db,
      application,
      { ...application },
      user,
      'document_added',
      `Проверенная пользователем OCR-копия: ${row.name}. Оригинал не загружен.`,
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
        {
          sql: 'INSERT INTO document_ocr(document_id,data) SELECT ?,? WHERE changes()=1',
          params: [row.id, row.ocr_data!],
        },
      ],
    );
    return c.json({ document: documentView(row) }, 201);
  });
}
