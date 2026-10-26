import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CashflowResult } from '../../shared/cashflow';
import { loginUI, noOverflow } from './helpers';

const rubles = (value: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);

async function openPlanner(page: Page) {
  await loginUI(page);
  await page.goto('/simulator');
  const planner = page.locator('.cashflow-planner');
  await expect(
    planner.getByRole('heading', { name: 'Что будет с деньгами', exact: true }),
  ).toBeVisible();
  return planner;
}

async function setInputs(planner: Locator) {
  await planner.getByLabel('Первый месяц', { exact: true }).fill('2026-12');
  await planner.getByRole('spinbutton', { name: 'Деньги на начало, ₽', exact: true }).fill('5000');
  await planner
    .getByRole('spinbutton', { name: 'Поступления в обычный месяц, ₽', exact: true })
    .fill('10000');
  await planner
    .getByRole('spinbutton', { name: 'Операционные выплаты в месяц, ₽', exact: true })
    .fill('7000');
  await planner
    .getByRole('spinbutton', { name: 'Действующие кредиты в месяц, ₽', exact: true })
    .fill('1000');
  await planner
    .getByRole('spinbutton', { name: 'Разовая покупка, ₽', exact: true })
    .fill('1500000');
  await planner
    .getByRole('spinbutton', { name: 'Изменение чистого потока в месяц, ₽', exact: true })
    .fill('4000');
  await planner
    .getByRole('spinbutton', { name: 'С какого месяца будет эффект', exact: true })
    .fill('3');
}

async function calculate(page: Page, planner: Locator): Promise<CashflowResult> {
  await planner.getByRole('checkbox').check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/scenario/cashflow') && r.request().method() === 'POST',
  );
  await planner.getByRole('button', { name: 'Сравнить денежный поток', exact: true }).click();
  const actual = await response;
  expect(actual.ok(), await actual.text()).toBeTruthy();
  const result = (await actual.json()) as CashflowResult;
  await expect(
    planner.getByRole('button', { name: 'Скачать прогноз CSV', exact: true }),
  ).toBeEnabled();
  return result;
}

