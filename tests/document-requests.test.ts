import test from 'node:test';
import assert from 'node:assert/strict';
import { documentRequestStatus } from '../shared/document-requests.js';
import type { Application, ApplicationDetail, CreditDecision } from '../shared/types.js';
import { createApp } from '../server/app.js';
import { initializeDatabase } from '../server/seed.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';

const at = '2026-10-24T12:00:00.000Z';
const decision: CreditDecision = {
  outcome: 'needs_info',
  reasons: ['Приложите свежую отчётность.'],
  requestedDocuments: ['financials'],
  offer: null,
  ruleVersion: 'credit-policy-v2',
  decidedBy: 'bank',
  decidedAt: at,
  documentRequest: {
    id: 'request-test',
    requestedAt: at,
    baselineDocumentIds: ['old'],
    categories: ['financials'],
    methodVersion: 'document-id-baseline-v1',
  },
};
const old = { id: 'old', category: 'financials', createdAt: at };

test('document request requires a new ID in the requested category even when timestamps are identical', () => {
  const original = structuredClone(decision);
  const existing = documentRequestStatus(decision, [old]);
  assert.equal(existing.complete, false);
  assert.equal(existing.mode, 'id_baseline');
  assert.equal(existing.requestId, 'request-test');
  assert.deepEqual(existing.categories[0].existingDocumentIds, ['old']);
  assert.deepEqual(existing.categories[0].matchingDocumentIds, []);
  assert.equal(
    documentRequestStatus(decision, [old, { ...old, id: 'wrong-category', category: 'statement' }])
      .complete,
    false,
  );
  const added = documentRequestStatus(decision, [old, { ...old, id: 'fresh' }]);
  assert.equal(added.complete, true);
  assert.deepEqual(added.categories[0].matchingDocumentIds, ['fresh']);
  assert.deepEqual(decision, original);
});

test('every requested category needs its own new attachment and no pending request is created from another outcome', () => {
  const multiple: CreditDecision = {
    ...decision,
    requestedDocuments: ['statement', 'financials'],
    documentRequest: { ...decision.documentRequest!, categories: ['statement', 'financials'] },
  };
  const one = documentRequestStatus(multiple, [old, { ...old, id: 'fresh' }]);
  assert.equal(one.complete, false);
  assert.deepEqual(
    one.categories.filter((item) => !item.satisfied).map((item) => item.category),
    ['statement'],
  );
  assert.equal(
    documentRequestStatus(multiple, [
      old,
      { ...old, id: 'fresh' },
      { ...old, id: 'statement-fresh', category: 'statement' },
    ]).complete,
    true,
  );
  assert.equal(documentRequestStatus({ ...decision, outcome: 'approved' }, [old]).mode, 'none');
  assert.equal(documentRequestStatus(null, []).complete, true);
});

test('legacy request uses an explicit strictly newer timestamp fallback and never treats equal or invalid dates as proof', () => {
  const legacy = { ...decision, documentRequest: undefined };
  for (const createdAt of [at, '2026-10-24T11:59:59.999Z', 'not-a-date'])
    assert.equal(
      documentRequestStatus(legacy, [{ ...old, id: 'new-looking-id', createdAt }]).complete,
      false,
    );
  const result = documentRequestStatus(legacy, [{ ...old, createdAt: '2026-10-24T12:00:00.001Z' }]);
  assert.equal(result.mode, 'legacy_timestamp');
  assert.equal(result.requestId, null);
  assert.equal(result.complete, true);
  assert.match(result.note, /нет списка исходных файлов/);
  assert.match(result.note, /не подтверждает|Содержание проверит банк/);
  const invalid = documentRequestStatus({ ...legacy, decidedAt: 'unknown' }, [
    { ...old, createdAt: '2026-10-25T12:00:00.000Z' },
  ]);
  assert.equal(invalid.complete, false);
  assert.equal(invalid.requestedAt, null);
});

