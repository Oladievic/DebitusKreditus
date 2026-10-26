import { test, expect, type Page } from '@playwright/test';
import { loginUI, logoutUI, screenshot } from './helpers';

async function resetPreferences(page: Page) {
  await page.request.patch('/api/preferences', {
    data: {
      theme: 'light',
      accent: 'violet',
      density: 'comfortable',
      reducedMotion: false,
      widgets: ['applications', 'actions', 'feed', 'simulator'],
      interests: ['growth', 'cashflow'],
    },
  });
  await page.goto('/settings');
}

test('preferences apply on click, serialize rapid edits and finish after SPA navigation', async ({
  page,
}, info) => {
  await loginUI(page, 'terra');
  await resetPreferences(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/preferences', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => writes.length).toBe(1);
  await page.getByRole('button', { name: 'Светлая', exact: true }).click();
  await page.getByRole('button', { name: 'Янтарный', exact: true }).click();
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click();
  await page.getByLabel('Риски и финансовая устойчивость', { exact: true }).check();
  await page.getByLabel('Плотность интерфейса', { exact: true }).selectOption('compact');
  await page.getByLabel(/Минимум анимации/).check();
  await page.getByRole('link', { name: 'Посмотреть ленту', exact: true }).click();
  await expect(page).toHaveURL(/\/feed$/);
  expect(writes).toHaveLength(1);
  release();
  await expect(
    page.getByRole('heading', { name: 'Проверьте, что останется после платежа', exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get('/api/preferences')).json()).density)
    .toBe('compact');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({
    theme: 'dark',
    accent: 'amber',
    reducedMotion: true,
    density: 'compact',
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'amber');
  await screenshot(page, info, 'autosaved-preferences-feed');
});

test('failed autosave keeps the latest choice and retries without claiming success', async ({
  page,
}, info) => {
  await loginUI(page, 'terra');
  await resetPreferences(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route('**/api/preferences', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    writes++;
    if (writes === 1) {
      await gate;
      return route.fulfill({
        status: 503,
        json: { error: { message: 'Временная недоступность хранилища.' } },
      });
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click();
  await page.getByRole('button', { name: 'Янтарный', exact: true }).click();
  release();
  await expect(page.getByRole('alert').filter({ hasText: 'не сохранены' }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'amber');
  expect((await (await page.request.get('/api/preferences')).json()).theme).toBe('light');
  await screenshot(page, info, 'preferences-save-error');
  await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).first().click();
  await expect(page.locator('.preferences-status.is-saved').first()).toBeVisible();
  expect(writes).toBe(2);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Тёмная', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await logoutUI(page);
  await loginUI(page, 'bank');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Интересы бизнеса', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Состав обзора', exact: true })).toHaveCount(0);
});

test('document search understands Russian categories and empty search results', async ({
  page,
}) => {
  await loginUI(page);
  await page.goto('/documents');
  await page.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill('выписка');
  await expect(page.locator('.document-with-link').first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill('отчетность');
  await expect(page.locator('.document-with-link').first()).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Поиск документов', exact: true })
    .fill('несуществующийдокумент');
  await expect(
    page.getByRole('heading', { name: 'По запросу ничего не найдено', exact: true }),
  ).toBeVisible();
});

test('logout waits for pending preferences and stays signed in after a failed save', async ({
  page,
}) => {
  await loginUI(page, 'terra');
  await resetPreferences(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  let logouts = 0;
  await page.route('**/api/auth/logout', async (route) => {
    logouts++;
    await route.continue();
  });
  await page.route('**/api/preferences', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    writes++;
    if (writes === 1) {
      await gate;
      return route.fulfill({
        status: 503,
        json: { error: { message: 'Сохранение временно недоступно.' } },
      });
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click();
  await page.getByRole('button', { name: 'Янтарный', exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await page.getByRole('button', { name: 'Выйти из кабинета', exact: true }).click();
  expect(logouts).toBe(0);
  release();
  await expect(page.getByRole('alert').filter({ hasText: 'не сохранены' }).first()).toBeVisible();
  await expect(page.locator('.topbar-profile')).toBeVisible();
  expect(logouts).toBe(0);
  expect((await (await page.request.get('/api/auth/me')).json()).user.id).toBe('user_terra');
  await logoutUI(page);
  expect(writes).toBe(2);
  expect(logouts).toBe(1);
  await loginUI(page, 'terra');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'amber');
  await logoutUI(page);
  await loginUI(page, 'bank');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('bank feed actions lead to bank-accessible screens', async ({ page }) => {
  await loginUI(page, 'bank');
  await page.goto('/feed');
  const cards = page.locator('.full-feed .feed-card');
  await expect(cards.first()).toBeVisible();
  const links = await cards
    .locator('a')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  expect(links).not.toContain('/simulator');
  expect(links).toContain('/bank');
  await page.getByRole('link', { name: 'Открыть очередь', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Рабочее место банка', exact: true }),
  ).toBeVisible();
});

test('import validates malformed data, shows full preview and links created drafts; failed export keeps the page', async ({
  page,
}, info) => {
  await loginUI(page);
  await page.goto('/integrations');
  const file = page.locator('input[type=file]');
  await file.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('null'),
  });
  await expect(page.getByRole('alert')).toContainText('массив заявок');
  const row = {
    productId: 'working_capital',
    amount: 1200000,
    termMonths: 24,
    purpose: 'Проверяемый импорт',
    financials: { monthlyRevenue: 2400000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
    consent: false,
  };
  await file.setInputFiles({
    name: 'valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ applications: [row, { ...row, productId: 'equipment', consent: true }] }),
    ),
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Оборотный капитал');
  await expect(dialog).toContainText('Оборудование');
  await expect(dialog).toContainText('Выручка');
  await expect(dialog).toContainText('Режим работы потребуется подтвердить перед отправкой');
  await screenshot(page, info, 'complete-import-preview');
  await dialog.getByRole('button', { name: 'Создать черновики', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Черновики созданы', exact: true })).toBeVisible();
  const created = page
    .locator('.integration-card')
    .filter({ has: page.getByRole('heading', { name: 'Черновики созданы', exact: true }) });
  await expect(created.locator('a')).toHaveCount(2);
  await page.route('**/api/export?format=json', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { message: 'Сессия завершилась. Войдите снова.' } },
    }),
  );
  await page.getByRole('button', { name: 'Скачать JSON', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Сессия завершилась');
  await expect(page).toHaveURL(/\/integrations$/);
  await page.unroute('**/api/export?format=json');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать CSV', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('debitus-export.csv');
  await created.locator('a').first().click();
  await expect(page).toHaveURL(/\/applications\/import_/);
});
