import { test, expect, type Page } from '@playwright/test';
import { noOverflow, screenshot } from './helpers';

async function login(page: Page) {
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { email: 'owner@sever.example.test', password: 'Demo2026!' },
      })
    ).ok(),
  ).toBeTruthy();
}
async function applications(page: Page) {
  const response = await page.request.get('/api/applications');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).applications;
}

test('plain language produces a reviewed equipment form while analysis and preparation create no application', async ({
  page,
}) => {
  await login(page);
  await page.goto('/products');
  const before = await applications(page);
  const navigator = page.locator('.financing-navigator');
  const request = 'Нужно 3 миллиона на трактор на 3 года';
  await navigator.getByLabel('Задача для кредитного навигатора', { exact: true }).fill(request);
  await navigator.getByRole('button', { name: 'Разобрать задачу', exact: true }).click();
  await expect(navigator.getByLabel('Продукт навигатора', { exact: true })).toHaveValue(
    'equipment',
  );
  await expect(navigator.getByLabel('Сумма навигатора', { exact: true })).toHaveValue('3000000');
  await expect(navigator.getByLabel('Срок навигатора', { exact: true })).toHaveValue('36');
  await expect(navigator.getByLabel('Цель кредита из навигатора', { exact: true })).toHaveValue(
    request,
  );
  expect(await applications(page)).toEqual(before);
  await navigator
    .getByRole('button', { name: 'Проверить параметры черновика', exact: true })
    .click();
  const open = navigator.getByRole('button', { name: 'Открыть заполненную анкету', exact: true });
  await expect(open).toBeDisabled();
  expect(await applications(page)).toEqual(before);
  await navigator
    .getByRole('checkbox', {
      name: 'Проверил продукт, сумму, срок и назначение кредита',
      exact: true,
    })
    .focus();
  await page.keyboard.press('Space');
  await expect(open).toBeEnabled();
  await open.click();
  await expect(page).toHaveURL(/\/applications\/new\?product=equipment&amount=3000000&term=36$/);
  await expect(page.getByRole('combobox', { name: 'Кредитный продукт', exact: true })).toHaveValue(
    'equipment',
  );
  await expect(page.getByRole('spinbutton', { name: 'Сумма, ₽', exact: true })).toHaveValue(
    '3000000',
  );
  await expect(page.getByRole('spinbutton', { name: 'Срок, месяцев', exact: true })).toHaveValue(
    '36',
  );
  await expect(page.getByLabel('Цель финансирования', { exact: true })).toHaveValue(request);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  const profile = await (await page.request.get('/api/business-profile')).json();
  await expect(
    page.getByRole('spinbutton', { name: 'Выручка в месяц, ₽', exact: true }),
  ).toHaveValue(String(profile.organization.monthlyRevenue));
  await expect(
    page.getByRole('spinbutton', { name: 'Операционные расходы, ₽', exact: true }),
  ).toHaveValue(String(profile.organization.monthlyExpenses));
  await expect(
    page.getByRole('spinbutton', { name: 'Текущие кредитные платежи, ₽', exact: true }),
  ).toHaveValue(String(profile.organization.monthlyDebtPayment));
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('.wizard input[type=checkbox]')).not.toBeChecked();
  expect(await applications(page)).toEqual(before);
});