const input = {
  productId: 'working_capital',
  amount: 1200000,
  termMonths: 24,
  purpose: 'Материалы для проверки документов',
  consent: true,
  financials: { monthlyRevenue: 2400000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
};
async function setup() {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
  const call = (
    path: string,
    cookie = '',
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
    headers: Record<string, string> = {},
  ) =>
    app.request(`http://localhost/api${path}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (email: string) => {
    const response = await call('/auth/login', '', { email, password: 'Demo2026!' });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const owner = await login('owner@sever.example.test'),
    terra = await login('owner@terra.example.test'),
    bank = await login('bank@debitus.example.test'),
    admin = await login('admin@debitus.example.test');
  const read = async (response: Response) => {
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  };
  const create = async (withDocuments = true) => {
    const { application } = (await read(await call('/applications', owner, input))) as {
      application: Application;
    };
    if (withDocuments)
      for (const category of ['statement', 'financials'])
        await read(
          await call(`/applications/${application.id}/documents/sample`, owner, { category }),
        );
    const detail = (await read(
      await call(`/applications/${application.id}`, owner),
    )) as ApplicationDetail;
    return (await read(
      await call(`/applications/${application.id}/actions/submit`, owner, {
        version: detail.application.version,
      }),
    )) as ApplicationDetail;
  };
  const request = async (id: string, categories?: string[]) => {
    const detail = (await read(await call(`/applications/${id}`, bank))) as ApplicationDetail;
    const review = (await read(
      await call(`/bank/applications/${id}/review`, bank, { version: detail.application.version }),
    )) as ApplicationDetail;
    return (await read(
      await call(`/bank/applications/${id}/decision`, bank, {
        version: review.application.version,
        ...(categories
          ? {
              outcome: 'needs_info',
              requestedDocuments: categories,
              reason: 'Приложите свежий оригинал отчётности за последний месяц.',
              documentRequest: { baselineDocumentIds: [] },
            }
          : {}),
      }),
    )) as ApplicationDetail;
  };
  const upload = async (id: string, cookie = owner) => {
    const body = new FormData();
    body.set('category', 'financials');
    body.set(
      'file',
      new Blob(['Синтетическая отчётность за новый месяц'], { type: 'text/plain' }),
      'Отчётность-новый-месяц.txt',
    );
    return app.request(`http://localhost/api/applications/${id}/documents`, {
      method: 'POST',
      headers: { cookie },
      body,
    });
  };
  return { db, app, call, owner, terra, bank, admin, read, create, request, upload };
}

test('bank request snapshots existing IDs, rejects old attachments and accepts a new original even in the same millisecond', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const sent = await s.create();
  const detail = await s.request(sent.application.id, ['financials']);
  const id = detail.application.id,
    metadata = detail.application.decision!.documentRequest!;
  assert.equal(metadata.methodVersion, 'document-id-baseline-v1');
  assert.deepEqual(
    [...metadata.baselineDocumentIds].sort(),
    detail.documents.map((document) => document.id).sort(),
  );
  assert.deepEqual(metadata.categories, ['financials']);
  assert.equal(metadata.requestedAt, detail.application.decision!.decidedAt);
  const before = await s.db.query('SELECT * FROM applications WHERE id=?', [id]);
  const auditBefore = await s.db.query('SELECT * FROM audit WHERE application_id=?', [id]);
  const denied = await s.call(`/applications/${id}/actions/supplement`, s.owner, {
    version: detail.application.version,
  });
  assert.equal(denied.status, 400);
  assert.deepEqual((await denied.json()).error.details.missing, ['financials']);
  assert.deepEqual(await s.db.query('SELECT * FROM applications WHERE id=?', [id]), before);
  assert.deepEqual(
    await s.db.query('SELECT * FROM audit WHERE application_id=?', [id]),
    auditBefore,
  );
  const added = await s.read(await s.upload(id));
  await s.db.run('UPDATE documents SET created_at=? WHERE id=?', [
    metadata.requestedAt,
    added.document.id,
  ]);
  const uploaded = (await s.read(
    await s.call(`/applications/${id}`, s.owner),
  )) as ApplicationDetail;
  assert.equal(uploaded.documents.length, sent.documents.length + 1);
  for (const old of sent.documents)
    assert.ok(
      uploaded.documents.some(
        (document) => document.id === old.id && document.sha256 === old.sha256,
      ),
    );
  assert.equal(uploaded.application.status, 'needs_info');
  assert.deepEqual(uploaded.application.decision, detail.application.decision);
  const result = (await s.read(
    await s.call(`/applications/${id}/actions/supplement`, s.owner, {
      version: uploaded.application.version,
    }),
  )) as ApplicationDetail;
  assert.equal(result.application.status, 'submitted');
  assert.equal(result.application.decision, null);
  assert.equal(result.timeline.filter((event) => event.action === 'supplemented').length, 1);
});

