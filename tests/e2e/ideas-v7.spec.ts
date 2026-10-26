import { expect, test, type Locator } from '@playwright/test';
import type { Offer } from '../../shared/types';
import {
  apiApplication,
  bankReview,
  getDetail,
  loginUI,
  logoutUI,
  noOverflow,
  screenshot,
} from './helpers';

const rubles = (value: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);

async function expectSavedSummary(dialog: Locator, offer: Offer) {
  await expect(dialog.locator('.loan-summary-item')).toHaveCount(6);
  await expect(dialog.locator('.loan-summary-amount strong')).toHaveText(rubles(offer.amount));
  await expect(dialog.locator('.loan-summary-payment strong')).toHaveText(
    rubles(offer.monthlyPayment),
  );
  await expect(dialog.locator('.loan-summary-payment')).toContainText(`${offer.termMonths} мес.`);
  await expect(dialog.locator('.loan-summary-payment')).toContainText(
    `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(offer.rateBps / 100)}% годовых`,
  );
  await expect(dialog.locator('.loan-summary-cost strong')).toHaveText(
    rubles(offer.totalRepayment),
  );
  await expect(dialog.locator('.loan-summary-cost')).toContainText(rubles(offer.totalInterest));
  await expect(dialog.locator('.loan-summary-security')).toContainText(
    'Модуль обеспечения не реализован',
  );
  await expect(dialog.locator('.loan-summary-overdue')).toContainText('не рассчитываются');
  await expect(dialog.locator('.loan-summary-early_repayment')).toContainText('не моделируются');
}

