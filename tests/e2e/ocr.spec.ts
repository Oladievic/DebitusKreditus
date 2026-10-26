import { test, expect, type Route } from '@playwright/test';
import path from 'node:path';
import { getDetail, noOverflow, screenshot } from './helpers';

async function login(page: import('@playwright/test').Page) {
  const response = await page.request.post('/api/auth/login', {
    data: { email: 'owner@sever.example.test', password: 'Demo2026!' },
  });
  expect(response.ok()).toBeTruthy();
}

test('real Russian OCR runs with self-hosted assets, reviewed amounts and saved provenance', async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await login(page);
  const external: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') {
      external.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/applications/new');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('button', { name: 'Распознать документ', exact: true }).click();
  await page
    .getByLabel('Файл для распознавания')
    .setInputFiles(path.resolve('public/fixtures/financial-scan.png'));
  const text = page.getByLabel('Распознанный текст', { exact: true });
  await expect(text).toBeVisible({ timeout: 100000 });
  await expect(text).toHaveValue(/Выручка/i);
  await expect(page.getByRole('button', { name: 'Применить к черновику' })).toBeDisabled();
  await expect(
    page.getByLabel('Распознанная сумма: Выручка в месяц, ₽', { exact: true }),
  ).toHaveValue('2400000');
  await page.getByLabel('Распознанная сумма: Выручка в месяц, ₽', { exact: true }).fill('2500000');
  await page.getByRole('checkbox', { name: 'Выручка в месяц, ₽', exact: true }).check();
  await page.getByRole('checkbox', { name: /Я сверил/ }).check();
  await screenshot(page, info, 'ocr-review-desktop');
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
  await screenshot(page, info, 'ocr-review-320');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Применить к черновику' }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Выручка в месяц, ₽', exact: true }),
  ).toHaveValue('2500000');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.locator('.wizard input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Сохранить и перейти к документам' }).click();
  await expect(page).toHaveURL(/\/applications\/app_/);
  const detail = await getDetail(page, page.url().split('/').at(-1)!);
  expect(detail.application.financials.monthlyRevenue).toBe(2500000);
  expect(detail.documents[0].ocr?.engine).toBe('tesseract.js@7.0.0');
  expect(detail.documents[0].ocr?.sourceName).toBe('financial-scan.png');
  expect(external).toEqual([]);
});

test('PDF is rendered locally then OCR saved only after review; malformed file and cancel recover', async ({
  page,
}) => {
  test.setTimeout(150000);
  await login(page);
  const created = await page.request.post('/api/applications', {
    data: {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      purpose: 'Распознавание PDF',
      financials: { monthlyRevenue: 2400000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
      consent: true,
    },
  });
  const { application } = await created.json();
  await page.goto(`/applications/${application.id}`);
  await page.getByRole('button', { name: 'Распознать документ', exact: true }).click();
  await page
    .getByLabel('Файл для распознавания')
    .setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('alert')).toContainText('исправный PNG');
  await page
    .getByLabel('Файл для распознавания')
    .setInputFiles(path.resolve('public/fixtures/financial-scan.pdf'));
  await expect(page.getByLabel('Распознанный текст', { exact: true })).toBeVisible({
    timeout: 100000,
  });
  await expect(page.getByLabel('Распознанный текст', { exact: true })).toHaveValue(
    /Кредитные платежи/i,
  );
  await page
    .getByLabel('Распознанный текст', { exact: true })
    .fill('Проверено вручную. Выручка в месяц: 2400000 RUB');
  await expect(page.getByRole('button', { name: 'Сохранить текст в заявку' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Я сверил/ }).check();
  let releaseSave: () => void = () => {};
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route('**/api/applications/*/documents/ocr', async (route) => {
    const response = await route.fetch();
    await saveGate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Сохранить текст в заявку' }).click();
  await expect(page.getByLabel('Распознанный текст', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Категория OCR-документа')).toBeDisabled();
  releaseSave();
  await expect(page.locator('.modal')).not.toBeVisible();
  const detail = await getDetail(page, application.id);
  expect(detail.documents[0].ocr?.sourceMimeType).toBe('application/pdf');
  const file = await page.request.get(detail.documents[0].downloadUrl);
  expect(await file.text()).toContain('Проверено вручную.');
  await page.getByRole('button', { name: 'Распознать документ', exact: true }).click();
  await page
    .getByLabel('Файл для распознавания')
    .setInputFiles(path.resolve('public/fixtures/financial-scan.png'));
  await page.getByRole('button', { name: 'Остановить распознавание' }).click();
  await expect(page.getByText('Распознавание остановлено. Результат не сохранён.')).toBeVisible();
  await expect(page.getByLabel('Распознанный текст', { exact: true })).not.toBeVisible();
});

test('CSV import previews exact monthly values before explicit confirmation', async ({ page }) => {
  await login(page);
  await page.goto('/integrations');
  const csv =
    'productId;amount;termMonths;purpose;monthlyRevenue;monthlyExpenses;monthlyDebtPayment;consent\nworking_capital;1200000;24;Импорт CSV проверка;2400000;1650000;120000;true';
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'applications.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('.import-preview')).toContainText('Импорт CSV проверка');
  await expect(page.locator('.import-preview')).toContainText('2 400 000');
  await expect(page.locator('.modal')).toBeVisible();
});

test('language failure, initialization cancel and timeout terminate the real OCR worker', async ({
  page,
  context,
}) => {
  await login(page);
  await page.clock.install();
  await page.goto('/applications/new');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('button', { name: 'Распознать документ', exact: true }).click();
  const language = '**/ocr/lang/rus.traineddata.gz';
  const activeWorkers = () =>
    page.workers().filter((worker) => worker.url().includes('/ocr/worker.min.js')).length;
  await context.route(language, (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await page
    .getByLabel('Файл для распознавания')
    .setInputFiles(path.resolve('public/fixtures/financial-scan.png'));
  await expect(page.getByRole('alert')).toContainText('не смог загрузить');
  await expect.poll(activeWorkers).toBe(0);
  await expect(page.getByRole('button', { name: 'Остановить распознавание' })).not.toBeVisible();
  await context.unroute(language);

  let held: Route | undefined;
  const releaseRequest = async () => {
    await held?.abort().catch(() => {});
  };
  await context.route(language, (route) => {
    held = route;
  });
  await page
    .getByLabel('Файл для распознавания')
    .setInputFiles(path.resolve('public/fixtures/financial-scan.png'));
  await expect.poll(() => !!held).toBe(true);
  await expect.poll(activeWorkers).toBe(1);
  await page.getByRole('button', { name: 'Остановить распознавание' }).click();
  await expect.poll(activeWorkers).toBe(0);
  await expect(page.getByText('Распознавание остановлено. Результат не сохранён.')).toBeVisible();
  await releaseRequest();
  held = undefined;

  await page
    .getByLabel('Файл для распознавания')
    .setInputFiles(path.resolve('public/fixtures/financial-scan.png'));
  await expect.poll(() => !!held).toBe(true);
  await expect.poll(activeWorkers).toBe(1);
  await page.clock.fastForward(60_100);
  await expect(page.getByRole('alert')).toContainText('60 секунд');
  await expect.poll(activeWorkers).toBe(0);
  await releaseRequest();
  await context.unroute(language);
  await expect(page.getByLabel('Распознанный текст', { exact: true })).not.toBeVisible();
});
