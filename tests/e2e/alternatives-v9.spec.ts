import { test, expect, type Page } from '@playwright/test';
import type { AlternativesResponse } from '../../shared/alternatives';
import { apiApplication, getDetail, noOverflow } from './helpers';

const input = {
  productId: 'working_capital',
  amount: 1200000,
  termMonths: 24,
  purpose: 'Материалы для нового производственного заказа',
  consent: true,
  financials: { monthlyRevenue: 2400000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
};
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
  const response = await page.request.post('/api/applications', { data: input });
  expect(response.status()).toBe(201);
  return (await response.json()).application.id as string;
}
async function applicationIds(page: Page) {
  return (
    (await (await page.request.get('/api/applications')).json()).applications as { id: string }[]
  )
    .map((item) => item.id)
    .sort();
}

test('alternative selection needs confirmation and only opens an unsaved draft with no consent', async ({
  page,
}) => {
  await login(page);
  const id = await draft(page);
  const before = await applicationIds(page);
  const original = await getDetail(page, id);
  const result = (await (
    await page.request.get(`/api/applications/${id}/alternatives`)
  ).json()) as AlternativesResponse;
  await page.goto(`/applications/${id}#financing-alternatives`);
  const section = page.locator('#financing-alternatives');
  await expect(
    section.getByRole('heading', { name: 'Сравнить варианты финансирования' }),
  ).toBeVisible();
  await section.getByRole('button', { name: 'Выбрать для новой анкеты' }).first().click();
  await expect(
    section.getByRole('button', { name: 'Открыть новую анкету', exact: true }),
  ).toBeDisabled();
  await section
    .getByRole('checkbox', { name: /Проверил сумму, срок, проценты и ограничения/ })
    .check();
  await section.getByRole('button', { name: 'Открыть новую анкету', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/applications/new\\?product=working_capital&amount=${result.options[0].draft.amount}&term=${result.options[0].draft.termMonths}`,
    ),
  );
  await expect(page.locator('#new-amount')).toHaveValue(String(result.options[0].draft.amount));
  await expect(page.locator('#new-term')).toHaveValue(String(result.options[0].draft.termMonths));
  await expect(page.locator('#new-purpose')).toHaveValue(input.purpose);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: /Подтверждаю использование вымышленных данных/ }),
  ).not.toBeChecked();
  expect(await applicationIds(page)).toEqual(before);
  expect((await getDetail(page, id)).application).toEqual(original.application);
});

test('alternative is rechecked before opening and a concurrently changed application cancels confirmation', async ({
  page,
}) => {
  await login(page);
  const id = await draft(page);
  await page.goto(`/applications/${id}#financing-alternatives`);
  const section = page.locator('#financing-alternatives');
  await section.getByRole('button', { name: 'Выбрать для новой анкеты' }).first().click();
  await section
    .getByRole('checkbox', { name: /Проверил сумму, срок, проценты и ограничения/ })
    .check();
  const original = await getDetail(page, id);
  const changed = await page.request.patch(`/api/applications/${id}`, {
    data: { version: original.application.version, purpose: 'Материалы для изменённого заказа' },
  });
  expect(changed.ok()).toBeTruthy();
  const before = await applicationIds(page);
  await section.getByRole('button', { name: 'Открыть новую анкету', exact: true }).click();
  await expect(section.getByRole('alert')).toHaveText(
    'Данные или условия изменились. Выберите и проверьте вариант заново.',
  );
  await expect(page).toHaveURL(new RegExp(`/applications/${id}`));
  await expect(section.getByRole('checkbox')).toHaveCount(0);
  await expect(
    section.getByRole('button', { name: 'Выбрать для новой анкеты' }).first(),
  ).toBeEnabled();
  expect(await applicationIds(page)).toEqual(before);
});

test('comparison remains readable at 320px in dark reduced motion and bank sees the submitted data without draft actions', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await login(page);
  const preferences = await (await page.request.get('/api/preferences')).json();
  try {
    expect(
      (
        await page.request.patch('/api/preferences', {
          data: { ...preferences, theme: 'dark', reducedMotion: true },
        })
      ).ok(),
    ).toBeTruthy();
    const id = await apiApplication(page);
    await page.goto(`/applications/${id}#financing-alternatives`);
    const section = page.locator('#financing-alternatives');
    await expect(section.locator('.alternative-option')).toHaveCount(2);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await section.getByText('Данные, правила и ограничения расчёта', { exact: true }).click();
    await expect(section.getByText(/Используется сохранённый снимок профиля заявки/)).toBeVisible();
    await noOverflow(page);
    await section
      .locator('.alternative-option')
      .first()
      .screenshot({ path: info.outputPath('alternative-320-dark.png'), animations: 'disabled' });
    await login(page, true);
    await page.reload();
    await expect(section.locator('.alternative-option')).toHaveCount(2);
    await expect(section.getByRole('button', { name: 'Выбрать для новой анкеты' })).toHaveCount(0);
    await noOverflow(page);
  } finally {
    await login(page);
    expect((await page.request.patch('/api/preferences', { data: preferences })).ok()).toBeTruthy();
  }
});
