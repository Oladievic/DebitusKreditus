import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

const mode = process.argv[2];
assert.ok(
  ['before', 'after'].includes(mode),
  'Использование: node scripts/check-persistence.mjs before|after',
);
assert.ok(
  process.env.CI === 'true' || process.env.PERSISTENCE_ALLOW_LOCAL === 'true',
  'Проверка разрешена только в CI или на отдельном локальном сервере с PERSISTENCE_ALLOW_LOCAL=true.',
);
const url = new URL(
  process.env.PERSISTENCE_BASE_URL ?? process.env.LOCAL_WORKER_URL ?? 'http://127.0.0.1:3000',
);
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.protocol === 'http:',
  'Проверка создаёт синтетические данные только на локальном HTTP-сервере.',
);
const base = url.origin;
const fixturePath = path.resolve(process.env.PERSISTENCE_FIXTURE ?? 'output/ci/persistence.json');
assert.ok(
  ['output', '.cache'].some((folder) => {
    const relative = path.relative(path.resolve(folder), fixturePath);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  }),
  'Fixture должен находиться в ignored output/ или .cache/ текущего проекта.',
);

async function call(route, method = 'GET', body, cookie) {
  const response = await fetch(`${base}/api${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  assert.ok(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(result)}`);
  return { response, result };
}
async function login() {
  const { response } = await call('/auth/login', 'POST', {
    email: 'owner@sever.example.test',
    password: 'Demo2026!',
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('dk_session='), 'Сессия проверки не создана.');
  return cookie;
}
const applicationSnapshot = (application) =>
  Object.fromEntries(
    [
      'id',
      'version',
      'purpose',
      'amount',
      'termMonths',
      'productId',
      'financials',
      'status',
      'organizationId',
    ].map((key) => [key, application[key]]),
  );

if (mode === 'before') {
  await mkdir(path.dirname(fixturePath), { recursive: true });
  const fixture = await open(fixturePath, 'wx');
  let cookie;
  try {
    const marker = `persistence-${randomUUID()}`;
    cookie = await login();
    const { result: created } = await call(
      '/applications',
      'POST',
      {
        productId: 'working_capital',
        amount: 1234000,
        termMonths: 24,
        purpose: `Запас сырья ${marker}`,
        financials: {
          monthlyRevenue: 2400000,
          monthlyExpenses: 1650000,
          monthlyDebtPayment: 120000,
        },
        consent: false,
      },
      cookie,
    );
    const id = created.application.id;
    await call(
      `/applications/${id}`,
      'PATCH',
      {
        version: created.application.version,
        amount: 1345000,
        purpose: `Обновлённый запас сырья ${marker}`,
      },
      cookie,
    );
    const { result: uploaded } = await call(
      `/applications/${id}/documents/sample`,
      'POST',
      { category: 'statement' },
      cookie,
    );
    const { result: detail } = await call(`/applications/${id}`, 'GET', undefined, cookie);
    assert.ok(detail.application.version > created.application.version);
    await fixture.writeFile(
      JSON.stringify(
        {
          schemaVersion: 1,
          marker,
          target: base,
          savedAt: new Date().toISOString(),
          application: applicationSnapshot(detail.application),
          document: {
            id: uploaded.document.id,
            sha256: uploaded.document.sha256,
            size: uploaded.document.size,
          },
          timelineIds: detail.timeline.map((event) => event.id).sort(),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      JSON.stringify({
        phase: mode,
        applicationId: id,
        version: detail.application.version,
        fixture: fixturePath,
      }),
    );
  } finally {
    await fixture.close();
    if (cookie) await call('/auth/logout', 'POST', {}, cookie).catch(() => {});
  }
} else {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.target, base, 'До и после перезапуска нужен один целевой сервер.');
  assert.match(fixture.marker, /^persistence-[0-9a-f-]{36}$/);
  assert.match(fixture.application.id, /^app_[0-9a-f]{20}$/);
  assert.ok(fixture.application.purpose.includes(fixture.marker));
  const cookie = await login();
  try {
    const { result: detail } = await call(
      `/applications/${fixture.application.id}`,
      'GET',
      undefined,
      cookie,
    );
    assert.deepEqual(
      applicationSnapshot(detail.application),
      fixture.application,
      'Данные заявки изменились после перезапуска.',
    );
    assert.deepEqual(
      detail.timeline.map((event) => event.id).sort(),
      fixture.timelineIds,
      'История заявки не сохранилась.',
    );
    const document = detail.documents.find((entry) => entry.id === fixture.document.id);
    assert.ok(document, 'Документ заявки не сохранился.');
    assert.equal(document.sha256, fixture.document.sha256);
    assert.equal(document.size, fixture.document.size);
    const response = await fetch(`${base}/api/documents/${document.id}/download`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(10000),
    });
    assert.ok(response.ok, `Скачивание сохранённого документа: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, fixture.document.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.document.sha256);
    console.log(
      JSON.stringify({
        phase: mode,
        applicationId: detail.application.id,
        version: detail.application.version,
        persisted: true,
        documentBytes: bytes.length,
        timelineEvents: detail.timeline.length,
      }),
    );
  } finally {
    await call('/auth/logout', 'POST', {}, cookie).catch(() => {});
  }
}
