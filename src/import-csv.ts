import type { ApplicationInput } from '../shared/types';
export const importColumns = [
  'productId',
  'amount',
  'termMonths',
  'purpose',
  'monthlyRevenue',
  'monthlyExpenses',
  'monthlyDebtPayment',
  'consent',
] as const;
export function parseImportCsv(input: string): ApplicationInput[] {
  const text = input.replace(/^\ufeff/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const separator = firstLine.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = '';
      closed = false;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
      closed = false;
    } else if (closed || char === '"')
      throw new Error(`Некорректные кавычки в CSV, строка ${rows.length + 1}.`);
    else cell += char;
  }
  if (quoted) throw new Error('В CSV не закрыты кавычки.');
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  const header = rows.shift()?.map((value) => value.trim()) ?? [];
  if (
    header.length !== importColumns.length ||
    new Set(header).size !== header.length ||
    importColumns.some((name) => !header.includes(name))
  )
    throw new Error(
      `CSV нужен в формате шаблона: ${importColumns.join('; ')}. Обзорная выгрузка CSV не содержит финансовых полей; для полного переноса используйте JSON.`,
    );
  if (!rows.length || rows.length > 20) throw new Error('CSV должен содержать от 1 до 20 заявок.');
  return rows.map((values, index) => {
    if (values.length !== header.length)
      throw new Error(`CSV, строка ${index + 2}: ожидается ${header.length} столбцов.`);
    const source = Object.fromEntries(
      header.map((name, position) => [name, values[position].trim()]),
    );
    const number = (name: string) => {
      if (!/^\d+$/.test(source[name]))
        throw new Error(
          `CSV, строка ${index + 2}: ${name} должен быть целым неотрицательным числом без разделителей.`,
        );
      return Number(source[name]);
    };
    if (!['true', 'false'].includes(source.consent))
      throw new Error(`CSV, строка ${index + 2}: consent должен быть true или false.`);
    return {
      productId: source.productId,
      amount: number('amount'),
      termMonths: number('termMonths'),
      purpose: source.purpose,
      financials: {
        monthlyRevenue: number('monthlyRevenue'),
        monthlyExpenses: number('monthlyExpenses'),
        monthlyDebtPayment: number('monthlyDebtPayment'),
      },
      consent: source.consent === 'true',
    };
  });
}
export function importCsvTemplate() {
  return (
    '\ufeff' +
    importColumns.join(';') +
    '\r\nworking_capital;1200000;24;Закупка материалов;2400000;1650000;120000;true\r\n'
  );
}