test('ambiguous amounts require a choice and any changed input invalidates the prepared navigation', async ({
  page,
}, info) => {
  await login(page);
  await page.request.patch('/api/preferences', { data: { theme: 'light' } });
  await page.goto('/products');
  const navigator = page.locator('.financing-navigator');
  await navigator
    .getByLabel('Задача для кредитного навигатора', { exact: true })
    .fill('Нужно 2 млн или 3 млн на трактор на 3 года');
  await navigator.getByRole('button', { name: 'Разобрать задачу', exact: true }).click();
  await expect(navigator).toContainText('В запросе несколько сумм или диапазон.');
  const amount = navigator.getByLabel('Сумма навигатора', { exact: true });
  await expect(amount).toHaveValue('');
  const prepare = navigator.getByRole('button', {
    name: 'Проверить параметры черновика',
    exact: true,
  });
  await expect(prepare).toBeDisabled();
  await amount.fill('3000000');
  await prepare.click();
  const checkbox = navigator.getByRole('checkbox', {
    name: 'Проверил продукт, сумму, срок и назначение кредита',
    exact: true,
  });
  await checkbox.check();
  await expect(
    navigator.getByRole('button', { name: 'Открыть заполненную анкету', exact: true }),
  ).toBeEnabled();
  await amount.fill('2500000');
  await expect(
    navigator.getByRole('button', { name: 'Открыть заполненную анкету', exact: true }),
  ).toHaveCount(0);
  await expect(
    navigator.getByText('Параметры изменились — проверьте расчёт ещё раз.', { exact: true }),
  ).toBeVisible();
  await prepare.click();
  await expect(checkbox).not.toBeChecked();
  await expect(
    navigator.getByRole('button', { name: 'Открыть заполненную анкету', exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 740 });
  await navigator.scrollIntoViewIfNeeded();
  await noOverflow(page);
  await screenshot(page, info, 'navigator-320-light');
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await noOverflow(page);
  await screenshot(page, info, 'navigator-320-dark');
  await navigator
    .getByLabel('Задача для кредитного навигатора', { exact: true })
    .fill('Нужно 4 млн на новый трактор на 4 года');
  await expect(navigator.getByText('Запрос изменился.', { exact: false })).toBeVisible();
  await expect(
    navigator.getByRole('button', { name: 'Открыть заполненную анкету', exact: true }),
  ).toHaveCount(0);
  await page.request.patch('/api/preferences', { data: { theme: 'light' } });
});

test('a failed repeated preparation discards the previously confirmed draft and cannot reopen it', async ({
  page,
}) => {
  await login(page);
  await page.goto('/products');
  const before = await applications(page);
  const navigator = page.locator('.financing-navigator');
  await navigator
    .getByLabel('Задача для кредитного навигатора', { exact: true })
    .fill('Нужно 3 миллиона на трактор на 3 года');
  await navigator.getByRole('button', { name: 'Разобрать задачу', exact: true }).click();
  const prepare = navigator.getByRole('button', {
    name: 'Проверить параметры черновика',
    exact: true,
  });
  await prepare.click();
  const summary = navigator.locator('.navigator-prepared');
  const checkbox = navigator.getByRole('checkbox', {
    name: 'Проверил продукт, сумму, срок и назначение кредита',
    exact: true,
  });
  const open = navigator.getByRole('button', { name: 'Открыть заполненную анкету', exact: true });
  await expect(summary).toBeVisible();
  await checkbox.check();
  await expect(open).toBeEnabled();

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/navigator/prepare', async (route) => {
    await gate;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'PROFILE_VERSION_CONFLICT',
          message: 'Профиль изменился. Разберите запрос заново перед подготовкой черновика.',
        },
      }),
    });
  });
  try {
    await prepare.click();
    await expect(prepare).toBeDisabled();
    await expect(summary).toHaveCount(0);
    await expect(checkbox).toHaveCount(0);
    await expect(open).toHaveCount(0);
  } finally {
    release();
  }
  await expect(navigator.getByRole('alert')).toHaveText(
    'Профиль изменился. Разберите запрос заново перед подготовкой черновика.',
  );
  await expect(prepare).toBeEnabled();
  await expect(summary).toHaveCount(0);
  await expect(checkbox).toHaveCount(0);
  await expect(open).toHaveCount(0);
  expect(await applications(page)).toEqual(before);
  await navigator.getByLabel('Сумма навигатора', { exact: true }).fill('2500000');
  await expect(summary).toHaveCount(0);
  await expect(open).toHaveCount(0);
});
