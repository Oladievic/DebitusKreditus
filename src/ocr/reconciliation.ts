import type { Financials } from '../../shared/types';
import { financialCandidates, financialLabels, parseRubles } from './fields';

export type OcrFieldValues = Partial<Record<keyof Financials, string>>;
export type OcrFieldSelection = Partial<Record<keyof Financials, boolean>>;
export type ReconciliationStatus = 'matches' | 'differs' | 'missing' | 'ambiguous' | 'unavailable';
export interface OcrReconciliation {
  field: keyof Financials;
  current: number | null;
  recognized: number | null;
  effective: number | null;
  manuallyEdited: boolean;
  source: string | null;
  originalSource: string | null;
  originalRecognized: number | null;
  status: ReconciliationStatus;
  hint: string;
}

const fieldPatterns: Record<keyof Financials, RegExp> = {
  monthlyRevenue: /выручк|revenue/i,
  monthlyExpenses: /операционн.*расход|расход.*операционн|operating expenses/i,
  monthlyDebtPayment: /кредитн.*плат|плат.*кредит|debt payment/i,
};

export function valuesFromOcr(text: string): OcrFieldValues {
  return Object.fromEntries(
    financialCandidates(text).map((candidate) => [candidate.field, String(candidate.value)]),
  );
}

export function reconcileOcr(
  text: string,
  currentFinancials?: Financials,
  values: OcrFieldValues = valuesFromOcr(text),
  originalText = text,
): OcrReconciliation[] {
  const candidates = financialCandidates(text);
  const originalCandidates = financialCandidates(originalText);
  return (Object.keys(financialLabels) as (keyof Financials)[]).map((field) => {
    const candidate = candidates.find((item) => item.field === field);
    const original = originalCandidates.find((item) => item.field === field);
    const lines = text.split(/\r?\n/).filter((line) => fieldPatterns[field].test(line));
    const eligibleLines = lines.flatMap(financialCandidates).filter((item) => item.field === field);
    const ambiguous =
      !candidate &&
      (eligibleLines.length > 1 ||
        lines.some((line) => {
          if (!/(месяц|месячн|monthly|\/мес)/i.test(line)) return false;
          return (line.match(/\d(?:[\d \u00a0\u202f]*\d)?(?:[,.]\d{1,2})?/g) ?? []).length > 1;
        }));
    const recognized = candidate?.value ?? null;
    const raw = values[field] ?? '';
    const parsed = parseRubles(raw);
    const effective = parsed === 0 && field === 'monthlyRevenue' ? null : parsed;
    const manuallyEdited = raw.trim() !== (recognized === null ? '' : String(recognized));
    const current = currentFinancials?.[field] ?? null;
    const status: ReconciliationStatus =
      effective !== null
        ? current === null
          ? 'unavailable'
          : effective === current
            ? 'matches'
            : 'differs'
        : ambiguous
          ? 'ambiguous'
          : 'missing';
    return {
      field,
      current,
      recognized,
      effective,
      manuallyEdited,
      source: candidate?.source ?? null,
      originalSource: original?.source ?? null,
      originalRecognized: original?.value ?? null,
      status,
      hint: candidate
        ? 'Найдена одна явная месячная сумма. Сверьте её с оригиналом.'
        : ambiguous
          ? 'Есть несколько сумм или строк. Сверьте период с оригиналом и укажите нужную месячную сумму вручную.'
          : lines.length
            ? 'Нет однозначной месячной суммы в рублях. Проверьте период, валюту и единицы: годовые суммы, тысячи и миллионы не пересчитываются.'
            : 'Показатель не найден. Загрузите читаемую страницу с нужной строкой или внесите сумму вручную после сверки.',
    };
  });
}

export function selectedOcrFinancials(
  values: OcrFieldValues,
  selected: OcrFieldSelection,
): Partial<Financials> {
  const financials: Partial<Financials> = {};
  for (const field of Object.keys(financialLabels) as (keyof Financials)[]) {
    if (!selected[field]) continue;
    const amount = parseRubles(values[field] ?? '');
    if (amount === null || (field === 'monthlyRevenue' && amount === 0)) {
      throw new Error(
        `${financialLabels[field]}: укажите целое число ${field === 'monthlyRevenue' ? 'от 1' : 'от 0'} до 1 000 000 000.`,
      );
    }
    financials[field] = amount;
  }
  return financials;
}
