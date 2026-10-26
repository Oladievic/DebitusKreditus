import { expect, test } from '@playwright/test';
import { loginUI, noOverflow, screenshot } from './helpers';

test('product links focus the matching product and theme toggle persists', async ({ page }) => {
  await loginUI(page);
  await page.goto('/products?product=equipment');
  const product = page.locator('#product-equipment');
  await expect(product).toHaveClass(/is-search-match/);
  await expect(product).toBeFocused();
  await expect(product.getByText('Продукт из поиска')).toBeVisible();
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(async () => (await (await page.request.get('/api/preferences')).json()).theme)
    .toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Включить светлую тему', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get('/api/preferences')).json()).theme)
    .toBe('light');
});

test('scenario never creates an application or exports a stale calculation', async ({ page }) => {
  await loginUI(page);
  await page.goto('/simulator');
  const apply = page.getByRole('button', { name: 'Создать заявку с этими условиями' });
  const csv = page.getByRole('button', { name: 'Скачать CSV' });
  await expect(apply).toBeEnabled();
  await page.route('**/api/scenario', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Расчёт временно недоступен' } }),
    });
  });
  await page.getByRole('button', { name: '−20%', exact: true }).click();
  await expect(apply).toBeDisabled();
  await expect(csv).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Расчёт временно недоступен');
  await expect(apply).toHaveCount(0);
  await expect(csv).toBeDisabled();
  await page.unroute('**/api/scenario');
  await page.getByRole('button', { name: 'Повторить расчёт' }).click();
  await expect(apply).toBeEnabled();
  await expect(csv).toBeEnabled();
  const download = page.waitForEvent('download');
  await csv.click();
  expect((await download).suggestedFilename()).toBe('debitus-payment-schedule-demo.csv');
  await apply.click();
  await expect(page).toHaveURL(
    /\/applications\/new\?product=working_capital&amount=1500000&term=24/,
  );
});

test('intro remains usable with reduced motion across tablet and wide layouts', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.locator('#v3-title')).toHaveText(/Кредитный.*путь вашего.*бизнеса/);
  await expect(page.locator('.intro-v3')).toHaveAttribute('data-motion', 'off');
  for (const width of [320, 390, 768, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow(page);
    await screenshot(page, info, `intro-${width}`);
  }
  await page.setViewportSize({ width: 1266, height: 714 });
  const entryAction = await page.locator('.v3-hero-actions .v3-primary').boundingBox();
  expect(entryAction).not.toBeNull();
  expect(entryAction!.y + entryAction!.height).toBeLessThanOrEqual(714);
  await screenshot(page, info, 'intro-short-desktop');
  await loginUI(page);
  await page.getByRole('link', { name: 'Знакомство с кабинетом', exact: true }).click();
  await expect(page.locator('#v3-title')).toBeVisible();
  expect(await page.locator('main main').count()).toBe(0);
  await page.getByRole('button', { name: 'Вернуться в кабинет', exact: true }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Северная мастерская', exact: true }),
  ).toBeVisible();
});

test('intro motion can be paused and the dossier can be inspected by stage', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('.intro-v3')).toHaveAttribute('data-motion', 'on');
  const object = page.locator('.v3-hero-figure .capital-object');
  const initialTransform = await object.evaluate((element) => getComputedStyle(element).transform);
  const art = await page.locator('.v3-hero-figure .capital-v4').boundingBox();
  expect(art).not.toBeNull();
  await page.mouse.move(art!.x + art!.width * 0.8, art!.y + art!.height * 0.25);
  await expect
    .poll(() =>
      page
        .locator('.v3-hero-figure .capital-v4')
        .evaluate((element) =>
          Math.abs(parseFloat((element as HTMLElement).style.getPropertyValue('--tilt-x')) || 0),
        ),
    )
    .toBeGreaterThan(1);
  await expect
    .poll(() => object.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe(initialTransform);
  await page.getByRole('button', { name: 'Приостановить анимацию', exact: true }).click();
  await expect(page.locator('.intro-v3')).toHaveAttribute('data-motion', 'off');
  await expect(page.locator('.v3-hero-figure .v3-flow-trace')).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: 'Включить анимацию', exact: true }).click();
  await expect(page.locator('.intro-v3')).toHaveAttribute('data-motion', 'on');
  const scene = page.locator('.v3-story-scene .v3-capital-scene');
  await page
    .locator('.v3-chapter[data-chapter="1"]')
    .evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(scene).toHaveAttribute('data-phase', '1');
  await expect(scene.locator('.capital-profile')).toHaveCSS('opacity', '1');
  await expect(scene.locator('.v3-paper-details')).toHaveCSS('opacity', '1');
  await screenshot(page, info, 'motion-documents');
  await page.getByRole('button', { name: /03 Решение и следующий шаг/ }).click();
  await expect(page.locator('.v3-story-scene .v3-capital-scene')).toHaveAttribute(
    'data-phase',
    '2',
  );
  await expect(scene.locator('.v3-outcome-map')).toHaveCSS('opacity', '1');
  await expect(scene.locator('.capital-decision')).toHaveCSS('opacity', '1');
  await screenshot(page, info, 'motion-outcomes');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.intro-v3')).toHaveAttribute('data-motion', 'off');
  await expect(scene.locator('.v3-flow-trace')).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: /01 Задача бизнеса/ }).click();
  await expect(scene).toHaveAttribute('data-phase', '0');
});
