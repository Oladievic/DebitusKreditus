import { test, expect } from '@playwright/test';
import { apiApplication, bankReview, getDetail, loginUI, logoutUI, screenshot } from './helpers';

test('wizard → documents → bank decision → acceptance → signature → funding', async ({
  page,
}, info) => {
  await loginUI(page);
  await page.getByRole('link', { name: 'Новая заявка', exact: true }).click();
  await page.getByRole('spinbutton', { name: /^Сумма/ }).fill('1200000');
  await page.getByRole('spinbutton', { name: /^Срок/ }).fill('24');
  await screenshot(page, info, '01-wizard-purpose');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Финансовая картина' })).toBeVisible();
  await screenshot(page, info, '02-wizard-financials');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByRole('checkbox').check();
  await screenshot(page, info, '03-wizard-review');
  await page.getByRole('button', { name: 'Сохранить и перейти к документам', exact: true }).click();
  await expect(page).toHaveURL(/\/applications\/app_/);
  const id = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Добавить образец', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Добавить образец', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Добавить образец', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Добавить образец', exact: true })).toHaveCount(0);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: /Скачать statement-demo/ }).click();
  expect((await downloaded).suggestedFilename()).toContain('statement');
  await screenshot(page, info, '04-documents-ready');
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
  await expect.poll(async () => (await getDetail(page, id)).application.status).toBe('submitted');
  await logoutUI(page);
  await loginUI(page, 'bank');
  await bankReview(page, id);
  expect((await getDetail(page, id)).application.status).toBe('approved');
  await screenshot(page, info, '05-bank-approved');
  await logoutUI(page);
  await loginUI(page);
  await page.goto(`/applications/${id}`);
  await page.getByRole('button', { name: 'Принять условия', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Принять условия', exact: true })
    .click();
  await page.getByRole('button', { name: 'Ознакомиться и подписать', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await screenshot(page, info, '06-signature-confirmation');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Подтвердить документ', exact: true })
    .click();
  await page.getByRole('button', { name: 'Смоделировать выдачу', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Подтвердить условную выдачу', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Финансовый маршрут пройден', exact: true }),
  ).toBeVisible();
  const funded = await getDetail(page, id);
  expect(funded.application.status).toBe('funded');
  expect(funded.timeline.filter((e) => e.action === 'funded')).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Финансовый маршрут пройден', exact: true }),
  ).toBeVisible();
  await screenshot(page, info, '07-funded-after-reload');
});

