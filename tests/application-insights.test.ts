import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApplicationActionPlan,
  type ApplicationActionPlan,
} from '../shared/application-actions.js';
import { buildApplicationChanges, type ApplicationChanges } from '../shared/application-changes.js';
import { analyzeStatement, STATEMENT_HEADER, type StatementReport } from '../shared/statements.js';
import type {
  ApplicationDetail,
  ApplicationStatus,
  TimelineEvent,
  DocumentRecord,
} from '../shared/types.js';
import { businessProfile } from '../shared/business-profile.js';
import { assess, newApplication, productById } from '../server/domain.js';
import { applicationAuditContext } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { initializeDatabase, DEMO_ORGANIZATIONS } from '../server/seed.js';
import { openSqliteDatabase } from '../server/runtime/sqlite.js';

const at = '2026-10-24T10:00:00.000Z';
const financials = {
  monthlyRevenue: 2400000,
  monthlyExpenses: 1650000,
  monthlyDebtPayment: 120000,
};
function dossier(status: ApplicationStatus = 'draft'): ApplicationDetail {
  const organization = structuredClone(DEMO_ORGANIZATIONS[0]);
  organization.profile = businessProfile(organization);
  const application = newApplication(
    {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      purpose: 'Материалы для производства',
      financials: { ...financials },
      consent: true,
    },
    organization,
    'app_insights',
    at,
  );
  application.status = status;
  application.organizationSnapshot = structuredClone(organization);
  return {
    application,
    organization,
    product: productById(application.productId),
    documents: [],
    timeline: [],
    assessment: assess(application, organization, [], 'bank', at),
  };
}
function event(
  detail: ApplicationDetail,
  version: number,
  action: string,
  id = `event-${version}`,
): TimelineEvent {
  const application = { ...structuredClone(detail.application), version };
  return {
    id,
    action,
    title: action,
    detail: '',
    actor: 'Сотрудник',
    createdAt: at,
    context: applicationAuditContext(application),
  };
}
function document(id: string, createdAt: string): DocumentRecord {
  return {
    id,
    applicationId: 'app_insights',
    name: `${id}.txt`,
    category: 'financials',
    mimeType: 'text/plain',
    size: 20,
    sha256: 'a'.repeat(64),
    createdAt,
    downloadUrl: `/api/documents/${id}/download`,
    synthetic: false,
  };
}
function report(detail: ApplicationDetail, version = 2, id = 'statement'): StatementReport {
  return {
    id,
    applicationId: detail.application.id,
    organizationId: detail.application.organizationId,
    documentId: `doc-${id}`,
    documentName: 'Обороты.csv',
    sourceSha256: 'a'.repeat(64),
    sourceSize: 50,
    createdAt: at,
    createdBy: 'owner',
    applicationVersion: version,
    profileVersion: 1,
    analysis: analyzeStatement(
      `${STATEMENT_HEADER}\n2026-09-01;in;1200000;buyer;Покупатель;revenue;S1\n`,
      { from: '2026-09-01', to: '2026-09-30' },
      detail.application.financials,
    ),
  };
}

test('action plan combines missing categories without treating OCR or statement presence as verification', () => {
  const detail = dossier();
  detail.application.consent = false;
  detail.documents = [
    {
      ...document('ocr', at),
      category: 'statement',
      ocr: {
        sourceName: 'scan.png',
        sourceSha256: 'b'.repeat(64),
        sourceSize: 30,
        sourceMimeType: 'image/png',
        pages: 1,
        engine: 'tesseract',
        reviewedAt: at,
        reviewedBy: 'owner',
      },
    },
  ];
  const plan = buildApplicationActionPlan(detail, [], at);
  assert.deepEqual(
    plan.items.map((item) => item.id),
    ['missing-documents', 'consent', 'submit'],
  );
  assert.match(plan.items[0].what, /Баланс/);
  assert.doesNotMatch(plan.items[0].what, /Выписка/);
  assert.match(plan.limitations.join(' '), /не считаются подтверждённым/);
  assert.ok(plan.items.every((item) => item.sources.every((source) => source.at && source.href)));
});

