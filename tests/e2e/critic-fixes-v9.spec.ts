import { test, expect } from '@playwright/test';
import type { Financials } from '../../shared/types';
import { loginUI, noOverflow } from './helpers';

test('C01 navigator whole-ruble amount passes the first wizard step unchanged', async ({
  page,
}) => {
  await loginUI(page);
  await page.goto('/products');
  const navigator = page.locator('.financing-navigator');
  await navigator
    .getByLabel('Задача для кредитного навигатора', { exact: true })
    .fill('Нужно 1 234 567 рублей на закупку материалов на 24 месяца');
  await navigator.getByRole('button', { name: 'Разобрать задачу', exact: true }).click();
  await expect(navigator.getByLabel('Сумма навигатора', { exact: true })).toHaveValue('1234567');
  await navigator
    .getByRole('button', { name: 'Проверить параметры черновика', exact: true })
    .click();
  await navigator
    .getByRole('checkbox', {
      name: 'Проверил продукт, сумму, срок и назначение кредита',
      exact: true,
    })
    .check();
  await navigator.getByRole('button', { name: 'Открыть заполненную анкету', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Сумма, ₽', exact: true })).toHaveValue(
    '1234567',
  );
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Финансовая картина', exact: true }),
  ).toBeVisible();
});

test('C02 calculator receives current wizard parameters and Back restores the unsaved step and fields', async ({
  page,
}) => {
  await loginUI(page);
  const originalProfile = await (await page.request.get('/api/business-profile')).json();
  const originalApplications = await (await page.request.get('/api/applications')).json();
  await page.goto('/applications/new');
  const purpose = 'Закупка станка с сохранением введённых данных';
  await page.getByRole('spinbutton', { name: 'Сумма, ₽', exact: true }).fill('2700000');
  await page.getByRole('spinbutton', { name: 'Срок, месяцев', exact: true }).fill('24');
  await page.getByLabel('Цель финансирования', { exact: true }).fill(purpose);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Выручка в месяц, ₽', exact: true }).fill('3300000');
  const financials: Financials = {
    monthlyRevenue: 3300000,
    monthlyExpenses: originalProfile.organization.monthlyExpenses,
    monthlyDebtPayment: originalProfile.organization.monthlyDebtPayment,
  };
  const requests: {
    amount: number;
    termMonths: number;
    productId: string;
    financials: Financials;
  }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/scenario')
      requests.push(request.postDataJSON());
  });
  await page.getByRole('link', { name: 'Открыть репетицию', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Параметры из анкеты', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Сколько нужно бизнесу', { exact: true })).toHaveValue('2700000');
  await expect(page.getByLabel('На какой срок', { exact: true })).toHaveValue('24');
  await expect(
    page.getByRole('button', { name: 'Создать заявку с этими условиями', exact: true }),
  ).toBeEnabled();
  expect(requests.length).toBeGreaterThanOrEqual(2);
  for (const request of requests) {
    expect(request).toMatchObject({ amount: 2700000, productId: 'working_capital', financials });
    expect([24, 36]).toContain(request.termMonths);
  }
  await expect(page.getByRole('region', { name: 'Источник параметров расчёта' })).toContainText(
    '3 300 000',
  );
  expect(await (await page.request.get('/api/business-profile')).json()).toEqual(originalProfile);
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Финансовая картина', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('spinbutton', { name: 'Выручка в месяц, ₽', exact: true }),
  ).toHaveValue('3300000');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Сумма, ₽', exact: true })).toHaveValue(
    '2700000',
  );
  await expect(page.getByLabel('Цель финансирования', { exact: true })).toHaveValue(purpose);
  await page.getByRole('link', { name: 'Открыть репетицию', exact: true }).click();
  await page.getByRole('button', { name: 'Создать заявку с этими условиями', exact: true }).click();
  await expect(page.getByLabel('Цель финансирования', { exact: true })).toHaveValue(purpose);
  await expect(page.getByRole('spinbutton', { name: 'Сумма, ₽', exact: true })).toHaveValue(
    '2700000',
  );
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Выручка в месяц, ₽', exact: true }),
  ).toHaveValue('3300000');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('.wizard input[type=checkbox]')).not.toBeChecked();
  expect(await (await page.request.get('/api/business-profile')).json()).toEqual(originalProfile);
  expect(await (await page.request.get('/api/applications')).json()).toEqual(originalApplications);
});

test('C04 payment gauge states 284 percent and never invents a ratio with no free cash', async ({
  page,
}) => {
  await loginUI(page);
  await page.goto('/applications/new');
  await page.getByRole('spinbutton', { name: 'Сумма, ₽', exact: true }).fill('10000000');
  await page.getByRole('spinbutton', { name: 'Срок, месяцев', exact: true }).fill('6');
  await page
    .getByLabel('Цель финансирования', { exact: true })
    .fill('Проверка предельной нагрузки');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Выручка в месяц, ₽', exact: true }).fill('2400000');
  await page
    .getByRole('spinbutton', { name: 'Операционные расходы, ₽', exact: true })
    .fill('1650000');
  await page
    .getByRole('spinbutton', { name: 'Текущие кредитные платежи, ₽', exact: true })
    .fill('120000');
  await page.getByRole('link', { name: 'Открыть репетицию', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Создать заявку с этими условиями', exact: true }),
  ).toBeEnabled();
  const gauge = page.locator('.cash-gauge');
  await expect(gauge.getByRole('img')).toHaveAttribute(
    'aria-label',
    'Кредитный платёж займёт 284% свободных денег',
  );
  await expect(gauge.locator('text').first()).toHaveText('284%');
  await expect(gauge.locator('.gauge-fill')).toHaveAttribute('stroke-dasharray', '100 100');
  for (const revenue of ['1770000', '0']) {
    await page.goBack();
    await expect(
      page.getByRole('heading', { name: 'Финансовая картина', exact: true }),
    ).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Выручка в месяц, ₽', exact: true }).fill(revenue);
    await page.getByRole('link', { name: 'Открыть репетицию', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Создать заявку с этими условиями', exact: true }),
    ).toBeEnabled();
    await expect(gauge.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Свободного денежного потока нет: доля платежа не рассчитывается',
    );
    await expect(gauge.locator('text').first()).toHaveText('—');
    await expect(gauge.locator('.gauge-fill')).toHaveAttribute('stroke-dasharray', '0 100');
    await expect(gauge).not.toContainText('%');
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
});

test('C05 Ctrl K accepts immediate typing, names the dialog and restores focus on Escape', async ({
  page,
}) => {
  await loginUI(page);
  const trigger = page.locator('.search-trigger');
  await trigger.focus();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('древесина');
  const dialog = page.getByRole('dialog', { name: 'Поиск по кабинету', exact: true });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('textbox', { name: 'Поисковый запрос', exact: true });
  await expect(input).toHaveValue('древесина');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('кредит');
  await expect(input).toHaveValue('кредит');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
