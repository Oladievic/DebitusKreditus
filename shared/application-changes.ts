import type { ApplicationDetail, TimelineEvent, CreditDecision, Financials } from './types.js';
import type { StatementReport } from './statements.js';

type ChangeValue = number | string | boolean | null;
export interface ApplicationFieldChange {
  key: string;
  label: string;
  before: ChangeValue;
  after: ChangeValue;
}
export interface ApplicationStatementSnapshot {
  id: string;
  applicationVersion: number;
  createdAt: string;
  period: string;
  methodVersion: string;
  declaredFinancials: Financials;
  findings: { code: string; title: string; detail: string }[];
}
export interface ApplicationChanges {
  applicationId: string;
  currentVersion: number;
  generatedAt: string;
  methodVersion: string;
  baseline: {
    available: boolean;
    kind: 'information_request' | 'bank_review' | 'submission' | 'unavailable';
    version?: number;
    at?: string;
    label: string;
    limitation?: string;
  };
  fields: ApplicationFieldChange[];
  factors: {
    code: string;
    label: string;
    beforePoints: number | null;
    afterPoints: number | null;
    beforeDetail: string | null;
    afterDetail: string | null;
  }[];
  checks: {
    key: string;
    label: string;
    beforeStatus: string | null;
    afterStatus: string | null;
    beforeDetail: string | null;
    afterDetail: string | null;
  }[];
  documents: {
    added: ApplicationDetail['documents'];
    uncertain: ApplicationDetail['documents'];
    note: string;
  };
  statements: {
    comparable: boolean;
    before: ApplicationStatementSnapshot | null;
    current: ApplicationStatementSnapshot | null;
    note: string;
  };
  assessment: {
    before: {
      score: number | null;
      outcome: CreditDecision['outcome'] | null;
      scoringVersion: string | null;
      policyVersion: string | null;
    } | null;
    current: {
      score: number;
      outcome: CreditDecision['outcome'];
      scoringVersion: string;
      policyVersion: string;
    };
    note: string;
  };
  hasChanges: boolean;
  limitations: string[];
}

