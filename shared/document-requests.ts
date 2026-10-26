import type { CreditDecision, DocumentRecord } from './types.js';

export interface DocumentRequestMetadata {
  id: string;
  requestedAt: string;
  baselineDocumentIds: string[];
  categories: string[];
  methodVersion: 'document-id-baseline-v1';
}

export interface DocumentRequestStatus {
  mode: 'id_baseline' | 'legacy_timestamp' | 'none';
  requestId: string | null;
  requestedAt: string | null;
  complete: boolean;
  categories: {
    category: string;
    satisfied: boolean;
    matchingDocumentIds: string[];
    existingDocumentIds: string[];
  }[];
  note: string;
}

export function documentRequestStatus(
  decision: CreditDecision | null | undefined,
  documents: Pick<DocumentRecord, 'id' | 'category' | 'createdAt'>[],
): DocumentRequestStatus {
  if (!decision || decision.outcome !== 'needs_info')
    return {
      mode: 'none',
      requestId: null,
      requestedAt: null,
      complete: true,
      categories: [],
      note: '',
    };
  const metadata = decision.documentRequest;
  const hasBaseline =
    metadata?.methodVersion === 'document-id-baseline-v1' &&
    Array.isArray(metadata.baselineDocumentIds) &&
    Array.isArray(metadata.categories);
  const baseline = hasBaseline ? new Set(metadata.baselineDocumentIds) : null;
  const requestedAt = hasBaseline ? metadata.requestedAt : decision.decidedAt;
  const requestedTime = Date.parse(requestedAt);
  const categories = [
    ...new Set([...decision.requestedDocuments, ...(hasBaseline ? metadata.categories : [])]),
  ].map((category) => {
    const existing = documents.filter((document) => document.category === category);
    const matching = existing.filter((document) =>
      baseline
        ? !baseline.has(document.id)
        : Number.isFinite(requestedTime) &&
          Number.isFinite(Date.parse(document.createdAt)) &&
          Date.parse(document.createdAt) > requestedTime,
    );
    return {
      category,
      satisfied: matching.length > 0,
      matchingDocumentIds: matching.map((document) => document.id),
      existingDocumentIds: existing.map((document) => document.id),
    };
  });
  return {
    mode: hasBaseline ? 'id_baseline' : 'legacy_timestamp',
    requestId: hasBaseline ? metadata.id : null,
    requestedAt: Number.isFinite(requestedTime) ? requestedAt : null,
    complete: categories.every((item) => item.satisfied),
    categories,
    note: hasBaseline
      ? 'В каждой запрошенной категории нужен файл, добавленный после этого запроса. Наличие нового вложения не подтверждает его содержание; решение примет банк после повторной проверки.'
      : 'У прежнего запроса нет списка исходных файлов. Учитываем только вложения со временем загрузки строго позже решения; при одинаковом времени требуется ещё один файл. Содержание проверит банк.',
  };
}
