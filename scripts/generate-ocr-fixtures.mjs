import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1080 } });
  await page.setContent(
    '<html lang="ru"><body style="margin:0"><canvas width="1400" height="1080"></canvas></body></html>',
  );
  const data = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#182026';
    ctx.font = 'bold 46px Arial';
    ctx.fillText('ФИНАНСОВАЯ СПРАВКА', 90, 120);
    ctx.font = '32px Arial';
    const lines = [
      'Северная мастерская',
      'Период: сентябрь 2026',
      '',
      'Выручка в месяц: 2 400 000 RUB',
      'Операционные расходы в месяц: 1 650 000 RUB',
      'Кредитные платежи в месяц: 120 000 RUB',
      '',
      'Currency: RUB',
      '',
      'Синтетический образец для проверки распознавания.',
      'Не подтверждает реальные сведения компании.',
    ];
    lines.forEach((line, index) => ctx.fillText(line, 90, 210 + index * 64));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await mkdir('public/fixtures', { recursive: true });
  await writeFile('public/fixtures/financial-scan.png', Buffer.from(data, 'base64'));
  await page.pdf({
    path: 'public/fixtures/financial-scan.pdf',
    width: '1400px',
    height: '1080px',
    printBackground: true,
    margin: { top: 0, left: 0, right: 0, bottom: 0 },
  });
} finally {
  await browser.close();
}
