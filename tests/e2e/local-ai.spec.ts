import { test, expect, type Page } from '@playwright/test';
import type { LocalAIStatus } from '../../shared/local-ai';
import { noOverflow, screenshot } from './helpers';

const ready: LocalAIStatus = {
  state: 'ready',
  available: true,
  runtime: 'local',
  model: 'qwen3:1.7b',
  message: 'Модель установлена на этом компьютере. Объяснение создаётся локально, по запросу.',
  limits: { contextTokens: 2048, outputTokens: 384, timeoutSeconds: 90, concurrency: 1 },
};

async function openAssistant(page: Page) {
  const login = await page.request.post('/api/auth/login', {
    data: { email: 'owner@sever.example.test', password: 'Demo2026!' },
  });
  expect(login.ok()).toBeTruthy();
  const created = await page.request.post('/api/applications', {
    data: {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      purpose: 'Материалы для производства',
      financials: { monthlyRevenue: 2400000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
      consent: true,
    },
  });
  expect(created.status()).toBe(201);
  const application = (await created.json()).application;
  await page.goto('/assistant');
  await expect(
    page.getByRole('heading', { name: 'Разобраться в заявке', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Заявка для разбора').selectOption(application.id);
  return application;
}

test('assistant stays useful without Ollama and cloud reports unavailable at every layout', async ({
  page,
}, info) => {
  await openAssistant(page);
  await expect(page.getByRole('heading', { name: 'Помощник выключен', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Объяснить по данным заявки', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('Расчётная оценка', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть полный расчёт' })).toBeVisible();
  await page.route('**/api/local-ai/status', (route) =>
    route.fulfill({
      json: {
        ...ready,
        state: 'cloud',
        available: false,
        runtime: 'cloud',
        model: null,
        message: 'В облачной версии расчёты и заявки работают без ИИ.',
      },
    }),
  );
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Доступен при локальном запуске', exact: true }),
  ).toBeVisible();
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await noOverflow(page);
    await screenshot(page, info, `local-assistant-unavailable-${width}`);
  }
});

test('assistant uses chosen topic, renders plain text and clears outdated topic output', async ({
  page,
}, info) => {
  await page.route('**/api/local-ai/status', (route) => route.fulfill({ json: ready }));
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/local-ai/explain', (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    return route.fulfill({
      json: {
        text: 'Платёж берётся из расчёта. <strong>Это текст, а не HTML.</strong>',
        model: 'qwen3:1.7b',
        modelDigest: 'a'.repeat(64),
        topic: body.topic,
        applicationId: body.applicationId,
        applicationVersion: body.version,
        profileVersion: body.profileVersion,
        assessmentVersion: 'rules-v1',
        generatedAt: new Date().toISOString(),
        truncated: false,
      },
    });
  });
  const application = await openAssistant(page);
  const detail = await (await page.request.get(`/api/applications/${application.id}`)).json();
  const profileVersion = detail.organization.profile?.version ?? 1;
  await page.getByRole('radio', { name: /Как читать условия/ }).check();
  await page.getByRole('button', { name: 'Объяснить по данным заявки', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Ответ локальной модели' })).toContainText(
    '<strong>Это текст, а не HTML.</strong>',
  );
  expect(requests).toEqual([
    {
      applicationId: application.id,
      version: application.version,
      profileVersion,
      topic: 'payment',
    },
  ]);
  await expect(page.locator('.assistant-answer strong')).toHaveCount(0);
  await screenshot(page, info, 'local-assistant-controlled-response');
  await page.getByRole('radio', { name: /Какие сведения нужны/ }).check();
  await expect(page.getByRole('article', { name: 'Ответ локальной модели' })).toHaveCount(0);
});

test('assistant reports unavailable generation, supports retry and cancels without stale output', async ({
  page,
}) => {
  await page.route('**/api/local-ai/status', (route) => route.fulfill({ json: ready }));
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/local-ai/explain', async (route) => {
    calls++;
    if (calls === 1)
      return route.fulfill({
        status: 503,
        json: { error: { message: 'Ollama недоступна. Запустите локальный сервис.' } },
      });
    await gate;
    await route.abort().catch(() => {});
  });
  await openAssistant(page);
  await page.getByRole('button', { name: 'Объяснить по данным заявки', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Ollama недоступна');
  await expect(
    page.getByRole('button', { name: 'Объяснить по данным заявки', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Объяснить по данным заявки', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(
    page.getByText('Объяснение отменено. Данные заявки не изменились.', { exact: true }),
  ).toBeVisible();
  release();
  await expect(page.getByRole('article', { name: 'Ответ локальной модели' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Объяснить по данным заявки', exact: true }),
  ).toBeEnabled();
});