test('cashflow confirmation, both accounting paths, keyboard selection and reproducible CSV stay consistent', async ({
  page,
}, info) => {
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scenario/cashflow')) requests++;
  });
  const planner = await openPlanner(page);
  const profileBefore = await (await page.request.get('/api/business-profile')).json();
  await expect(
    planner.getByRole('button', { name: 'Сравнить денежный поток', exact: true }),
  ).toBeDisabled();
  await expect(
    planner.getByRole('button', { name: 'Скачать прогноз CSV', exact: true }),
  ).toBeDisabled();
  await expect(planner.locator('svg')).toHaveCount(0);
  await setInputs(planner);
  expect(requests).toBe(0);
  const result = await calculate(page, planner);
  expect(requests).toBe(1);
  expect(result.rows[0].inflow).toBe(10000);
  expect(result.rows[0].loanProceeds).toBe(1500000);
  expect(result.rows[0].investmentOutflow).toBe(1500000);
  expect(result.rows[0].loanPayment).toBe(0);
  expect(result.rows[0].noLoan.endingBalance).toBe(7000);
  expect(result.rows[0].withLoan.endingBalance).toBe(7000);
  expect(result.rows[1].withLoan.endingBalance).toBe(9000 - result.rows[1].loanPayment);
  await expect(planner.locator('.cashflow-readout dd').nth(0)).toHaveText(rubles(7000));
  await expect(planner.locator('.cashflow-readout dd').nth(1)).toHaveText(rubles(7000));
  const months = planner.getByRole('group', { name: 'Выберите месяц графика' }).getByRole('button');
  await months.nth(1).focus();
  await expect(months.nth(1)).toBeFocused();
  await expect(months.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(planner.locator('.cashflow-readout dd').nth(1)).toHaveText(
    rubles(result.rows[1].withLoan.endingBalance),
  );
  await months.nth(2).hover();
  await expect(months.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(planner.locator('.cashflow-readout dd').nth(1)).toHaveText(
    rubles(result.rows[2].withLoan.endingBalance),
  );
  await planner.getByText('Движение денег по месяцам', { exact: true }).click();
  await expect(planner.locator('tbody tr')).toHaveCount(6);
  await expect(planner.locator('tbody tr').first().locator('td').nth(3)).toHaveText('1 500 000');
  const download = page.waitForEvent('download');
  await planner.getByRole('button', { name: 'Скачать прогноз CSV', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('debitus-cashflow.csv');
  const destination = info.outputPath(file.suggestedFilename());
  await file.saveAs(destination);
  const text = await readFile(destination, 'utf8');
  expect(text).toContain('"Сумма кредита RUB";"1500000"');
  expect(text).toContain('"Сезонность Декабрь, %";"100"');
  expect(text).toContain(
    '"2026-12";"10000";"7000";"1000";"1500000";"1500000";"0";"0";"5000";"2000";"7000";"5000";"2000";"7000"',
  );
  expect(text).toContain(`"Долг после горизонта RUB";"${result.loan.debtAfterHorizon}"`);
  await planner
    .getByRole('spinbutton', { name: 'Изменение чистого потока в месяц, ₽', exact: true })
    .fill('-500');
  await planner
    .getByRole('spinbutton', { name: 'С какого месяца будет эффект', exact: true })
    .fill('1');
  await expect(planner.getByRole('checkbox')).not.toBeChecked();
  await expect(
    planner.getByRole('button', { name: 'Сравнить денежный поток', exact: true }),
  ).toBeDisabled();
  await expect(
    planner.getByRole('button', { name: 'Скачать прогноз CSV', exact: true }),
  ).toBeDisabled();
  await expect(planner.getByRole('status')).toContainText('прежний расчёт');
  const adverse = await calculate(page, planner);
  expect(adverse.rows.every((r) => r.additionalNetCash === -500)).toBeTruthy();
  expect(adverse.rows[0].withLoan.endingBalance).toBe(6500);
  expect(await (await page.request.get('/api/business-profile')).json()).toEqual(profileBefore);
  await noOverflow(page);
});

test('cashflow prevents export of an in-flight stale response and recovers after a server error', async ({
  page,
}) => {
  const planner = await openPlanner(page);
  await setInputs(planner);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted!: () => void;
  const arrived = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route('**/api/scenario/cashflow', async (route) => {
    intercepted();
    await waiting;
    await route.continue();
  });
  await planner.getByRole('checkbox').check();
  await planner.getByRole('button', { name: 'Сравнить денежный поток', exact: true }).click();
  await arrived;
  await expect(
    planner.getByRole('button', { name: 'Считаем движение денег…', exact: true }),
  ).toBeDisabled();
  await planner.getByRole('spinbutton', { name: 'Деньги на начало, ₽', exact: true }).fill('6000');
  release();
  await expect(planner.locator('svg')).toBeVisible();
  await expect(planner.getByRole('status')).toContainText('прежний расчёт');
  await expect(
    planner.getByRole('button', { name: 'Скачать прогноз CSV', exact: true }),
  ).toBeDisabled();
  await page.unroute('**/api/scenario/cashflow');
  await page.route('**/api/scenario/cashflow', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { message: 'Расчёт временно недоступен. Повторите попытку.' },
      }),
    }),
  );
  await planner.getByRole('checkbox').check();
  await planner.getByRole('button', { name: 'Сравнить денежный поток', exact: true }).click();
  await expect(planner.getByRole('alert')).toContainText('Повторите попытку');
  await expect(
    planner.getByRole('button', { name: 'Скачать прогноз CSV', exact: true }),
  ).toBeDisabled();
  await page.unroute('**/api/scenario/cashflow');
  const recovered = await calculate(page, planner);
  expect(recovered.inputs.openingBalance).toBe(6000);
  await expect(planner.getByRole('alert')).toHaveCount(0);
  await expect(planner.getByRole('status')).toHaveCount(0);
});

test('cashflow chart, forms and details fit light and dark themes at 1440 and 320 pixels', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openPlanner(page);
  const preferences = await (await page.request.get('/api/preferences')).json();
  for (const theme of ['light', 'dark']) {
    const changed = await page.request.patch('/api/preferences', {
      data: { ...preferences, theme },
    });
    expect(changed.ok()).toBeTruthy();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const planner = page.locator('.cashflow-planner');
    await setInputs(planner);
    await planner.getByLabel('Горизонт расчёта', { exact: true }).selectOption('12');
    await calculate(page, planner);
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverflow(page);
      await planner.getByText('Сезонность поступлений', { exact: true }).click();
      await noOverflow(page);
      await planner.getByText('Сезонность поступлений', { exact: true }).click();
      await planner.getByText('Движение денег по месяцам', { exact: true }).click();
      await noOverflow(page);
      const table = planner.getByRole('region', {
        name: 'Денежный поток по месяцам, таблица с горизонтальной прокруткой',
      });
      expect(await table.evaluate((e) => e.scrollWidth > e.clientWidth)).toBeTruthy();
      await table.focus();
      await expect(table).toBeFocused();
      await planner.getByText('Движение денег по месяцам', { exact: true }).click();
      await page.evaluate(() => document.fonts.ready);
      await planner.getByRole('heading', { name: 'Что будет с деньгами', exact: true }).click();
      const path = info.outputPath(`cashflow-${theme}-${width}.png`);
      await planner.screenshot({ path, animations: 'disabled' });
      await info.attach(`cashflow-${theme}-${width}`, { path, contentType: 'image/png' });
    }
  }
  await page.request.patch('/api/preferences', { data: preferences });
  expect(errors).toEqual([]);
});