test('action plan requires a new file for the current request and marks the package ready only after that file', () => {
  const detail = dossier('needs_info');
  detail.documents = [document('fin', at), { ...document('statement', at), category: 'statement' }];
  detail.application.decision = {
    ...detail.assessment.decision,
    outcome: 'needs_info',
    requestedDocuments: ['financials'],
    reasons: ['Нужна отчётность за последний квартал.'],
    offer: null,
    documentRequest: {
      id: 'request-current',
      requestedAt: at,
      baselineDocumentIds: detail.documents.map((item) => item.id),
      categories: ['financials'],
      methodVersion: 'document-id-baseline-v1',
    },
  };
  let plan = buildApplicationActionPlan(detail, [], at);
  assert.equal(
    plan.items.some((item) => item.id === 'missing-documents'),
    true,
  );
  assert.match(
    plan.items.find((item) => item.id === 'missing-documents')!.why,
    /последний квартал/,
  );
  detail.documents.push(document('new-file', at));
  plan = buildApplicationActionPlan(detail, [], at);
  assert.equal(
    plan.items.some((item) => item.id === 'missing-documents'),
    false,
  );
  assert.equal(
    plan.items.find((item) => item.id === 'requested-documents')!.title,
    'Новые файлы готовы к проверке банка',
  );
  assert.ok(plan.items.some((item) => item.id === 'supplement'));
});

test('financial freshness uses the current editable profile and points to the actual field', () => {
  const detail = dossier('needs_info');
  detail.organization.profile!.financialsAsOf = '2026-01-01';
  const old = buildApplicationActionPlan(detail, [], at);
  const stale = old.items.find((item) => item.id === 'stale-financials')!;
  assert.equal(stale.href, '/business#profile-financialsAsOf');
  const current = structuredClone(detail.organization);
  current.profile!.financialsAsOf = '2026-10-01';
  current.profile!.version = 2;
  assert.equal(
    buildApplicationActionPlan(detail, [], at, current).items.some(
      (item) => item.id === 'stale-financials',
    ),
    false,
  );
});

test('saved statement actions retain frozen comparison provenance after the form changes', () => {
  const detail = dossier();
  detail.application.version = 3;
  const saved = report(detail);
  detail.application.financials.monthlyRevenue = 3000000;
  const snapshot = structuredClone(saved);
  const item = buildApplicationActionPlan(detail, [saved], at).items.find(
    (item) => item.id === 'statement-review',
  )!;
  assert.match(item.what, /Старый отчёт/);
  assert.equal(item.sources[0].version, 2);
  assert.equal(item.sources[0].at, saved.createdAt);
  assert.deepEqual(saved, snapshot);
});

test('decision stages expose the appropriate next action without reviving editable-document tasks', () => {
  for (const [status, fragment] of [
    ['approved', '#application-decision'],
    ['counter_offer', '#financing-alternatives'],
    ['accepted', '#application-terms'],
    ['signed', '#application-terms'],
    ['funded', '#application-servicing'],
  ] as const) {
    const plan = buildApplicationActionPlan(dossier(status), [], at);
    assert.equal(plan.items.length, 1);
    assert.ok(plan.items[0].href.endsWith(fragment));
    assert.equal(plan.items[0].id, status);
  }
  for (const status of ['submitted', 'in_review'] as const)
    assert.equal(
      buildApplicationActionPlan(dossier(status), [], at).items.at(-1)!.href,
      '/applications/app_insights#application-assessment',
    );
});

test('declined hard constraints do not instruct the user to edit registry or credit history fields', () => {
  const detail = dossier('declined');
  detail.organization.overdueDays = 90;
  detail.application.organizationSnapshot = structuredClone(detail.organization);
  detail.assessment = assess(detail.application, detail.organization, [], 'bank', at);
  Object.assign(detail.application, detail.assessment);
  const plan = buildApplicationActionPlan(detail, [], at);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].id, 'policy-constraints');
  assert.match(plan.items[0].why, /изменение поля не подтверждает исправление/);
  assert.doesNotMatch(plan.items[0].href, /business/);
});

