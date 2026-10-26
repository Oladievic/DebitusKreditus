import { expect, test } from '@playwright/test';
import { loginUI, noOverflow, screenshot } from './helpers';

test('cabinet responds to a pointer, respects motion preferences and exposes stage details', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginUI(page);
  const route = page.locator('.funding-route');
  const heading = route.locator('.funding-route-heading h2');
  await heading.scrollIntoViewIfNeeded();
  const box = (await route.boundingBox())!;
  const headingBox = (await heading.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, headingBox.y + 10);
  await expect(route).toHaveAttribute('data-pointer-active', 'true');
  await expect
    .poll(() =>
      route.evaluate((el) => parseFloat((el as HTMLElement).style.getPropertyValue('--pointer-x'))),
    )
    .toBeLessThan(45);
  await page.mouse.move(box.x + box.width * 0.8, headingBox.y + 10);
  await expect
    .poll(() =>
      route.evaluate((el) => parseFloat((el as HTMLElement).style.getPropertyValue('--pointer-x'))),
    )
    .toBeGreaterThan(60);
  const decisionStage = route.getByRole('button', {
    name: /^Решение: (предстоящий этап|текущий этап|пройдено)$/,
  });
  await decisionStage.click();
  await expect(decisionStage).toHaveAttribute('aria-pressed', 'true');
  await expect(route.locator('.funding-inspection h3')).toHaveText('Решение');
  await expect(route.locator('.funding-inspection')).toContainText(
    'Новые условия принимаются отдельно',
  );
  const expense = page.getByRole('button', { name: /^Операционные расходы:/ });
  await expense.focus();
  await expense.press('Enter');
  await expect(page.locator('.cash-lens-readout > span')).toHaveText('Операционные расходы');
  await expect(page.locator('.cash-lens-readout strong')).toContainText('1 650 000');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await heading.scrollIntoViewIfNeeded();
  const reducedBox = (await heading.boundingBox())!;
  await page.mouse.move(reducedBox.x + 30, reducedBox.y + 8);
  await expect(route).not.toHaveAttribute('data-pointer-active', 'true');
  await expect(page.locator('.cash-lens-bar.is-selected > span')).toHaveCSS('transform', 'none');
  await expect(page.locator('body')).toHaveCSS('font-family', /Golos Text/);
  await expect(page.locator('.dashboard-heading h1')).toHaveCSS('font-family', /Geologica/);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  const markers = await page
    .locator('.funding-stage-marker')
    .evaluateAll((elements) =>
      elements.map((el) => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })),
    );
  expect(Math.max(...markers.map((x) => x.x)) - Math.min(...markers.map((x) => x.x))).toBeLessThan(
    2,
  );
  expect(markers[4].y).toBeGreaterThan(markers[0].y + 200);
  await screenshot(page, info, 'vertical-funding-route');
});
