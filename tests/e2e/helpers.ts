import { expect, type Page, type TestInfo } from '@playwright/test';
import type { ApplicationDetail, ApplicationInput } from '../../shared/types';

export type Company = 'sever' | 'terra' | 'vector' | 'bank';
const names = {
  sever: 'Северная мастерская',
  terra: 'Терра Кофе',
  vector: 'Вектор Логистик',
  bank: 'Кредитный центр',
};

export async function loginUI(page: Page, company: Company = 'sever') {
  await page.goto('/');
  await expect(page.locator('#v3-title')).toBeVisible();
  if (company === 'bank') await page.getByRole('button', { name: /Рабочее место банка/ }).click();
  else await page.locator('.entry-business').filter({ hasText: names[company] }).click();
  await page
    .getByRole('button', {
      name: company === 'bank' ? 'Открыть рабочее место' : 'Открыть кабинет',
      exact: true,
    })
    .click();
  await expect(page.locator('.topbar-profile')).toBeVisible();
  await expect(page.locator('#main-content h1')).toBeVisible();
}

export async function logoutUI(page: Page) {
  if (await page.getByRole('button', { name: 'Открыть меню', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.getByRole('button', { name: 'Выйти из кабинета', exact: true }).click();
  await expect(page.locator('#v3-title')).toBeVisible();
}

export async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
  await info.attach(name, { path: info.outputPath(`${name}.png`), contentType: 'image/png' });
}

export async function noOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect(async () => {
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      offenders: [...document.querySelectorAll('main *')]
        .filter((e) => e.getBoundingClientRect().right > innerWidth + 2)
        .slice(0, 8)
        .map((e) => ({
          tag: e.tagName,
          className: e.className,
          right: Math.round(e.getBoundingClientRect().right),
        })),
    }));
    const diagnostic = `${page.url()} ${JSON.stringify(geometry)}`;
    expect(geometry.scroll, diagnostic).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.body, diagnostic).toBeLessThanOrEqual(geometry.width + 1);
  }).toPass({ timeout: 5000, intervals: [50, 100, 250] });
}

export async function getDetail(page: Page, id: string): Promise<ApplicationDetail> {
  const response = await page.request.get(`/api/applications/${id}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function apiApplication(
  page: Page,
  overrides: Partial<ApplicationInput> = {},
  documents = true,
) {
  const response = await page.request.post('/api/applications', {
    data: {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      purpose: 'Закупка сырья под новый контракт',
      financials: { monthlyRevenue: 2400000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
      consent: true,
      ...overrides,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const id: string = (await response.json()).application.id;
  if (documents)
    for (const category of ['statement', 'financials'])
      expect(
        (
          await page.request.post(`/api/applications/${id}/documents/sample`, {
            data: { category },
          })
        ).ok(),
      ).toBeTruthy();
  const detail = await getDetail(page, id);
  expect(
    (
      await page.request.post(`/api/applications/${id}/actions/submit`, {
        data: { version: detail.application.version },
      })
    ).ok(),
  ).toBeTruthy();
  return id;
}

export async function bankReview(
  page: Page,
  id: string,
  comment = 'Данные проверены в браузерном сценарии.',
) {
  await page.goto(`/applications/${id}`);
  await page.getByRole('button', { name: 'Проверить заявку', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Подтвердить решение', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Комментарий клиенту', { exact: true }).fill(comment);
  await page.getByRole('button', { name: 'Подтвердить решение', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Решение банка', exact: true })).toBeVisible();
}