test('draft preliminary cash constraints name their calculation source without inventing registry failure', () => {
  const detail = dossier();
  detail.application.financials.monthlyExpenses = 3000000;
  detail.assessment = assess(detail.application, detail.organization, [], 'preview', at);
  const plan = buildApplicationActionPlan(detail, [], at);
  const stop = plan.items.find((item) => item.id === 'policy-constraints')!;
  assert.match(stop.title, /предварительного расчёта/);
  assert.match(stop.what, /денежного потока/);
  assert.equal(stop.sources[0].kind, 'calculation');
  assert.doesNotMatch(stop.why, /регистрации/);
  assert.equal(detail.application.decision, null);
});

test('closed servicing changes the funded plan without changing the application status or version', () => {
  const detail = dossier('funded');
  const plan = buildApplicationActionPlan(detail, [], at, detail.organization, {
    status: 'closed',
    version: 4,
    history: [],
    fundedAt: at,
  });
  assert.equal(plan.status, 'funded');
  assert.equal(plan.applicationVersion, 1);
  assert.equal(plan.headline, 'Кредит погашен в модели');
  assert.equal(plan.items[0].title, 'Сохраните историю погашения');
  assert.equal(plan.items[0].sources[0].version, 4);
  assert.match(plan.items[0].sources[0].detail!, /к сопровождению/);
});

test('bank comparison uses the request version even after later supplement and review at identical timestamps', () => {
  const baseline = dossier('needs_info');
  baseline.application.version = 6;
  Object.assign(baseline.application, baseline.assessment);
  const detail = structuredClone(baseline);
  detail.application.status = 'in_review';
  detail.application.version = 12;
  detail.application.financials.monthlyRevenue = 3200000;
  detail.assessment = assess(detail.application, detail.organization, [], 'bank', at);
  detail.timeline = [
    event(detail, 12, 'review_started', 'a'),
    event(baseline, 6, 'needs_info', 'z'),
    event(detail, 11, 'supplemented', 'b'),
    event(baseline, 4, 'needs_info', 'zz'),
  ];
  const result = buildApplicationChanges(detail, [], at);
  assert.equal(result.baseline.version, 6);
  assert.equal(result.baseline.kind, 'information_request');
  assert.deepEqual(
    result.fields.find((field) => field.key === 'monthlyRevenue'),
    { key: 'monthlyRevenue', label: 'Выручка в месяц, ₽', before: 2400000, after: 3200000 },
  );
  assert.ok(result.factors.some((factor) => factor.code === 'debt'));
  assert.equal(result.hasChanges, true);
});

test('a second request becomes a new baseline and does not reuse the first-cycle change', () => {
  const detail = dossier('needs_info');
  detail.application.version = 10;
  Object.assign(detail.application, detail.assessment);
  const old = structuredClone(detail);
  old.application.financials.monthlyRevenue = 1000000;
  detail.timeline = [event(detail, 10, 'needs_info', 'aaa'), event(old, 4, 'needs_info', 'zzz')];
  const result = buildApplicationChanges(detail, [], at);
  assert.equal(result.baseline.version, 10);
  assert.equal(result.fields.length, 0);
  assert.equal(result.hasChanges, false);
});

test('legacy events without complete inputs report missing snapshots instead of inventing historical zeroes', () => {
  const detail = dossier('submitted');
  detail.timeline = [
    {
      id: 'legacy',
      action: 'needs_info',
      title: '',
      detail: '',
      actor: 'Сотрудник',
      createdAt: at,
    },
  ];
  detail.documents = [document('legacy-doc', at)];
  const result = buildApplicationChanges(detail, [], at);
  assert.equal(result.baseline.available, false);
  assert.deepEqual(result.fields, []);
  assert.deepEqual(result.factors, []);
  assert.equal(result.assessment.before, null);
  assert.equal(result.documents.added.length, 0);
  assert.equal(result.documents.uncertain.length, 1);
});

test('document ordering is conservative for equal timestamps and exact for CSV report versions', () => {
  const detail = dossier('submitted');
  detail.application.version = 9;
  detail.timeline = [event(detail, 5, 'needs_info')];
  const saved = report(detail, 7);
  detail.documents = [
    document('old', '2026-10-24T09:00:00.000Z'),
    document('equal', at),
    document('new', '2026-10-24T11:00:00.000Z'),
    document(saved.documentId, at),
  ];
  const result = buildApplicationChanges(detail, [saved], at);
  assert.deepEqual(
    result.documents.added.map((item) => item.id),
    ['new', saved.documentId],
  );
  assert.deepEqual(
    result.documents.uncertain.map((item) => item.id),
    ['equal'],
  );
});