function latest(events: TimelineEvent[]) {
  return [...events].sort(
    (a, b) => (b.context?.applicationVersion ?? 0) - (a.context?.applicationVersion ?? 0),
  )[0];
}
function sameFinancials(left: Financials, right: Financials) {
  return (
    left.monthlyRevenue === right.monthlyRevenue &&
    left.monthlyExpenses === right.monthlyExpenses &&
    left.monthlyDebtPayment === right.monthlyDebtPayment
  );
}
function reportSnapshot(report: StatementReport | undefined): ApplicationStatementSnapshot | null {
  return report
    ? {
        id: report.id,
        applicationVersion: report.applicationVersion,
        createdAt: report.createdAt,
        period: `${report.analysis.period.from} — ${report.analysis.period.to}`,
        methodVersion: report.analysis.methodVersion,
        declaredFinancials: report.analysis.declaredFinancials,
        findings: report.analysis.findings
          .filter((finding) => finding.severity === 'attention')
          .map(({ code, title, detail }) => ({ code, title, detail })),
      }
    : null;
}
export function buildApplicationChanges(
  detail: ApplicationDetail,
  reports: StatementReport[],
  at: string,
): ApplicationChanges {
  const a = detail.application;
  const validEvents = detail.timeline.filter(
    (event) =>
      event.context?.input &&
      Number.isSafeInteger(event.context.applicationVersion) &&
      event.context.applicationVersion <= a.version &&
      event.context.applicationVersion > 0,
  );
  const request = latest(validEvents.filter((event) => event.action === 'needs_info'));
  const review = latest(
    validEvents.filter(
      (event) =>
        ['review_started', 'approved', 'counter_offer', 'declined'].includes(event.action) &&
        event.context!.applicationVersion < a.version,
    ),
  );
  const submission = latest(
    validEvents.filter((event) => ['submitted', 'supplemented'].includes(event.action)),
  );
  const missingRequest =
    !request &&
    detail.timeline.some((event) => event.action === 'needs_info' && !event.context?.input);
  const baselineEvent = missingRequest ? undefined : (request ?? review ?? submission);
  const context = baselineEvent?.context;
  const input = context?.input;
  const baseline: ApplicationChanges['baseline'] =
    baselineEvent && context && input
      ? {
          available: true,
          kind: request ? 'information_request' : review ? 'bank_review' : 'submission',
          version: context.applicationVersion,
          at: baselineEvent.createdAt,
          label: request
            ? 'Пакет, по которому банк запросил сведения'
            : review
              ? 'Предыдущая банковская проверка'
              : 'Отправленный пакет',
        }
      : {
          available: false,
          kind: 'unavailable',
          label: 'Снимка для сравнения нет',
          limitation:
            'В прежних записях нет полного контекста. Текущие значения нельзя выдавать за исторические.',
        };
  const fields: ApplicationFieldChange[] = [];
  const add = (key: string, label: string, before: ChangeValue, after: ChangeValue) => {
    if (before !== after) fields.push({ key, label, before, after });
  };
  if (input) {
    add('amount', 'Запрошенная сумма, ₽', input.amount, a.amount);
    add('termMonths', 'Срок, месяцев', input.termMonths, a.termMonths);
    add(
      'productId',
      'Продукт',
      input.productSnapshot?.name ?? input.productId,
      detail.product.name,
    );
    add('purpose', 'Цель финансирования', input.purpose, a.purpose);
    add(
      'monthlyRevenue',
      'Выручка в месяц, ₽',
      input.financials.monthlyRevenue,
      a.financials.monthlyRevenue,
    );
    add(
      'monthlyExpenses',
      'Операционные расходы в месяц, ₽',
      input.financials.monthlyExpenses,
      a.financials.monthlyExpenses,
    );
    add(
      'monthlyDebtPayment',
      'Действующие платежи в месяц, ₽',
      input.financials.monthlyDebtPayment,
      a.financials.monthlyDebtPayment,
    );
    const oldOrg = input.organizationSnapshot;
    const org = a.organizationSnapshot;
    if (oldOrg && org) {
      add('monthsActive', 'Возраст бизнеса, месяцев', oldOrg.monthsActive, org.monthsActive);
      add('registered', 'Регистрация в источнике проверки', oldOrg.registered, org.registered);
      add(
        'overdueDays',
        'Дней просрочки в источнике проверки',
        oldOrg.overdueDays,
        org.overdueDays,
      );
      if (oldOrg.profile && org.profile) {
        add(
          'financialsAsOf',
          'Дата финансовых сведений',
          oldOrg.profile.financialsAsOf,
          org.profile.financialsAsOf,
        );
        add(
          'largestCustomerSharePct',
          'Доля крупнейшего покупателя, %',
          oldOrg.profile.largestCustomerSharePct,
          org.profile.largestCustomerSharePct,
        );
        add(
          'lowSeasonRevenueDropPct',
          'Снижение выручки в низкий сезон, %',
          oldOrg.profile.lowSeasonRevenueDropPct,
          org.profile.lowSeasonRevenueDropPct,
        );
      }
    }
  }
  const prior = context?.assessment;
  const current = detail.assessment;
  const factors: ApplicationChanges['factors'] = [];
  if (prior?.score) {
    for (const code of new Set([
      ...prior.score.factors.map((factor) => factor.code),
      ...current.score.factors.map((factor) => factor.code),
    ])) {
      const before = prior.score.factors.find((factor) => factor.code === code);
      const after = current.score.factors.find((factor) => factor.code === code);
      if (before?.points !== after?.points || before?.detail !== after?.detail)
        factors.push({
          code,
          label: after?.label ?? before!.label,
          beforePoints: before?.points ?? null,
          afterPoints: after?.points ?? null,
          beforeDetail: before?.detail ?? null,
          afterDetail: after?.detail ?? null,
        });
    }
  }
  const checks: ApplicationChanges['checks'] = [];
  if (prior) {
    const key = (check: ApplicationDetail['assessment']['checks'][number]) =>
      `${check.source}\n${check.label}`;
    for (const code of new Set([...prior.checks.map(key), ...current.checks.map(key)])) {
      const before = prior.checks.find((check) => key(check) === code);
      const after = current.checks.find((check) => key(check) === code);
      if (before?.status !== after?.status || before?.details !== after?.details)
        checks.push({
          key: code,
          label: after?.label ?? before!.label,
          beforeStatus: before?.status ?? null,
          afterStatus: after?.status ?? null,
          beforeDetail: before?.details ?? null,
          afterDetail: after?.details ?? null,
        });
    }
  }
  const added: ApplicationDetail['documents'] = [];
  const uncertain: ApplicationDetail['documents'] = [];
  const documentRequest = request?.context?.assessment?.decision?.documentRequest;
  const baselineIds =
    documentRequest?.methodVersion === 'document-id-baseline-v1'
      ? new Set(documentRequest.baselineDocumentIds)
      : null;
  for (const document of detail.documents) {
    if (!baselineEvent || !context) {
      uncertain.push(document);
      continue;
    }
    if (baselineIds) {
      if (!baselineIds.has(document.id)) added.push(document);
      continue;
    }
    const report = reports.find((item) => item.documentId === document.id);
    if (report) {
      if (
        report.applicationVersion > context.applicationVersion &&
        report.applicationVersion <= a.version
      )
        added.push(document);
    } else if (document.createdAt > baselineEvent.createdAt) added.push(document);
    else if (document.createdAt === baselineEvent.createdAt) uncertain.push(document);
  }
  const sortedReports = [...reports]
    .filter((report) => report.applicationVersion <= a.version)
    .sort((left, right) => right.applicationVersion - left.applicationVersion);
  const oldReport = context
    ? sortedReports.find((report) => report.applicationVersion <= context.applicationVersion)
    : undefined;
  const newReport = sortedReports[0];
  const comparable = !!(
    input &&
    oldReport &&
    newReport &&
    oldReport.analysis.methodVersion === newReport.analysis.methodVersion &&
    oldReport.analysis.period.from === newReport.analysis.period.from &&
    oldReport.analysis.period.to === newReport.analysis.period.to &&
    sameFinancials(input.financials, oldReport.analysis.declaredFinancials) &&
    sameFinancials(a.financials, newReport.analysis.declaredFinancials)
  );
  const beforeStatement = reportSnapshot(oldReport);
  const currentStatement = reportSnapshot(newReport);
  const changedStatement =
    comparable &&
    JSON.stringify(beforeStatement?.findings) !== JSON.stringify(currentStatement?.findings);
  const statementNote = !newReport
    ? 'Сохранённых анализов выписки нет.'
    : !oldReport
      ? 'На дату исходного пакета отчёта не было. Сравнить прошлые и текущие расхождения нельзя.'
      : !comparable
        ? 'Отчёты различаются периодом или правилами, либо сохранённое сравнение относится к другим суммам анкеты. Изменение расхождений не определяется.'
        : changedStatement
          ? 'Показаны изменения наблюдений для одинакового периода и правил, на соответствующих суммах анкеты. Это не подтверждение подлинности.'
          : 'Наблюдения сопоставимых отчётов не изменились. Это не подтверждение подлинности.';
  const beforeAssessment = prior
    ? {
        score: prior.score?.value ?? null,
        outcome: prior.decision?.outcome ?? null,
        scoringVersion: prior.score?.modelVersion ?? null,
        policyVersion: prior.decision?.ruleVersion ?? null,
      }
    : null;
  return {
    applicationId: a.id,
    currentVersion: a.version,
    generatedAt: at,
    methodVersion: 'application-changes-v1',
    baseline,
    fields,
    factors,
    checks,
    documents: {
      added,
      uncertain,
      note: baselineIds
        ? 'На момент запроса сохранён список исходных файлов. Здесь показаны вложения, которых в этом списке не было. Наличие нового файла не подтверждает содержание и подлинность.'
        : 'Документы не имеют полного исторического снимка. Для обычных файлов добавление определяется по дате; совпавшие даты не упорядочиваются. Для исходных CSV используется версия сохранения отчёта. Подлинность и содержание не подтверждаются.',
    },
    statements: {
      comparable,
      before: beforeStatement,
      current: currentStatement,
      note: statementNote,
    },
    assessment: {
      before: beforeAssessment,
      current: {
        score: current.score.value,
        outcome: current.decision.outcome,
        scoringVersion: current.score.modelVersion,
        policyVersion: current.decision.ruleVersion,
      },
      note: prior
        ? 'Справа — оценка текущего пакета по указанным правилам, а не новое принятое решение. Время выполнения проверки само по себе не считается изменением.'
        : 'Исходный скоринг и проверки не сохранены. Их отсутствие не означает нулевой балл или успешную проверку.',
    },
    hasChanges: !!(
      fields.length ||
      factors.length ||
      checks.length ||
      added.length ||
      changedStatement ||
      (beforeAssessment && beforeAssessment.score !== current.score.value) ||
      (beforeAssessment?.outcome && beforeAssessment.outcome !== current.decision.outcome) ||
      (beforeAssessment?.scoringVersion &&
        beforeAssessment.scoringVersion !== current.score.modelVersion) ||
      (beforeAssessment?.policyVersion &&
        beforeAssessment.policyVersion !== current.decision.ruleVersion)
    ),
    limitations: [
      'Порядок событий определяется версией заявки. Случайный идентификатор и совпавшее время не используются как порядок изменений.',
      'Изменения данных и баллов не заменяют банковское решение; отчёт ничего не изменяет в заявке.',
    ],
  };
}
