export const documentLabels: Record<string, string> = {
  statement: 'Выписка по счёту',
  financials: 'Финансовая отчётность',
  invoice: 'Счёт на оборудование',
  other: 'Дополнительный документ',
  contract: 'Демо-договор',
};
export const normalizeSearch = (value: string) =>
  value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