test('missing information is requested, supplied and reviewed in the same application', async ({
  page,
}, info) => {
  await loginUI(page, 'terra');
  const id = await apiApplication(page, {}, false);
  await logoutUI(page);
  await loginUI(page, 'bank');
  await bankReview(page, id);
  expect((await getDetail(page, id)).application.status).toBe('needs_info');
  await screenshot(page, info, 'needs-info-bank');
  await logoutUI(page);
  await loginUI(page, 'terra');
  await page.goto(`/applications/${id}`);
  await page.getByRole('button', { name: 'Добавить образец', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Добавить образец', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Добавить образец', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Добавить образец', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Передать дополнения банку', exact: true }).click();
  await expect.poll(async () => (await getDetail(page, id)).application.status).toBe('submitted');
  await logoutUI(page);
  await loginUI(page, 'bank');
  await bankReview(page, id);
  const reviewed = await getDetail(page, id);
  expect(reviewed.application.status).toBe('approved');
  expect(reviewed.timeline.some((e) => e.action === 'supplemented')).toBeTruthy();
  await screenshot(page, info, 'needs-info-resolved');
  await logoutUI(page);
  await loginUI(page, 'terra');
  await page.goto(`/applications/${id}`);
  await page.getByRole('button', { name: 'Принять условия', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Принять условия', exact: true })
    .click();
  await page.getByRole('button', { name: 'Ознакомиться и подписать', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Подтвердить документ', exact: true })
    .click();
  await page.getByRole('button', { name: 'Смоделировать выдачу', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Подтвердить условную выдачу', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Финансовый маршрут пройден', exact: true }),
  ).toBeVisible();
  const completed = await getDetail(page, id);
  expect(completed.application.status).toBe('funded');
  expect(completed.timeline.filter((event) => event.action === 'supplemented')).toHaveLength(1);
  expect(completed.timeline.filter((event) => event.action === 'funded')).toHaveLength(1);
  await screenshot(page, info, 'needs-info-funded');
});

for (const scenario of [
  { company: 'sever' as const, amount: 8000000, termMonths: 12, outcome: 'counter_offer' },
  { company: 'vector' as const, amount: 1200000, termMonths: 24, outcome: 'declined' },
]) {
  test(`bank result ${scenario.outcome} shows reasons and preserves the policy`, async ({
    page,
  }, info) => {
    await loginUI(page, scenario.company);
    const id = await apiApplication(page, {
      amount: scenario.amount,
      termMonths: scenario.termMonths,
    });
    await logoutUI(page);
    await loginUI(page, 'bank');
    await bankReview(page, id);
    const result = await getDetail(page, id);
    expect(result.application.status).toBe(scenario.outcome);
    expect(result.application.decision!.reasons.length).toBeGreaterThan(0);
    await screenshot(page, info, scenario.outcome);
    if (scenario.outcome === 'counter_offer') {
      const offer = result.application.decision!.offer!;
      expect(offer.amount).toBeLessThan(scenario.amount);
      await logoutUI(page);
      await loginUI(page, scenario.company);
      await page.goto(`/applications/${id}`);
      await expect(page.getByRole('heading', { name: 'Решение банка', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Принять условия', exact: true }).click();
      const displayedAmount = page.getByRole('dialog').locator('.loan-summary-amount strong');
      expect(Number((await displayedAmount.innerText()).replace(/\D/g, ''))).toBe(offer.amount);
      await page.getByRole('dialog').getByRole('checkbox').check();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Принять условия', exact: true })
        .click();
      await page.getByRole('button', { name: 'Ознакомиться и подписать', exact: true }).click();
      const accepted = await getDetail(page, id),
        contract = accepted.documents.find((d) => d.category === 'contract')!;
      const contractText = await (await page.request.get(contract.downloadUrl)).text();
      expect(contractText).toContain(`Сумма ${offer.amount} RUB`);
      expect(contractText).not.toContain(`Сумма ${scenario.amount} RUB`);
      await page.getByRole('dialog').getByRole('checkbox').check();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Подтвердить документ', exact: true })
        .click();
      await page.getByRole('button', { name: 'Смоделировать выдачу', exact: true }).click();
      await page.getByRole('dialog').getByRole('checkbox').check();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Подтвердить условную выдачу', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Финансовый маршрут пройден', exact: true }),
      ).toBeVisible();
      const funded = await getDetail(page, id);
      expect(funded.application.status).toBe('funded');
      expect(funded.application.decision!.offer).toEqual(offer);
      expect(funded.application.amount).toBe(scenario.amount);
      await screenshot(page, info, 'counter-offer-funded');
    }
  });
}

test('theme, interests and optional widgets persist and affect the interface', async ({
  page,
}, info) => {
  await loginUI(page, 'terra');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click();
  await page.getByRole('button', { name: 'Янтарный', exact: true }).click();
  await page.getByLabel('Риски и финансовая устойчивость', { exact: true }).check();
  await page.getByLabel(/Персональная лента/).uncheck();
  await page.getByLabel(/Подсказка о репетиции/).uncheck();
  await expect(page.locator('.preferences-status.is-saved').first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'amber');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Тёмная', exact: true })).toHaveClass(/selected/);
  const contrast = await page
    .locator('.settings-section h2')
    .first()
    .evaluate((heading) => {
      const foreground = getComputedStyle(heading).color;
      const background = getComputedStyle(heading.closest('.settings-section')!).backgroundColor;
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const first = luminance(foreground),
        second = luminance(background);
      return {
        foreground,
        background,
        ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
      };
    });
  expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
  await screenshot(page, info, 'dark-amber-settings');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'К вашему контексту', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('heading', { name: 'Реестр заявок', exact: true })).toBeVisible();
  await page.goto('/feed');
  await expect(
    page.getByRole('heading', { name: 'Проверьте, что останется после платежа', exact: true }),
  ).toBeVisible();
  await screenshot(page, info, 'personalized-risk-feed');
  await page.request.patch('/api/preferences', {
    data: {
      theme: 'light',
      accent: 'violet',
      interests: ['growth', 'cashflow'],
      widgets: ['feed', 'applications', 'actions', 'simulator'],
    },
  });
});

test('revenue stress changes free cash and affordability without creating an application', async ({
  page,
}, info) => {
  await loginUI(page);
  const before = (await (await page.request.get('/api/applications')).json()).applications.length;
  await page.goto('/simulator');
  await expect(page.getByText('Есть запас для нового платежа', { exact: true })).toBeVisible();
  const remainder = page
    .locator('.result-breakdown > div')
    .filter({ hasText: 'Останется свободно в месяц' })
    .locator('b');
  const rubles = (value: string) => Number(value.replace(/[^\d-]/g, ''));
  const baseline = rubles(await remainder.innerText());
  const payment = rubles(await page.locator('.payment-number').innerText());
  await page.getByRole('button', { name: '−30%', exact: true }).click();
  await expect(page.getByText('Нагрузка требует внимания', { exact: true })).toBeVisible();
  await expect(page.locator('.scenario-result')).toHaveAttribute('aria-busy', 'false');
  expect(baseline - rubles(await remainder.innerText())).toBe(720000);
  expect(rubles(await remainder.innerText())).toBeLessThan(0);
  expect(rubles(await page.locator('.payment-number').innerText())).toBe(payment);
  await screenshot(page, info, 'revenue-stress-warning');
  await page.getByRole('button', { name: 'Без снижения', exact: true }).click();
  await expect(page.getByText('Есть запас для нового платежа', { exact: true })).toBeVisible();
  expect(rubles(await remainder.innerText())).toBe(baseline);
  await page.getByRole('button', { name: 'График платежей', exact: true }).click();
  await expect(page.locator('.schedule-section tbody tr')).toHaveCount(24);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать CSV', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('debitus-payment-schedule-demo.csv');
  const after = (await (await page.request.get('/api/applications')).json()).applications.length;
  expect(after).toBe(before);
  await screenshot(page, info, 'payment-schedule');
});
