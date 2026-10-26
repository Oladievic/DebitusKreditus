import { test, expect } from '@playwright/test';
import { loginUI, logoutUI, noOverflow, screenshot } from './helpers';

test('all client pages fit the viewport and produce reviewable screenshots', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#v3-title')).toBeVisible();
  await noOverflow(page);
  await screenshot(page, info, '00-login');
  await loginUI(page);
  for (const [name, route] of [
    ['overview', '/'],
    ['applications', '/applications'],
    ['products', '/products'],
    ['simulator', '/simulator'],
    ['documents', '/documents'],
    ['assistant', '/assistant'],
    ['feed', '/feed'],
    ['integrations', '/integrations'],
    ['settings', '/settings'],
    ['legal', '/legal'],
    ['wizard', '/applications/new'],
    ['application-detail', '/applications/app_sever_working'],
  ]) {
    await page.goto(route);
    await expect(page.locator('#main-content h1')).toBeVisible();
    await expect(page.locator('.error-state')).toHaveCount(0);
    await page
      .locator('.loading')
      .waitFor({ state: 'hidden' })
      .catch(() => {});
    await noOverflow(page);
    await screenshot(page, info, name);
  }
  await page.goto('/integrations');
  await page.getByRole('button', { name: 'API и ИИ-агенты', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Личный токен', exact: true })).toBeVisible();
  await noOverflow(page);
  await screenshot(page, info, 'integrations-agents');
  await page.getByRole('button', { name: 'Журнал действий', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'История операций', exact: true })).toBeVisible();
  await noOverflow(page);
  await screenshot(page, info, 'integrations-audit');
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveClass(/nav-open/);
    await screenshot(page, info, 'mobile-navigation');
    await page.locator('.sidebar').getByRole('link', { name: 'Настройки', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator('.app-shell')).not.toHaveClass(/nav-open/);
  }
  await page.getByRole('button', { name: /Найти в кабинете/ }).click();
  await page.getByLabel('Поисковый запрос').fill('Оборот');
  await expect(page.locator('.search-results button').first()).toBeVisible();
  await noOverflow(page);
  await screenshot(page, info, 'search-dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  expect(errors).toEqual([]);
});

test('bank queue and decision card fit the viewport', async ({ page }, info) => {
  await loginUI(page, 'bank');
  await page.goto('/bank');
  await expect(
    page.getByRole('heading', { name: 'Рабочее место банка', exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await screenshot(page, info, 'bank-queue');
  if (page.viewportSize()!.width <= 620) {
    const cells = await page
      .locator('.bank-queue tbody tr')
      .first()
      .locator('td')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        }),
      );
    for (const cell of cells) {
      expect(cell.left).toBeGreaterThanOrEqual(0);
      expect(cell.right).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(cell.width).toBeGreaterThan(0);
    }
  }
  await page.goto('/applications/app_sever_expansion');
  await expect(page.getByRole('button', { name: 'Проверить заявку', exact: true })).toBeVisible();
  await noOverflow(page);
  await screenshot(page, info, 'bank-application');
  await logoutUI(page);
  await expect(page.locator('#v3-title')).toBeVisible();
});
