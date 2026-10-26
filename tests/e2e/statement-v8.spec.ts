import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { StatementReport } from '../../shared/statements';
import { STATEMENT_HEADER } from '../../shared/statements';
import { getDetail, noOverflow, screenshot } from './helpers';

const financials = {
  monthlyRevenue: 2400000,
  monthlyExpenses: 1650000,
  monthlyDebtPayment: 120000,
};
const csv = [
  STATEMENT_HEADER,
  '2026-08-05;in;1500000;buyer-a;Покупатель А;revenue;A-001',
  '2026-08-12;in;500000;buyer-b;Покупатель Б;revenue;B-001',
  '2026-08-20;out;1400000;supplier;Поставщик;expense;S-001',
  '2026-08-25;out;100000;lender;Кредитор;debt;D-001',
  '2026-09-05;in;2000000;buyer-a;Покупатель А;revenue;A-002',
  '2026-09-12;in;1000000;buyer-b;Покупатель Б;revenue;B-002',
  '2026-09-20;out;1600000;supplier;Поставщик;expense;S-002',
  '2026-09-25;out;100000;lender;Кредитор;debt;D-002',
  '2026-09-18;in;900000;self;Свой счёт;transfer;T-001',
  '2026-08-05;in;1500000;buyer-a;Покупатель А;revenue;A-001',
].join('\n');

