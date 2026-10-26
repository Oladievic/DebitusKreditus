import { test, expect, type Page } from '@playwright/test';
import type { ApplicationDetail } from '../../shared/types';
import { apiApplication, getDetail, noOverflow } from './helpers';

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
async function requestFinancials(page: Page, id: string) {
  await login(page, true);
  const original = await getDetail(page, id);
  const review = await page.request.post(`/api/bank/applications/${id}/review`, {
    data: { version: original.application.version },
  });
  expect(review.ok()).toBeTruthy();
  const reviewed = (await review.json()) as ApplicationDetail;
  const response = await page.request.post(`/api/bank/applications/${id}/decision`, {
    data: {
      version: reviewed.application.version,
      outcome: 'needs_info',
      requestedDocuments: ['financials'],
      reason: 'Приложите свежую финансовую отчётность за последний месяц.',
    },
  });
  expect(response.ok()).toBeTruthy();
  const requested = (await response.json()) as ApplicationDetail;
  await login(page);
  return requested;
}

test('existing category accepts a new original, preserves previous downloads and blocks supplement until the request is filled', async ({
  page,
}) => {
  await login(page);
  const id = await apiApplication(page);
  const requested = await requestFinancials(page, id);
  const old = requested.documents.find((document) => document.category === 'financials')!;
  await page.goto(`/applications/${id}#application-documents`);
  const section = page.locator('#application-documents');
  const financials = section.locator('[data-category="financials"]');
  const supplement = section.getByRole('button', {
    name: 'Передать дополнения банку',
    exact: true,
  });
  await expect(supplement).toBeDisabled();
  await expect(
    financials.getByText('Банк ждёт новый файл в этой категории', { exact: true }),
  ).toBeVisible();
  await expect(
    financials.getByRole('link', { name: `Скачать ${old.name}`, exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.post(`/api/applications/${id}/actions/supplement`, {
        data: { version: requested.application.version },
      })
    ).status(),
  ).toBe(400);
  await financials.locator('input[type=file]').setInputFiles({
    name: 'Свежая-отчётность.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Синтетические сведения за новый месяц: выручка 2400000 RUB.'),
  });
  await expect(
    financials.getByRole('link', { name: 'Скачать Свежая-отчётность.txt', exact: true }),
  ).toBeVisible();
  await expect(
    financials.getByRole('link', { name: `Скачать ${old.name}`, exact: true }),
  ).toBeVisible();
  await expect(financials.getByText('Новое вложение к запросу', { exact: false })).toBeVisible();
  await expect(supplement).toBeEnabled();
  const uploaded = await getDetail(page, id);
  expect(uploaded.application.status).toBe('needs_info');
  expect(uploaded.application.decision!.documentRequest).toEqual(
    requested.application.decision!.documentRequest,
  );
  expect(uploaded.documents.find((document) => document.id === old.id)!.sha256).toBe(old.sha256);
  expect(uploaded.documents.length).toBe(requested.documents.length + 1);
  await supplement.click();
  await expect.poll(async () => (await getDetail(page, id)).application.status).toBe('submitted');
  expect((await getDetail(page, id)).application.decision).toBeNull();
});

test('wrong category does not close a financials request and repeat requests need another file at 320px in dark theme', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await login(page);
  const preferences = await (await page.request.get('/api/preferences')).json();
  expect(
    (
      await page.request.patch('/api/preferences', { data: { ...preferences, theme: 'dark' } })
    ).ok(),
  ).toBeTruthy();
  try {
    const id = await apiApplication(page);
    const first = await requestFinancials(page, id);
    await page.goto(`/applications/${id}#application-documents`);
    const section = page.locator('#application-documents');
    const supplement = section.getByRole('button', {
      name: 'Передать дополнения банку',
      exact: true,
    });
    await section.locator('[data-category="statement"] input[type=file]').setInputFiles({
      name: 'Дополнительная-выписка.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Синтетическая выписка, не финансовая отчётность'),
    });
    await expect(
      section.getByRole('link', { name: 'Скачать Дополнительная-выписка.txt', exact: true }),
    ).toBeVisible();
    await expect(supplement).toBeDisabled();
    await section.locator('[data-category="financials"] input[type=file]').setInputFiles({
      name: 'Полная-финансовая-отчётность-за-октябрь-2026.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Синтетическая отчётность за октябрь'),
    });
    await expect(supplement).toBeEnabled();
    await noOverflow(page);
    await supplement.click();
    await expect.poll(async () => (await getDetail(page, id)).application.status).toBe('submitted');
    const second = await requestFinancials(page, id);
    expect(second.application.decision!.documentRequest!.id).not.toBe(
      first.application.decision!.documentRequest!.id,
    );
    await page.goto(`/applications/${id}#application-documents`);
    await page.reload();
    await expect(
      section.locator('[data-category="financials"] .document-category-file'),
    ).toHaveCount(2);
    await expect(supplement).toBeDisabled();
    await expect(section.locator('.document-request-summary')).toContainText(
      'Новые вложения: 0 из 1',
    );
    await expect(
      section.getByRole('link', {
        name: 'Скачать Полная-финансовая-отчётность-за-октябрь-2026.txt',
        exact: true,
      }),
    ).toBeVisible();
    await noOverflow(page);
    await section.screenshot({
      path: info.outputPath('document-repeat-request-320-dark.png'),
      animations: 'disabled',
    });
  } finally {
    await login(page);
    expect((await page.request.patch('/api/preferences', { data: preferences })).ok()).toBeTruthy();
  }
});
