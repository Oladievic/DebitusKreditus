import type { Financials } from '../../shared/types';

export const OCR_LIMITS = {
  bytes: 10 * 1024 * 1024,
  pages: 5,
  sourcePixels: 24_000_000,
  canvasPixels: 6_000_000,
  edge: 3000,
  text: 100_000,
} as const;
export const financialLabels: Record<keyof Financials, string> = {
  monthlyRevenue: 'Выручка в месяц, ₽',
  monthlyExpenses: 'Операционные расходы в месяц, ₽',
  monthlyDebtPayment: 'Кредитные платежи в месяц, ₽',
};
export type FinancialCandidate = { field: keyof Financials; value: number; source: string };

export function parseRubles(raw: string): number | null {
  const value = raw
    .trim()
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(',', '.');
  if (!/^\d+(?:\.0{1,2})?$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= 1_000_000_000 ? number : null;
}

export function financialCandidates(text: string): FinancialCandidate[] {
  const found = new Map<keyof Financials, FinancialCandidate[]>();
  for (const source of text.split(/\r?\n/)) {
    const line = source.toLocaleLowerCase('ru');
    if (
      !/(месяц|месячн|monthly|\/мес)/.test(line) ||
      /(год|квартал|annual|тыс|млн|million|thousand|usd|eur|[$€]|[-−]\s*\d)/.test(line)
    )
      continue;
    let field: keyof Financials | undefined;
    if (/(выручк|revenue)/.test(line)) field = 'monthlyRevenue';
    else if (/(кредитн.*плат|плат.*кредит|debt payment)/.test(line)) field = 'monthlyDebtPayment';
    else if (/(операционн.*расход|расход.*операционн|operating expenses)/.test(line))
      field = 'monthlyExpenses';
    if (!field) continue;
    const numbers = source.match(/\d(?:[\d \u00a0\u202f]*\d)?(?:[,.]\d{1,2})?/g) ?? [];
    if (numbers.length !== 1) continue;
    const value = parseRubles(numbers[0]);
    if (value === null || (field === 'monthlyRevenue' && value === 0)) continue;
    found.set(field, [...(found.get(field) ?? []), { field, value, source: source.trim() }]);
  }
  return [...found.values()].filter((items) => items.length === 1).map((items) => items[0]);
}

export function imageDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
  mime: string;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    bytes.slice(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i])
  ) {
    return { width: view.getUint32(16), height: view.getUint32(20), mime: 'image/png' };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1];
      if (marker === 216 || marker === 1) {
        offset += 2;
        continue;
      }
      const length = view.getUint16(offset + 2);
      if (length < 2) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
          mime: 'image/jpeg',
        };
      }
      offset += 2 + length;
    }
  }
  throw new Error('Не удалось прочитать изображение. Нужен исправный PNG или JPEG.');
}

export function boundedCanvas(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('Неверный размер страницы.');
  const scale = Math.min(
    1,
    OCR_LIMITS.edge / Math.max(width, height),
    Math.sqrt(OCR_LIMITS.canvasPixels / (width * height)),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
