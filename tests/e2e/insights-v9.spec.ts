import { test, expect, type Page } from '@playwright/test';
import type { BusinessProfileResponse } from '../../shared/types';
import type { ApplicationChanges } from '../../shared/application-changes';
import { apiApplication, getDetail, noOverflow } from './helpers';

const financials = {
  monthlyRevenue: 2400000,
  monthlyExpenses: 1650000,
  monthlyDebtPayment: 120000,
};
async function login(page: Page, role: 'owner' | 'bank' = 'owner') {
  const response = await page.request.post('/api/auth/login', {
    data: {
      email: role === 'bank' ? 'bank@debitus.example.test' : 'owner@sever.example.test',
      password: 'Demo2026!',
    },
  });
  expect(response.ok()).toBeTruthy();
}
async function draft(page: Page, consent = true) {
  const response = await page.request.post('/api/applications', {
    data: {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      purpose: 'Материалы для нового контракта',
      financials,
      consent,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).application.id as string;
}

test('client plan opens its evidence and consent target; reviewed consent persists and removes the required action', async ({
  page,
}, info) => {
  await login(page);
  const preferences = await (await page.request.get('/api/preferences')).json();
  try {
    const id = await draft(page, false);
    await page.request.patch('/api/preferences', { data: { theme: 'light' } });
    await page.goto(`/applications/${id}`);
    const plan = page.locator('.application-action-plan');
    await expect(
      plan.getByRole('heading', { name: 'Что делать дальше', exact: true }),
    ).toBeVisible();
    const documents = plan
      .locator('li.action-plan-item')
      .filter({ hasText: 'Добавьте недостающие документы' });
    await documents.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(documents).toContainText('Текущая анкета');
    await expect(documents).toContainText('версия 1');
    await expect(documents).toContainText('не к проверке показателей');
    await plan.getByRole('link', { name: 'К согласию', exact: false }).click();
    await expect(page).toHaveURL(new RegExp(`/applications/${id}#application-consent$`));
    await expect(page.locator('#application-consent')).toBeFocused();
    const consent = page.locator('#application-consent').getByRole('checkbox');
    await expect(
      page.getByRole('button', { name: 'Отправить заявку', exact: true }),
    ).toBeDisabled();
    const planRoute = `**/api/applications/${id}/action-plan`;
    await page.route(planRoute, (route) => route.abort());
    await consent.click();
    await expect(consent).toBeChecked();
    await expect(plan.getByRole('alert')).toContainText('Нет соединения');
    await expect(plan.locator('.action-plan-link')).toHaveCount(0);
    await page.unroute(planRoute);
    await plan.getByRole('button', { name: 'Повторить загрузку плана', exact: true }).click();
    await expect(
      plan.getByRole('heading', { name: 'Прочитайте и подтвердите условия проверки', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Отправить заявку', exact: true })).toBeEnabled();
    expect((await getDetail(page, id)).application.consent).toBe(true);
    const amountSummary = page
      .locator('.financial-value-source > summary')
      .filter({ hasText: '2' })
      .first();
    await amountSummary.focus();
    await page.keyboard.press('Enter');
    await expect(amountSummary.locator('..')).toContainText(
      'Перенос из OCR или CSV отдельно не отслеживается',
    );
    await page.setViewportSize({ width: 320, height: 740 });
    await plan.scrollIntoViewIfNeeded();
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath('action-plan-320-light.png'),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath('action-plan-320-dark.png'),
      animations: 'disabled',
    });
  } finally {
    await login(page);
    expect((await page.request.patch('/api/preferences', { data: preferences })).ok()).toBeTruthy();
  }
});

test('stale finance action reaches the real company page and focuses its date field', async ({
  page,
}) => {
  await login(page);
  const original = (await (
    await page.request.get('/api/business-profile')
  ).json()) as BusinessProfileResponse;
  const profileFinancials = {
    monthlyRevenue: original.organization.monthlyRevenue,
    monthlyExpenses: original.organization.monthlyExpenses,
    monthlyDebtPayment: original.organization.monthlyDebtPayment,
  };
  try {
    expect(
      (
        await page.request.put('/api/business-profile', {
          data: {
            version: original.profile.version,
            profile: { ...original.profile, financialsAsOf: '2026-01-01' },
            financials: profileFinancials,
          },
        })
      ).ok(),
    ).toBeTruthy();
    const id = await draft(page);
    await page.goto(`/applications/${id}`);
    await page
      .locator('.application-action-plan')
      .getByRole('link', { name: 'Обновить профиль', exact: false })
      .click();
    await expect(page).toHaveURL(/\/business#profile-financialsAsOf$/);
    await expect(page.locator('#profile-financialsAsOf')).toBeFocused();
    await expect(page.locator('#profile-financialsAsOf')).toHaveValue('2026-01-01');
  } finally {
    const current = (await (
      await page.request.get('/api/business-profile')
    ).json()) as BusinessProfileResponse;
    expect(
      (
        await page.request.put('/api/business-profile', {
          data: {
            version: current.profile.version,
            profile: original.profile,
            financials: profileFinancials,
          },
        })
      ).ok(),
    ).toBeTruthy();
  }
});

test('bank sees financial and document changes against the information request after resubmission', async ({
  page,
}, info) => {
  await login(page);
  const id = await apiApplication(page);
  await login(page, 'bank');
  let current = await getDetail(page, id);
  expect(
    (
      await page.request.post(`/api/bank/applications/${id}/review`, {
        data: { version: current.application.version },
      })
    ).ok(),
  ).toBeTruthy();
  current = await getDetail(page, id);
  expect(
    (
      await page.request.post(`/api/bank/applications/${id}/decision`, {
        data: {
          version: current.application.version,
          outcome: 'needs_info',
          requestedDocuments: ['other'],
          reason: 'Приложите подтверждение нового контракта.',
        },
      })
    ).ok(),
  ).toBeTruthy();
  const baseline = await getDetail(page, id);
  await login(page);
  expect(
    (
      await page.request.post(`/api/applications/${id}/documents/sample`, {
        data: { category: 'other' },
      })
    ).ok(),
  ).toBeTruthy();
  current = await getDetail(page, id);
  expect(
    (
      await page.request.patch(`/api/applications/${id}`, {
        data: { ...current.application, financials: { ...financials, monthlyRevenue: 3200000 } },
      })
    ).ok(),
  ).toBeTruthy();
  current = await getDetail(page, id);
  expect(
    (
      await page.request.post(`/api/applications/${id}/actions/supplement`, {
        data: { version: current.application.version },
      })
    ).ok(),
  ).toBeTruthy();
  await login(page, 'bank');
  const response = await page.request.get(`/api/bank/applications/${id}/changes`);
  expect(response.ok()).toBeTruthy();
  const comparison = (await response.json()) as ApplicationChanges;
  expect(comparison.baseline.version).toBe(baseline.application.version);
  expect(comparison.fields.find((field) => field.key === 'monthlyRevenue')?.after).toBe(3200000);
  await page.goto(`/applications/${id}`);
  const changes = page.locator('.application-changes');
  await expect(
    changes.getByRole('heading', { name: 'Что изменилось в пакете', exact: true }),
  ).toBeVisible();
  await expect(changes.locator('.changes-baseline')).toContainText(
    `версия ${baseline.application.version}`,
  );
  const revenue = changes
    .locator('.changes-rows > div')
    .filter({ has: page.getByText('Выручка в месяц, ₽', { exact: true }) });
  await expect(revenue).toContainText(/2\s*400\s*000/);
  await expect(revenue).toContainText(/3\s*200\s*000/);
  await expect(changes.getByRole('link', { name: 'other-demo.txt', exact: true })).toBeVisible();
  await changes.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('bank-changes-1440.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 740 });
  await changes
    .getByRole('heading', { name: 'Что изменилось в пакете', exact: true })
    .scrollIntoViewIfNeeded();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('bank-changes-320.png'), animations: 'disabled' });
  await expect(page.locator('.application-action-plan .action-plan-link')).toHaveCount(0);
});