test('new request document ID baseline proves additions without inventing timestamp order', () => {
  const detail = dossier('needs_info');
  detail.application.version = 8;
  detail.application.decision = {
    ...detail.assessment.decision,
    outcome: 'needs_info',
    requestedDocuments: ['financials'],
    documentRequest: {
      id: 'request',
      requestedAt: at,
      baselineDocumentIds: ['old'],
      categories: ['financials'],
      methodVersion: 'document-id-baseline-v1',
    },
  };
  detail.timeline = [event(detail, 5, 'needs_info')];
  detail.documents = [document('old', '2026-10-24T11:00:00.000Z'), document('new', at)];
  const comparison = buildApplicationChanges(detail, [], at);
  assert.deepEqual(
    comparison.documents.added.map((item) => item.id),
    ['new'],
  );
  assert.equal(comparison.documents.uncertain.length, 0);
  assert.match(comparison.documents.note, /список исходных файлов/);
});

test('unchanged factors and checks do not change merely because evaluation timestamps differ', () => {
  const detail = dossier('in_review');
  detail.application.version = 7;
  Object.assign(detail.application, detail.assessment);
  detail.timeline = [event(detail, 5, 'needs_info')];
  detail.assessment.score.evaluatedAt = '2026-10-24T11:00:00.000Z';
  detail.assessment.checks.forEach((check) => (check.checkedAt = '2026-10-24T11:00:00.000Z'));
  const result = buildApplicationChanges(detail, [], at);
  assert.deepEqual(result.factors, []);
  assert.deepEqual(result.checks, []);
  assert.equal(result.hasChanges, false);
});

test('statement findings compare only matching periods, rules and corresponding financial snapshots', () => {
  const detail = dossier('submitted');
  detail.application.version = 10;
  detail.timeline = [event(detail, 5, 'needs_info')];
  const before = report(detail, 3, 'before');
  const current = report(detail, 8, 'after');
  assert.equal(buildApplicationChanges(detail, [before, current], at).statements.comparable, true);
  current.analysis.findings.find((finding) => finding.severity === 'attention')!.detail +=
    ' Дополнительное пояснение суммы.';
  const changed = buildApplicationChanges(detail, [before, current], at);
  assert.match(changed.statements.current!.findings[0].detail, /Дополнительное пояснение/);
  assert.equal(changed.hasChanges, true);
  current.analysis.period.from = '2026-09-02';
  assert.equal(buildApplicationChanges(detail, [before, current], at).statements.comparable, false);
  current.analysis.period.from = before.analysis.period.from;
  detail.application.financials.monthlyRevenue = 4000000;
  const result = buildApplicationChanges(detail, [before, current], at);
  assert.equal(result.statements.comparable, false);
  assert.match(result.statements.note, /другим суммам/);
});