test('field guidance opens by pointer and keyboard without submitting or changing the field', async ({
  page,
}, info) => {
  await loginUI(page);
  const before = (await (await page.request.get('/api/applications')).json()).applications.length;
  await page.goto('/applications/new');
  const amount = page.getByRole('spinbutton', { name: 'Сумма, ₽', exact: true });
  await amount.fill('1300000');
  const help = page.getByRole('button', { name: 'Зачем: Сумма, ₽', exact: true });
  const explanation = page.locator('#new-amount-guide');
  await expect(explanation).toBeHidden();
  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await expect(explanation).toBeVisible();
  for (const title of ['Откуда берётся', 'Зачем нужно', 'Где используется']) {
    await expect(explanation.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(amount).toHaveValue('1300000');
  await expect(amount).toHaveAccessibleName('Сумма, ₽');
  await expect(
    page.getByRole('heading', { name: 'На что нужны средства?', exact: true }),
  ).toBeVisible();
  await help.press('Escape');
  await expect(explanation).toBeHidden();
  await expect(help).toBeFocused();
  await help.press('Enter');
  await expect(explanation).toBeVisible();
  await help.press('Space');
  await expect(explanation).toBeHidden();
  await help.press('Enter');
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(explanation).toBeVisible();
  await noOverflow(page);
  await expect(amount).toHaveAccessibleName('Сумма, ₽');
  await expect(amount).toHaveValue('1300000');
  await expect(page).toHaveURL(/\/applications\/new$/);
  const after = (await (await page.request.get('/api/applications')).json()).applications.length;
  expect(after).toBe(before);
  await screenshot(page, info, 'field-guidance-320');
});

test('acceptance and signature show saved counteroffer totals that match the generated contract', async ({
  page,
}, info) => {
  await loginUI(page);
  const id = await apiApplication(page, { amount: 8000000, termMonths: 12 });
  await logoutUI(page);
  await loginUI(page, 'bank');
  await bankReview(page, id);
  const decided = await getDetail(page, id);
  expect(decided.application.status).toBe('counter_offer');
  const offer = decided.application.decision!.offer!;
  expect(offer.amount).toBeLessThan(decided.application.amount);
  await logoutUI(page);
  await loginUI(page);
  await page.goto(`/applications/${id}`);
  await page.getByRole('button', { name: 'Принять условия', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expectSavedSummary(dialog, offer);
  const accept = dialog.getByRole('button', { name: 'Принять условия', exact: true });
  await expect(accept).toBeDisabled();
  expect((await getDetail(page, id)).application.status).toBe('counter_offer');
  await dialog.getByRole('checkbox').check();
  await expect(accept).toBeEnabled();
  await dialog.getByRole('checkbox').uncheck();
  await expect(accept).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await accept.click();
  await expect(
    page.getByRole('button', { name: 'Ознакомиться и подписать', exact: true }),
  ).toBeVisible();
  const accepted = await getDetail(page, id);
  const contract = accepted.documents.find((document) => document.category === 'contract')!;
  expect(contract).toBeTruthy();
  const response = await page.request.get(contract.downloadUrl);
  expect(response.ok()).toBeTruthy();
  const text = await response.text();
  expect(text).toContain(`Сумма ${offer.amount} RUB`);
  expect(text).not.toContain(`Сумма ${decided.application.amount} RUB`);
  expect(text).toContain(`Платёж ${offer.monthlyPayment} RUB`);
  expect(text).toContain(`Проценты за весь срок ${offer.totalInterest} RUB`);
  expect(text).toContain(`Всего к возврату ${offer.totalRepayment} RUB`);
  await page.getByRole('button', { name: 'Ознакомиться и подписать', exact: true }).click();
  await expectSavedSummary(dialog, offer);
  for (const item of await dialog.locator('.loan-summary-item').all()) {
    for (const value of [
      await item.locator('dt').innerText(),
      await item.locator('strong').innerText(),
      await item.locator('p').innerText(),
    ]) {
      expect(text).toContain(value);
    }
  }
  const sign = dialog.getByRole('button', { name: 'Подтвердить документ', exact: true });
  await expect(sign).toBeDisabled();
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
  }
  await screenshot(page, info, 'saved-contract-summary-320');
  await dialog.getByRole('checkbox').check();
  await sign.click();
  await expect(
    page.getByRole('button', { name: 'Смоделировать выдачу', exact: true }),
  ).toBeVisible();
  const signed = await getDetail(page, id);
  expect(signed.application.status).toBe('signed');
  expect(signed.application.decision!.offer).toEqual(offer);
});

test('client and bank can inspect the same saved decision context after the business profile changes', async ({
  page,
}, info) => {
  await loginUI(page);
  const original = await (await page.request.get('/api/business-profile')).json();
  const id = await apiApplication(page);
  await logoutUI(page);
  await loginUI(page, 'bank');
  await bankReview(page, id);
  const decided = await getDetail(page, id);
  const event = decided.timeline.find((item) => item.action === decided.application.status)!;
  const context = event.context!;
  expect(context.assessment!.score).toEqual(decided.application.score);
  expect(context.scoringVersion).toBe(decided.application.score!.modelVersion);
  expect(context.policyVersion).toBe(decided.application.decision!.ruleVersion);
  async function inspectSavedContext() {
    const saved = page
      .locator('.timeline .audit-event-context')
      .filter({ hasText: `Сохранённая оценка: ${context.assessment!.score!.value} из 100` })
      .filter({ hasText: context.policyVersion! })
      .first();
    await saved.getByText('Контекст события', { exact: true }).click();
    await expect(saved).toHaveAttribute('open', '');
    await expect(saved.locator('.audit-event-versions')).toContainText(
      `Заявка v${context.applicationVersion}`,
    );
    await expect(saved.locator('.audit-event-versions')).toContainText(
      `профиль v${context.profileVersion}`,
    );
    await expect(saved.locator('.audit-event-versions')).toContainText(context.scoringVersion!);
    await expect(saved.locator('.audit-event-versions')).toContainText(context.policyVersion!);
    await expect(saved).toContainText(rubles(context.input!.financials.monthlyRevenue));
    for (const factor of context.assessment!.score!.factors) {
      await expect(saved.locator('.audit-event-score')).toContainText(
        `${factor.label}: ${factor.points > 0 ? '+' : ''}${factor.points}`,
      );
      await expect(saved.locator('.audit-event-score')).toContainText(factor.detail);
    }
    for (const reason of context.assessment!.decision!.reasons)
      await expect(saved).toContainText(reason);
  }
  await inspectSavedContext();
  await logoutUI(page);
  await loginUI(page);
  try {
    const financials = {
      monthlyRevenue: original.organization.monthlyRevenue + 230000,
      monthlyExpenses: original.organization.monthlyExpenses,
      monthlyDebtPayment: original.organization.monthlyDebtPayment,
    };
    const updated = await page.request.put('/api/business-profile', {
      data: { version: original.profile.version, profile: original.profile, financials },
    });
    expect(updated.ok()).toBeTruthy();
    expect((await updated.json()).profile.version).toBeGreaterThan(context.profileVersion!);
    await page.goto(`/applications/${id}`);
    await inspectSavedContext();
    const historical = await getDetail(page, id);
    expect(historical.timeline.find((item) => item.id === event.id)!.context).toEqual(context);
    expect(historical.application.decision).toEqual(decided.application.decision);
    await screenshot(page, info, 'saved-event-context');
  } finally {
    const current = await (await page.request.get('/api/business-profile')).json();
    const restored = await page.request.put('/api/business-profile', {
      data: {
        version: current.profile.version,
        profile: original.profile,
        financials: {
          monthlyRevenue: original.organization.monthlyRevenue,
          monthlyExpenses: original.organization.monthlyExpenses,
          monthlyDebtPayment: original.organization.monthlyDebtPayment,
        },
      },
    });
    expect(restored.ok()).toBeTruthy();
  }
});
