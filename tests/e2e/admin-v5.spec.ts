import { expect, test } from '@playwright/test';
import { noOverflow, screenshot } from './helpers';
import type { Application, ApplicationDetail, AdminProduct } from '../../shared/types';

test('administrator pauses intake, client preserves draft, resume reconnects the bank queue', async ({
  page,
  browser,
}, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Управление платформой/ }).click();
  await page.getByRole('button', { name: 'Открыть рабочее место', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Платформа под контролем' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть поиск' })).toHaveCount(0);
  const client = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const business = await client.newPage();
  try {
    expect(
      (
        await client.request.post('/api/auth/login', {
          data: { email: 'owner@sever.example.test', password: 'Demo2026!' },
        })
      ).ok(),
    ).toBeTruthy();
    const created = await client.request.post('/api/applications', {
      data: {
        productId: 'working_capital',
        amount: 1200000,
        termMonths: 24,
        purpose: 'Проверка управления приёмом заявок',
        financials: {
          monthlyRevenue: 2400000,
          monthlyExpenses: 1650000,
          monthlyDebtPayment: 120000,
        },
        consent: true,
      },
    });
    expect(created.status()).toBe(201);
    const application: Application = (await created.json()).application;
    const card = page
      .locator('.admin-intake-card')
      .filter({ has: page.getByRole('heading', { name: 'Оборотный капитал', exact: true }) });
    await card.getByRole('button', { name: 'Приостановить приём', exact: true }).click();
    await card.getByLabel('Причина приостановки').fill('Проверка условий перед новым периодом');
    await card.getByRole('button', { name: 'Подтвердить паузу', exact: true }).click();
    await expect(card.getByText('Приём приостановлен', { exact: true })).toBeVisible();
    await business.goto(`/applications/${application.id}`);
    await business.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
    await expect(business.getByText(/Приём новых заявок по продукту приостановлен/)).toBeVisible();
    const unchanged: ApplicationDetail = await (
      await client.request.get(`/api/applications/${application.id}`)
    ).json();
    expect(unchanged.application.status).toBe('draft');
    expect(unchanged.application.version).toBe(application.version);
    await card.getByRole('button', { name: 'Возобновить приём', exact: true }).click();
    await card
      .getByLabel('Причина возобновления')
      .fill('Проверка завершена, можно принимать заявки');
    await card.getByRole('button', { name: 'Подтвердить возобновление', exact: true }).click();
    await expect(card.getByText('Приём открыт', { exact: true })).toBeVisible();
    await business.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await client.request.get(`/api/applications/${application.id}`)).json())
            .application.status,
      )
      .toBe('submitted');
    await page.getByRole('button', { name: 'Реестр', exact: true }).click();
    await page.getByRole('button', { name: 'Обновить данные' }).click();
    await expect(page.getByText(application.number, { exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать CSV' }).click();
    expect((await downloadPromise).suggestedFilename()).toBe('debitus-platform-registry.csv');
    await page.getByRole('button', { name: 'Журнал', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Приём приостановлен', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Приём возобновлён', exact: true }),
    ).toBeVisible();
    await screenshot(page, info, 'admin-audit-desktop');
  } finally {
    const products: { products: AdminProduct[] } = await (
      await page.request.get('/api/admin/products')
    ).json();
    const product = products.products.find((item) => item.id === 'working_capital');
    if (product?.intake.paused)
      await page.request.patch('/api/admin/products/working_capital/intake', {
        data: {
          version: product.intake.version,
          paused: false,
          reason: 'Восстановление приёма после браузерной проверки',
        },
      });
    await client.close();
  }
});

test('admin sections fit desktop and narrow mobile without revealing credit case contents', async ({
  page,
}, info) => {
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { email: 'admin@debitus.example.test', password: 'Demo2026!' },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Платформа под контролем' })).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const label of ['Приём заявок', 'Реестр', 'Пользователи', 'Журнал']) {
      await page
        .getByRole('navigation', { name: 'Разделы администратора' })
        .getByRole('button', { name: label, exact: true })
        .click();
      await noOverflow(page);
      await screenshot(page, info, `admin-${label}-${width}`);
    }
  }
  expect((await page.request.get('/api/applications/app_sever_expansion')).status()).toBe(403);
  expect((await page.request.get('/api/documents')).status()).toBe(403);
});