async function setup() {
  const db = openSqliteDatabase(':memory:');
  db.migrate('migrations');
  await initializeDatabase(db);
  const app = createApp(db);
  const call = (path: string, cookie = '', method = 'GET', body?: unknown) =>
    app.request(`http://localhost/api${path}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (email: string) => {
    const response = await call('/auth/login', '', 'POST', { email, password: 'Demo2026!' });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const owner = await login('owner@sever.example.test');
  const bank = await login('bank@debitus.example.test');
  const created = await read<{ application: ApplicationDetail['application'] }>(
    await call('/applications', owner, 'POST', {
      productId: 'working_capital',
      amount: 1200000,
      termMonths: 24,
      purpose: 'Материалы под контракт',
      financials,
      consent: true,
    }),
  );
  const id = created.application.id;
  const current = async (cookie = owner) =>
    read<ApplicationDetail>(await call(`/applications/${id}`, cookie));
  return { db, call, login, owner, bank, id, current };
}
async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body as T;
}

test('insight HTTP routes enforce owner, non-draft bank visibility and administrator separation', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const other = await s.login('owner@terra.example.test');
  const admin = await s.login('admin@debitus.example.test');
  const plan = `/applications/${s.id}/action-plan`;
  const changes = `/bank/applications/${s.id}/changes`;
  assert.equal((await s.call(plan)).status, 401);
  assert.equal((await s.call(plan, other)).status, 404);
  assert.equal((await s.call(plan, s.bank)).status, 404);
  assert.equal((await s.call(plan, admin)).status, 403);
  assert.equal((await s.call(changes, s.owner)).status, 403);
  assert.equal((await s.call(changes, admin)).status, 403);
  assert.equal((await s.call(changes, s.bank)).status, 404);
  assert.equal((await s.call(plan, s.owner)).status, 200);
  await read(await s.call(`/applications/${s.id}/actions/submit`, s.owner, 'POST', { version: 1 }));
  assert.equal((await s.call(plan, s.bank)).status, 200);
  assert.equal((await s.call(changes, s.bank)).status, 200);
});

test('supplemented application yields actionable request resolution and true bank financial differences without mutations', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  await read(await s.call(`/applications/${s.id}/actions/submit`, s.owner, 'POST', { version: 1 }));
  let detail = await s.current();
  await read(
    await s.call(`/bank/applications/${s.id}/review`, s.bank, 'POST', {
      version: detail.application.version,
    }),
  );
  detail = await s.current();
  await read(
    await s.call(`/bank/applications/${s.id}/decision`, s.bank, 'POST', {
      version: detail.application.version,
      outcome: 'needs_info',
      requestedDocuments: ['other'],
      reason: 'Приложите сведения о новом контракте.',
    }),
  );
  const requested = await s.current();
  const plan = await read<ApplicationActionPlan>(
    await s.call(`/applications/${s.id}/action-plan`, s.owner),
  );
  assert.ok(plan.items.some((item) => item.id === 'missing-documents'));
  for (const category of requested.application.decision!.requestedDocuments)
    await read(
      await s.call(`/applications/${s.id}/documents/sample`, s.owner, 'POST', { category }),
    );
  detail = await s.current();
  await read(
    await s.call(`/applications/${s.id}`, s.owner, 'PATCH', {
      ...detail.application,
      financials: { ...financials, monthlyRevenue: 3200000 },
    }),
  );
  const beforeSupplement = await s.current();
  const currentPreview = await read<ApplicationChanges>(
    await s.call(`/bank/applications/${s.id}/changes`, s.bank),
  );
  const recalculated = assess(
    beforeSupplement.application,
    beforeSupplement.organization,
    beforeSupplement.documents,
    'comparison-preview',
    currentPreview.generatedAt,
  );
  assert.equal(currentPreview.assessment.current.score, recalculated.score.value);
  assert.ok(
    currentPreview.factors.some(
      (factor) => factor.code === 'margin' || factor.code === 'debt' || factor.code === 'cashflow',
    ),
  );
  assert.deepEqual((await s.current()).application, beforeSupplement.application);
  detail = await s.current();
  await read(
    await s.call(`/applications/${s.id}/actions/supplement`, s.owner, 'POST', {
      version: detail.application.version,
    }),
  );
  const before = await s.db.query('SELECT * FROM audit ORDER BY id');
  const beforeApplication = (await s.current()).application;
  const comparison = await read<ApplicationChanges>(
    await s.call(`/bank/applications/${s.id}/changes`, s.bank),
  );
  assert.equal(comparison.baseline.version, requested.application.version);
  assert.equal(comparison.fields.find((item) => item.key === 'monthlyRevenue')!.after, 3200000);
  assert.equal(
    comparison.documents.added.length + comparison.documents.uncertain.length,
    requested.application.decision!.requestedDocuments.length,
  );
  assert.ok(
    comparison.factors.some(
      (factor) => factor.code === 'margin' || factor.code === 'debt' || factor.code === 'cashflow',
    ),
  );
  await read(await s.call(`/applications/${s.id}/action-plan`, s.owner));
  assert.deepEqual((await s.current()).application, beforeApplication);
  assert.deepEqual(await s.db.query('SELECT * FROM audit ORDER BY id'), before);
});
