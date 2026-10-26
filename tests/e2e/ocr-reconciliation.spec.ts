import { test, expect } from '@playwright/test';
import path from 'node:path';
import { getDetail, noOverflow, screenshot } from './helpers';

const financials = {
  monthlyRevenue: 2400000,
  monthlyExpenses: 1650000,
  monthlyDebtPayment: 120000,
};
const row = (page: import('@playwright/test').Page, field: keyof typeof financials) =>
  page.locator(`[data-ocr-field="${field}"]`);

async function login(page: import('@playwright/test').Page) {
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { email: 'owner@sever.example.test', password: 'Demo2026!' },
      })
    ).ok(),
  ).toBeTruthy();
}

test('OCR reconciliation shows every value, resets approvals after edits and applies only selected amounts', async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await login(page);
  await page.goto('/applications/new');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  for (const [name, amount] of [
    ['Выручка в месяц, ₽', financials.monthlyRevenue],
    ['Операционные расходы, ₽', financials.monthlyExpenses],
    ['Текущие кредитные платежи, ₽', financials.monthlyDebtPayment],
  ] as const)
    await page.getByRole('spinbutton', { name, exact: true }).fill(String(amount));
  await page.getByRole('button', { name: 'Распознать документ', exact: true }).click();
  await page
    .getByLabel('Файл для распознавания')
    .setInputFiles(path.resolve('public/fixtures/financial-scan.png'));
  const text = page.getByLabel('Распознанный текст', { exact: true });
  await expect(text).toBeVisible({ timeout: 100000 });
  await expect(page.locator('.ocr-reconciliation-row')).toHaveCount(3);
  for (const field of Object.keys(financials) as (keyof typeof financials)[])
    await expect(row(page, field).locator('.ocr-comparison-status')).toHaveText('Совпадает');

  const amount = page.getByLabel('Распознанная сумма: Выручка в месяц, ₽', { exact: true });
  const selection = page.getByRole('checkbox', { name: 'Выручка в месяц, ₽', exact: true });
  const reviewed = page.getByRole('checkbox', { name: /Я сверил/ });
  await selection.check();
  await reviewed.check();
  await amount.fill('2500000');
  await expect(reviewed).not.toBeChecked();
  await expect(row(page, 'monthlyRevenue').locator('.ocr-comparison-status')).toHaveText(
    'Отличается · ручная правка',
  );
  await expect(row(page, 'monthlyRevenue').locator('.ocr-evidence')).toContainText(/2\s?400\s?000/);
  await expect(row(page, 'monthlyRevenue')).toContainText('2 500 000');
  await reviewed.check();

  await text.fill('Выручка в месяц: 2400000 RUB\nВыручка в месяц: 2500000 RUB');
  await expect(selection).not.toBeChecked();
  await expect(reviewed).not.toBeChecked();
  await expect(amount).toHaveValue('');
  await expect(row(page, 'monthlyRevenue').locator('.ocr-comparison-status')).toHaveText(
    'Нужно уточнить',
  );
  await expect(row(page, 'monthlyExpenses').locator('.ocr-comparison-status')).toHaveText(
    'Не найдено',
  );
  await expect(row(page, 'monthlyDebtPayment').locator('.ocr-comparison-status')).toHaveText(
    'Не найдено',
  );
  await expect(page.getByRole('button', { name: 'Применить к черновику' })).toBeDisabled();

  await text.fill('Выручка за год: 28800000 RUB\nОперационные расходы в месяц: 1650 тыс. руб.');
  await expect(amount).toHaveValue('');
  await expect(row(page, 'monthlyRevenue').locator('.ocr-comparison-status')).toHaveText(
    'Не найдено',
  );
  await amount.fill('2350000');
  await selection.focus();
  await page.keyboard.press('Space');
  await expect(selection).toBeChecked();
  await reviewed.check();
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
  expect(
    await page
      .locator('.ocr-workbench')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBeTruthy();
  await screenshot(page, info, 'ocr-reconciliation-320');
  await page.getByRole('button', { name: 'Применить к черновику' }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Выручка в месяц, ₽', exact: true }),
  ).toHaveValue('2350000');
  await expect(
    page.getByRole('spinbutton', { name: 'Операционные расходы, ₽', exact: true }),
  ).toHaveValue('1650000');
  await expect(
    page.getByRole('spinbutton', { name: 'Текущие кредитные платежи, ₽', exact: true }),
  ).toHaveValue('120000');
});

test('saving reconciled OCR text adds a document without overwriting existing application finances', async ({
  page,
}) => {
  test.setTimeout(150000);
  await login(page);
  const response = await page.request.post('/api/applications', {
    data: {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      purpose: 'Сверка документа с анкетой',
      financials,
      consent: true,
    },
  });
  expect(response.ok()).toBeTruthy();
  const { application } = await response.json();
  await page.goto(`/applications/${application.id}`);
  await page.getByRole('button', { name: 'Распознать документ', exact: true }).click();
  await page
    .getByLabel('Файл для распознавания')
    .setInputFiles(path.resolve('public/fixtures/financial-scan.pdf'));
  const text = page.getByLabel('Распознанный текст', { exact: true });
  await expect(text).toBeVisible({ timeout: 100000 });
  await text.fill('Выручка в месяц: 2700000 RUB');
  await expect(row(page, 'monthlyRevenue').locator('.ocr-comparison-status')).toHaveText(
    'Отличается',
  );
  await expect(row(page, 'monthlyExpenses').locator('.ocr-comparison-status')).toHaveText(
    'Не найдено',
  );
  await expect(
    page.getByText('Сохранение текстовой копии не меняет финансовые данные заявки.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Выручка в месяц, ₽', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('checkbox', { name: /Я сверил/ }).check();
  await page.getByRole('button', { name: 'Сохранить текст в заявку' }).click();
  await expect(page.locator('.ocr-workbench')).not.toBeVisible();
  const detail = await getDetail(page, application.id);
  expect(detail.application.financials).toEqual(financials);
  expect(detail.documents).toHaveLength(1);
  const document = await page.request.get(detail.documents[0].downloadUrl);
  expect(await document.text()).toContain('2700000 RUB');
});
