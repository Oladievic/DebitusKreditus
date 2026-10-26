import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { apiApplication, getDetail, loginUI, noOverflow } from './helpers';
import {
  servicingCsv,
  type LoanServicingState,
  type PrepaymentPreview,
} from '../../shared/servicing';

async function createFunded(page: Page) {
  await loginUI(page);
  const id = await apiApplication(page);
  const login = async (email: string) => {
    const response = await page.request.post('/api/auth/login', {
      data: { email, password: 'Demo2026!' },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  };
  await login('bank@debitus.example.test');
  for (const action of ['review', 'decision']) {
    const detail = await getDetail(page, id);
    const response = await page.request.post(`/api/bank/applications/${id}/${action}`, {
      data: { version: detail.application.version },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  expect((await getDetail(page, id)).application.status).toBe('approved');
  await login('owner@sever.example.test');
  for (const action of ['accept-offer', 'sign', 'fund']) {
    const detail = await getDetail(page, id);
    const response = await page.request.post(`/api/applications/${id}/actions/${action}`, {
      data: { version: detail.application.version, confirmed: true },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await page.goto(`/applications/${id}#application-servicing`);
  const panel = page.locator('.loan-servicing');
  await expect(panel.getByRole('heading', { name: 'После выдачи', exact: true })).toBeVisible();
  return { id, panel };
}
async function service(page: Page, id: string) {
  const response = await page.request.get(`/api/applications/${id}/servicing`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { servicing: LoanServicingState }).servicing;
}

test('servicing records explicit payment, previews both prepayment strategies, closes and exports reproducible history', async ({
  page,
}) => {
  const { id, panel } = await createFunded(page);
  const original = await getDetail(page, id);
  expect((await service(page, id)).version).toBe(0);
  const pay = panel.getByRole('button', { name: 'Отметить платёж в модели', exact: true });
  await expect(pay).toBeDisabled();
  await expect(panel.getByRole('spinbutton')).toHaveCount(0);
  await panel.locator('.servicing-record').getByRole('checkbox').check();
  await pay.click();
  await expect.poll(async () => (await service(page, id)).version).toBe(1);
  const amount = panel.getByRole('spinbutton', {
    name: 'Сумма досрочного погашения, ₽',
    exact: true,
  });
  await amount.fill('300000');
  const calculate = panel.getByRole('button', {
    name: 'Рассчитать досрочное погашение',
    exact: true,
  });
  await calculate.click();
  await expect(panel.locator('.servicing-preview')).toBeVisible();
  const save = panel.getByRole('button', {
    name: 'Сохранить досрочное погашение в модели',
    exact: true,
  });
  await expect(save).toBeDisabled();
  expect((await service(page, id)).version).toBe(1);
  await panel
    .getByRole('combobox', { name: 'Что уменьшить', exact: true })
    .selectOption('reduce_term');
  await expect(panel.locator('.servicing-preview')).toHaveCount(0);
  const response = page.waitForResponse((r) => r.url().endsWith('/servicing/prepayment/preview'));
  await calculate.click();
  const preview = ((await (await response).json()) as { preview: PrepaymentPreview }).preview;
  expect(preview.remainingTermMonths).toBeLessThan(preview.previousTermMonths);
  await panel.locator('.servicing-preview').getByRole('checkbox').check();
  await save.click();
  await expect.poll(async () => (await service(page, id)).version).toBe(2);
  expect((await service(page, id)).schedule).toEqual(preview.schedule);
  await expect(panel.getByRole('spinbutton')).toHaveCount(0);
  await page.reload();
  await expect(panel.getByRole('heading', { name: 'После выдачи' })).toBeVisible();
  await panel.locator('.servicing-record').getByRole('checkbox').check();
  await pay.click();
  await expect.poll(async () => (await service(page, id)).version).toBe(3);
  await amount.fill(String((await service(page, id)).balance));
  await calculate.click();
  await expect(panel.getByRole('heading', { name: 'Полное погашение', exact: true })).toBeVisible();
  await panel.locator('.servicing-preview').getByRole('checkbox').check();
  await save.click();
  await expect.poll(async () => (await service(page, id)).status).toBe('closed');
  await expect(
    panel.getByText('Кредит погашен в модели. История и график доступны для скачивания.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(pay).toHaveCount(0);
  const closed = await service(page, id);
  const final = await getDetail(page, id);
  expect(final.application).toEqual(original.application);
  expect(closed.balance).toBe(0);
  const event = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Скачать историю и график CSV', exact: true }).click();
  const downloaded = await event;
  const file = await downloaded.path();
  expect(file).toBeTruthy();
  expect(await readFile(file!, 'utf8')).toBe(servicingCsv(closed));
});

test('servicing rejects a stale confirmed preview and refreshing cannot revive its approval', async ({
  page,
}) => {
  const { id, panel } = await createFunded(page);
  await panel.locator('.servicing-record').getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Отметить платёж в модели', exact: true }).click();
  await panel
    .getByRole('spinbutton', { name: 'Сумма досрочного погашения, ₽', exact: true })
    .fill('100000');
  await panel.getByRole('button', { name: 'Рассчитать досрочное погашение', exact: true }).click();
  await expect(panel.locator('.servicing-preview')).toBeVisible();
  await panel.locator('.servicing-preview').getByRole('checkbox').check();
  const response = await page.request.post(`/api/applications/${id}/servicing/payment`, {
    data: { version: 1, idempotencyKey: 'outside-payment-0002', confirmed: true },
  });
  expect(response.status(), await response.text()).toBe(201);
  await panel
    .getByRole('button', { name: 'Сохранить досрочное погашение в модели', exact: true })
    .click();
  await expect(panel.getByRole('alert')).toContainText('График изменился');
  expect((await service(page, id)).history).toHaveLength(2);
  await panel.getByRole('button', { name: 'Обновить сопровождение', exact: true }).click();
  await expect(panel.locator('.servicing-preview')).toHaveCount(0);
  await expect(panel.locator('.servicing-record').getByRole('checkbox')).not.toBeChecked();
});

test('servicing adapts to 320px light and dark, supports keyboard calendar and bank read-only access', async ({
  page,
}, info) => {
  const { panel } = await createFunded(page);
  for (const width of [1440, 320])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 320 ? 740 : 1000 });
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
      );
      await noOverflow(page);
      await panel.locator('.servicing-calendar summary').focus();
      await page.keyboard.press('Enter');
      await expect(panel.locator('.servicing-calendar')).not.toHaveAttribute('open');
      await panel.screenshot({
        path: info.outputPath(`servicing-${width}-${theme}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Enter');
      await expect(panel.locator('.servicing-calendar')).toHaveAttribute('open');
    }
  const login = await page.request.post('/api/auth/login', {
    data: { email: 'bank@debitus.example.test', password: 'Demo2026!' },
  });
  expect(login.ok()).toBeTruthy();
  await page.reload();
  await expect(panel.getByRole('heading', { name: 'После выдачи', exact: true })).toBeVisible();
  await expect(panel.getByRole('checkbox')).toHaveCount(0);
  await expect(panel.getByRole('spinbutton')).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: 'Скачать историю и график CSV', exact: true }),
  ).toBeVisible();
  await noOverflow(page);
});