async function login(page: Page, bank = false) {
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: {
          email: bank ? 'bank@debitus.example.test' : 'owner@sever.example.test',
          password: 'Demo2026!',
        },
      })
    ).ok(),
  ).toBeTruthy();
}
async function draft(page: Page) {
  const response = await page.request.post('/api/applications', {
    data: {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      purpose: 'Проверка банковской выписки',
      financials,
      consent: true,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).application.id as string;
}
async function source(page: Page, text = csv, period = { from: '2026-08-01', to: '2026-09-30' }) {
  await page.getByLabel('Начало периода выписки', { exact: true }).fill(period.from);
  await page.getByLabel('Конец периода выписки', { exact: true }).fill(period.to);
  await page
    .getByLabel('CSV банковской выписки', { exact: true })
    .setInputFiles({ name: 'transactions.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  await expect(page.getByLabel('Содержимое выписки CSV', { exact: true })).toHaveValue(text);
}
async function getReport(page: Page, id: string) {
  const response = await page.request.get(`/api/applications/${id}/statement`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).report as StatementReport | null;
}

test('reviewed statement preserves source and averages, changes only chosen fields and reaches the bank unchanged', async ({
  page,
}, info) => {
  await login(page);
  await page.request.patch('/api/preferences', { data: { theme: 'light' } });
  const id = await draft(page);
  await page.goto(`/applications/${id}`);
  const workbench = page.locator('.statement-workbench');
  await workbench.getByRole('button', { name: 'Загрузить выписку CSV', exact: true }).click();
  await workbench.getByRole('button', { name: 'Заполнить пример', exact: true }).click();
  await expect(page.getByLabel('Содержимое выписки CSV', { exact: true })).toHaveValue(/revenue/);
  const sourceCsv = '\uFEFF' + csv;
  await source(page, sourceCsv);
  const before = await getDetail(page, id);
  await workbench.getByRole('button', { name: 'Проанализировать выписку', exact: true }).click();
  await expect(workbench.getByText('Предварительный анализ', { exact: false })).toBeVisible();
  await expect(workbench.getByText('Повторные операции исключены', { exact: true })).toBeVisible();
  await expect(workbench.getByText('Поступления заметно выросли', { exact: true })).toBeVisible();
  expect(await getReport(page, id)).toBeNull();
  expect((await getDetail(page, id)).application).toEqual(before.application);
  expect((await getDetail(page, id)).documents).toHaveLength(0);
  const save = workbench.getByRole('button', { name: 'Сохранить отчёт в заявку', exact: true });
  await expect(save).toBeDisabled();
  const review = workbench.getByRole('checkbox', { name: /Проверил период/ });
  await review.focus();
  await page.keyboard.press('Space');
  await expect(review).toBeChecked();
  await save.click();
  await expect(workbench.locator('.statement-hash')).toContainText('SHA-256:');
  const report = (await getReport(page, id))!;
  expect(report.sourceSha256).toBe(
    createHash('sha256').update(Buffer.from(sourceCsv)).digest('hex'),
  );
  expect(report.applicationVersion).toBe(before.application.version + 1);
  expect(report.analysis.averageMonthlyRevenue).toBe(2500000);
  expect(report.analysis.averageMonthlyExpenses).toBe(1500000);
  expect(report.analysis.averageMonthlyDebtPayment).toBe(100000);
  expect(report.analysis.totals.revenue).toBe(5000000);
  expect(report.analysis.uniqueRows).toBe(9);
  expect((await getDetail(page, id)).application.financials).toEqual(financials);
  const original = await page.request.get(`/api/documents/${report.documentId}/download`);
  expect(await original.body()).toEqual(Buffer.from(sourceCsv));
  const downloadEvent = page.waitForEvent('download');
  await workbench.getByRole('button', { name: 'Отчёт JSON', exact: true }).click();
  const downloaded = await downloadEvent;
  expect(JSON.parse(await readFile((await downloaded.path())!, 'utf8'))).toEqual(report);

  const apply = workbench.locator('.statement-apply');
  await apply.locator('summary').focus();
  await page.keyboard.press('Enter');
  const applyButton = apply.getByRole('button', { name: 'Применить выбранные суммы', exact: true });
  await expect(applyButton).toBeDisabled();
  await apply.getByRole('checkbox', { name: /^Выручка:/ }).check();
  await applyButton.click();
  await expect(
    workbench.getByText('Анкета изменилась после анализа.', { exact: false }),
  ).toBeVisible();
  expect((await getDetail(page, id)).application.financials).toEqual({
    ...financials,
    monthlyRevenue: 2500000,
  });
  expect(await getReport(page, id)).toEqual(report);
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
  await workbench
    .getByRole('heading', { name: 'Что показывает выписка', exact: true })
    .scrollIntoViewIfNeeded();
  await screenshot(page, info, 'statement-320-light');
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await noOverflow(page);
  await screenshot(page, info, 'statement-320-dark');
  await page.getByRole('button', { name: 'Включить светлую тему', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post(`/api/applications/${id}/documents/sample`, {
        data: { category: 'financials' },
      })
    ).ok(),
  ).toBeTruthy();
  const current = await getDetail(page, id);
  expect(
    (
      await page.request.post(`/api/applications/${id}/actions/submit`, {
        data: { version: current.application.version },
      })
    ).ok(),
  ).toBeTruthy();
  await login(page, true);
  await page.goto(`/applications/${id}`);
  await expect(workbench.locator('.statement-hash')).toContainText(report.sourceSha256);
  expect(await getReport(page, id)).toEqual(report);
  await expect(
    workbench.getByRole('button', { name: /Загрузить выписку|Разобрать другую/ }),
  ).toHaveCount(0);
  await expect(workbench.locator('.statement-apply')).toHaveCount(0);
});

test('partial statement periods show no extrapolated averages and edited previews require review again', async ({
  page,
}) => {
  await login(page);
  const id = await draft(page);
  await page.goto(`/applications/${id}`);
  const workbench = page.locator('.statement-workbench');
  await workbench.getByRole('button', { name: 'Загрузить выписку CSV', exact: true }).click();
  const partialCsv = `${STATEMENT_HEADER}\n2026-08-05;in;1200000;buyer;Покупатель;revenue;P-001`;
  await source(page, partialCsv, { from: '2026-08-02', to: '2026-08-30' });
  await workbench.getByRole('button', { name: 'Проанализировать выписку', exact: true }).click();
  await expect(workbench.getByText('нет полных месяцев', { exact: true })).toBeVisible();
  await workbench.getByRole('checkbox', { name: /Проверил период/ }).check();
  await page
    .getByLabel('Содержимое выписки CSV', { exact: true })
    .fill(partialCsv.replace('1200000', '1300000'));
  await expect(workbench.getByText('Параметры изменились.', { exact: false })).toBeVisible();
  await expect(
    workbench.getByRole('button', { name: 'Сохранить отчёт в заявку', exact: true }),
  ).toHaveCount(0);
  expect(await getReport(page, id)).toBeNull();
  await workbench.getByRole('button', { name: 'Проанализировать выписку', exact: true }).click();
  await expect(
    workbench.getByRole('button', { name: 'Сохранить отчёт в заявку', exact: true }),
  ).toBeDisabled();
  await workbench.getByRole('checkbox', { name: /Проверил период/ }).check();
  await workbench.getByRole('button', { name: 'Сохранить отчёт в заявку', exact: true }).click();
  await expect(workbench.locator('.statement-hash')).toBeVisible();
  const report = (await getReport(page, id))!;
  expect(report.analysis.averageMonthlyRevenue).toBeNull();
  expect(report.analysis.averageMonthlyExpenses).toBeNull();
  expect(report.analysis.averageMonthlyDebtPayment).toBeNull();
  await expect(workbench.locator('.statement-apply')).toHaveCount(0);
  await expect(
    workbench.getByRole('button', { name: 'Проверить остаток по этим суммам', exact: true }),
  ).toHaveCount(0);
  expect((await getDetail(page, id)).application.financials).toEqual(financials);
});

test('saved statement averages prefill cashflow assumptions without confirming or calculating them', async ({
  page,
}) => {
  await login(page);
  const id = await draft(page);
  const saved = await page.request.post(`/api/applications/${id}/statement`, {
    data: {
      version: 1,
      csv,
      sourceName: 'transactions.csv',
      period: { from: '2026-08-01', to: '2026-09-30' },
      reviewed: true,
    },
  });
  expect(saved.status()).toBe(201);
  await page.goto(`/applications/${id}`);
  await page.getByRole('button', { name: 'Проверить остаток по этим суммам', exact: true }).click();
  await expect(page).toHaveURL(/\/simulator#cashflow-planner$/);
  const planner = page.locator('.cashflow-planner');
  await expect(
    planner.getByRole('spinbutton', { name: 'Поступления в обычный месяц, ₽', exact: true }),
  ).toHaveValue('2500000');
  await expect(
    planner.getByRole('spinbutton', { name: 'Операционные выплаты в месяц, ₽', exact: true }),
  ).toHaveValue('1500000');
  await expect(
    planner.getByRole('spinbutton', { name: 'Действующие кредиты в месяц, ₽', exact: true }),
  ).toHaveValue('100000');
  await expect(planner).toContainText('Из сохранённого отчёта выписки');
  await expect(planner.getByRole('checkbox')).not.toBeChecked();
  await expect(
    planner.getByRole('button', { name: 'Сравнить денежный поток', exact: true }),
  ).toBeDisabled();
  await expect(planner.getByRole('button', { name: 'Скачать прогноз CSV', exact: true })).toBeDisabled();
  expect((await getDetail(page, id)).application.financials).toEqual(financials);
});
