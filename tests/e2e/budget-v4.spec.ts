import { expect, test } from '@playwright/test';
import { loginUI, noOverflow, screenshot } from './helpers';

test('comfortable payment uses the exact budget and transfers stressed financials to a draft', async ({
  page,
}, info) => {
  await loginUI(page);
  await page.goto('/simulator');
  await page.getByRole('button', { name: /От комфортного платежа/ }).click();
  await page.getByLabel('Продукт расчёта', { exact: true }).selectOption('equipment');
  await page.getByLabel('На какой срок', { exact: true }).fill('36');
  await page.getByLabel('Комфортный платёж в месяц', { exact: true }).fill('120000');
  await page.getByLabel('Оставлять свободно каждый месяц', { exact: true }).fill('300000');
  await page.getByRole('button', { name: '−10%', exact: true }).click();
  const transfer = page.getByRole('button', { name: 'Перенести в расчёт', exact: true });
  await expect(transfer).toBeEnabled();
  const response = await page.request.post('/api/scenario/affordability', {
    data: {
      productId: 'equipment',
      termMonths: 36,
      comfortablePayment: 120000,
      monthlyReserve: 300000,
      financials: { monthlyRevenue: 2160000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
    },
  });
  expect(response.ok()).toBeTruthy();
  const budget = await response.json();
  expect(budget.effectivePaymentLimit).toBe(90000);
  expect(Number((await page.locator('.budget-amount').innerText()).replace(/\D/g, ''))).toBe(
    budget.suggestion.amount,
  );
  expect(budget.minimumRemainingCash).toBeGreaterThanOrEqual(300000);
  await screenshot(page, info, 'budget-equipment-reserve');
  await transfer.click();
  await expect(page.getByLabel('Сколько нужно бизнесу', { exact: true })).toHaveValue(
    String(budget.suggestion.amount),
  );
  await page.getByRole('button', { name: 'Создать заявку с этими условиями', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: /^Сумма/ })).toHaveValue(
    String(budget.suggestion.amount),
  );
  await expect(page.getByRole('spinbutton', { name: /^Срок/ })).toHaveValue('36');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: /Выручка/ })).toHaveValue('2160000');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Сохранить и перейти к документам', exact: true }).click();
  await expect(page).toHaveURL(/\/applications\/app_/);
  const detail = await (
    await page.request.get(`/api/applications/${page.url().split('/').pop()}`)
  ).json();
  expect(detail.application).toMatchObject({
    status: 'draft',
    productId: 'equipment',
    amount: budget.suggestion.amount,
    termMonths: 36,
    financials: { monthlyRevenue: 2160000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
  });
});

test('changed or failed budget calculations cannot be transferred; recovery and empty budget are explicit', async ({
  page,
}) => {
  await loginUI(page);
  await page.goto('/simulator');
  await page.getByRole('button', { name: /От комфортного платежа/ }).click();
  const transfer = page.getByRole('button', { name: 'Перенести в расчёт', exact: true });
  await expect(transfer).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/scenario/affordability', async (route) => {
    await gate;
    await route.fulfill({
      status: 503,
      json: { error: { message: 'Расчёт бюджета временно недоступен.' } },
    });
  });
  await page.getByLabel('Комфортный платёж в месяц', { exact: true }).fill('130000');
  await expect(transfer).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toContainText('Расчёт бюджета временно недоступен');
  await expect(transfer).toHaveCount(0);
  await page.unroute('**/api/scenario/affordability');
  await page.getByRole('button', { name: 'Повторить расчёт бюджета', exact: true }).click();
  await expect(transfer).toBeEnabled();
  await page.getByLabel('Оставлять свободно каждый месяц', { exact: true }).fill('630000');
  await expect(
    page.getByRole('heading', { name: 'В этот бюджет сумма не помещается', exact: true }),
  ).toBeVisible();
  await expect(transfer).toHaveCount(0);
  await expect(page.getByText('Сейчас доступно', { exact: false })).toContainText('0');
});

test('budget controls and explanation fit 1440, 390 and 320 pixel viewports', async ({
  page,
}, info) => {
  await loginUI(page);
  await page.goto('/simulator');
  await page.getByRole('button', { name: /От комфортного платежа/ }).click();
  await expect(page.getByRole('button', { name: 'Перенести в расчёт', exact: true })).toBeEnabled();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width > 1000 ? 1000 : 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width + 1);
    await noOverflow(page);
    await screenshot(page, info, `budget-${width}`);
  }
});
