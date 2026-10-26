import { expect, test } from '@playwright/test';
import { apiApplication, loginUI, noOverflow, screenshot } from './helpers';

test('profile draft survives navigation and conflict reload replaces unsaved fields explicitly', async ({
  page,
}) => {
  await loginUI(page);
  const original = await (await page.request.get('/api/business-profile')).json();
  try {
    await page.goto('/business');
    await page.getByLabel('Нужная сумма, ₽', { exact: true }).fill('1800000');
    await page.getByRole('link', { name: 'Подобрать кредит', exact: true }).click();
    await page.getByRole('link', { name: 'Профиль бизнеса', exact: true }).click();
    await expect(page.getByLabel('Нужная сумма, ₽', { exact: true })).toHaveValue('1800000');
    const financials = {
      monthlyRevenue: original.organization.monthlyRevenue,
      monthlyExpenses: original.organization.monthlyExpenses,
      monthlyDebtPayment: original.organization.monthlyDebtPayment,
    };
    const updated = await page.request.put('/api/business-profile', {
      data: {
        version: original.profile.version,
        profile: { ...original.profile, requestedAmount: 1400000 },
        financials,
      },
    });
    expect(updated.ok()).toBeTruthy();
    await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Профиль уже изменён');
    await expect(page.getByLabel('Нужная сумма, ₽', { exact: true })).toHaveValue('1800000');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Загрузить сохранённые данные' }).click();
    await expect(page.getByLabel('Нужная сумма, ₽', { exact: true })).toHaveValue('1400000');
    await expect(
      page.getByRole('button', { name: 'Сохранить профиль', exact: true }),
    ).toBeDisabled();
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

test('profile persists, changes product ranking and transfers verified inputs to a draft', async ({
  page,
}, info) => {
  await loginUI(page);
  const original = await (await page.request.get('/api/business-profile')).json();
  try {
    await page.goto('/business');
    await page.getByLabel('Организационная форма', { exact: true }).selectOption('ip');
    await page.getByLabel('Налоговый режим', { exact: true }).selectOption('patent');
    await page.getByLabel('На что нужны деньги', { exact: true }).selectOption('credit_line');
    await page.getByLabel('Нужная сумма, ₽', { exact: true }).fill('1000000');
    await page.getByLabel('Желаемый срок, мес.', { exact: true }).fill('24');
    await page.getByLabel('Средняя отсрочка оплаты, дней', { exact: true }).fill('45');
    await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Сохранить профиль', exact: true }),
    ).toBeDisabled();
    await expect(page.getByText('Книга учёта доходов и патент', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Налоговый режим', { exact: true })).toHaveValue('patent');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverflow(page);
    }
    await screenshot(page, info, 'profile-ip-320');
    await page.goto('/products');
    const first = page.locator('.recommendation-row').first();
    await expect(first.getByRole('heading', { name: 'Резерв для бизнеса' })).toBeVisible();
    await expect(first).toContainText('45 дней');
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverflow(page);
    }
    await screenshot(page, info, 'personalized-products');
    await first.getByRole('link', { name: 'Продолжить с этими условиями' }).click();
    await expect(page).toHaveURL(/product=credit_line&amount=1000000&term=24/);
    await expect(page.getByRole('heading', { name: /Новая заявка/ })).toBeVisible();
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

test('progress and financial information keep semantic colors across accents and themes', async ({
  page,
}) => {
  await loginUI(page);
  await apiApplication(page);
  const original = await (await page.request.get('/api/preferences')).json();
  try {
    for (const theme of ['light', 'dark'])
      for (const accent of ['red', 'mint', 'violet', 'amber']) {
        const saved = await page.request.patch('/api/preferences', {
          data: { ...original, theme, accent },
        });
        expect(saved.ok()).toBeTruthy();
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('html')).toHaveAttribute('data-accent', accent);
        const progress = page.locator('.badge.blue').first();
        await expect(progress).toHaveCSS(
          'color',
          theme === 'light' ? 'rgb(49, 94, 112)' : 'rgb(173, 213, 226)',
        );
        const prompt = page.locator('.cashflow-rehearsal');
        await expect(prompt).toHaveCSS(
          'background-color',
          theme === 'light' ? 'rgb(234, 242, 244)' : 'rgb(38, 61, 71)',
        );
      }
  } finally {
    await page.request.patch('/api/preferences', { data: original });
  }
});

test('mobile story changes stages while the illustration is still on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const scene = page.locator('.v3-story-scene');
  const artwork = scene.locator('.capital-v4');
  for (const [phase, viewportFraction] of [
    [0, 0.65],
    [1, 0.3],
    [2, 0.05],
  ]) {
    await scene.evaluate(
      (element, fraction) =>
        window.scrollTo({
          top: element.getBoundingClientRect().top + window.scrollY - window.innerHeight * fraction,
          behavior: 'instant',
        }),
      viewportFraction,
    );
    await expect(artwork).toHaveAttribute('data-phase', String(phase));
    const box = (await artwork.boundingBox())!;
    expect(box.y).toBeLessThan(844);
    expect(box.y + box.height).toBeGreaterThan(100);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: /01 Задача бизнеса/ }).click();
  await expect(artwork).toHaveAttribute('data-phase', '0');
  await expect(artwork).not.toHaveClass(/is-moving/);
  await noOverflow(page);
});