test('a repeated bank request has a new ID and requires another requested-category file rather than any new file', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const sent = await s.create();
  const first = await s.request(sent.application.id, ['financials']);
  const fresh = await s.read(await s.upload(sent.application.id));
  let current = (await s.read(
    await s.call(`/applications/${sent.application.id}`, s.owner),
  )) as ApplicationDetail;
  await s.read(
    await s.call(`/applications/${sent.application.id}/actions/supplement`, s.owner, {
      version: current.application.version,
    }),
  );
  const second = await s.request(sent.application.id, ['financials']);
  assert.notEqual(
    second.application.decision!.documentRequest!.id,
    first.application.decision!.documentRequest!.id,
  );
  assert.ok(
    second.application.decision!.documentRequest!.baselineDocumentIds.includes(fresh.document.id),
  );
  assert.equal(
    documentRequestStatus(second.application.decision, second.documents).complete,
    false,
  );
  await s.read(
    await s.call(`/applications/${sent.application.id}/documents/sample`, s.owner, {
      category: 'statement',
    }),
  );
  current = (await s.read(
    await s.call(`/applications/${sent.application.id}`, s.owner),
  )) as ApplicationDetail;
  assert.equal(
    (
      await s.call(`/applications/${sent.application.id}/actions/supplement`, s.owner, {
        version: current.application.version,
      })
    ).status,
    400,
  );
  await s.read(
    await s.call(`/applications/${sent.application.id}/documents/sample`, s.owner, {
      category: 'financials',
    }),
  );
  current = (await s.read(
    await s.call(`/applications/${sent.application.id}`, s.owner),
  )) as ApplicationDetail;
  assert.equal(current.application.status, 'needs_info');
  assert.equal(
    (
      await s.call(`/applications/${sent.application.id}/actions/supplement`, s.owner, {
        version: current.application.version,
      })
    ).status,
    200,
  );
});

test('automatic needs_info decisions also capture a baseline and legacy seeded requests keep a truthful freshness fallback', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const sent = await s.create(false);
  const automatic = await s.request(sent.application.id);
  assert.equal(automatic.application.status, 'needs_info');
  assert.deepEqual(automatic.application.decision!.documentRequest!.baselineDocumentIds, []);
  assert.deepEqual(automatic.application.decision!.documentRequest!.categories.sort(), [
    'financials',
    'statement',
  ]);
  const legacyId = 'app_terra_missing';
  const legacy = (await s.read(
    await s.call(`/applications/${legacyId}`, s.terra),
  )) as ApplicationDetail;
  assert.equal(legacy.application.decision!.documentRequest, undefined);
  const old = await s.read(
    await s.call(`/applications/${legacyId}/documents/sample`, s.terra, { category: 'financials' }),
  );
  await s.db.run('UPDATE documents SET created_at=? WHERE id=?', [
    legacy.application.decision!.decidedAt,
    old.document.id,
  ]);
  let current = (await s.read(
    await s.call(`/applications/${legacyId}`, s.terra),
  )) as ApplicationDetail;
  const rejected = await s.call(`/applications/${legacyId}/actions/supplement`, s.terra, {
    version: current.application.version,
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.details.mode, 'legacy_timestamp');
  await s.read(
    await s.call(`/applications/${legacyId}/documents/sample`, s.terra, { category: 'financials' }),
  );
  current = (await s.read(await s.call(`/applications/${legacyId}`, s.terra))) as ApplicationDetail;
  assert.equal(
    (
      await s.call(`/applications/${legacyId}/actions/supplement`, s.terra, {
        version: current.application.version,
      })
    ).status,
    200,
  );
});

test('document request enforcement keeps tenant and role checks; read tokens cannot attach files or supplement', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const sent = await s.create();
  const detail = await s.request(sent.application.id, ['financials']);
  const id = detail.application.id;
  assert.equal((await s.upload(id, s.terra)).status, 404);
  assert.equal((await s.upload(id, s.bank)).status, 403);
  assert.equal((await s.upload(id, s.admin)).status, 403);
  assert.equal(
    (
      await s.call(`/applications/${id}/actions/supplement`, s.terra, {
        version: detail.application.version,
      })
    ).status,
    404,
  );
  const token = await s.read(
    await s.call('/integrations/tokens', s.owner, { name: 'Проверка запроса документов' }),
  );
  assert.equal(
    (
      await s.call(
        `/applications/${id}/actions/supplement`,
        '',
        { version: detail.application.version },
        'POST',
        { authorization: `Bearer ${token.token}` },
      )
    ).status,
    403,
  );
  const persisted = (await s.read(
    await s.call(`/applications/${id}`, s.owner),
  )) as ApplicationDetail;
  assert.equal(persisted.application.status, 'needs_info');
  assert.equal(persisted.documents.length, detail.documents.length);
});
