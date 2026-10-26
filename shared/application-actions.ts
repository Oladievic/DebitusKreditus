import type { ApplicationDetail, ApplicationStatus, Organization } from './types.js';
import type { StatementReport } from './statements.js';
import { businessProfile, documentGuidance } from './business-profile.js';
import type { LoanServicingState } from './servicing.js';
import { documentRequestStatus } from './document-requests.js';

export interface ActionSource {
  kind: 'application' | 'document' | 'statement' | 'profile' | 'decision' | 'calculation';
  label: string;
  at: string;
  version?: number;
  href: string;
  detail?: string;
}
export interface ApplicationActionItem {
  id: string;
  priority: 'required' | 'review' | 'next';
  category: 'documents' | 'financials' | 'statement' | 'decision' | 'consent' | 'process';
  title: string;
  what: string;
  why: string;
  href: string;
  actionLabel: string;
  sources: ActionSource[];
}
export interface ApplicationActionPlan {
  applicationId: string;
  applicationVersion: number;
  generatedAt: string;
  methodVersion: string;
  status: ApplicationStatus;
  headline: string;
  items: ApplicationActionItem[];
  limitations: string[];
}

export function buildApplicationActionPlan(
  detail: ApplicationDetail,
  reports: StatementReport[],
  at: string,
  currentOrganization: Organization = detail.organization,
  servicing?: Pick<LoanServicingState, 'status' | 'version' | 'history' | 'fundedAt'>,
): ApplicationActionPlan {
  const a = detail.application;
  const base = `/applications/${encodeURIComponent(a.id)}`;
  const items: ApplicationActionItem[] = [];
  const editable = ['draft', 'needs_info'].includes(a.status);
  const profile = businessProfile(editable ? currentOrganization : detail.organization);
  const documentLabels: Record<string, string> = {
    statement: 'Выписка по счёту',
    financials: 'Финансовая отчётность',
    invoice: 'Счёт поставщика',
    other: 'Дополнительный документ',
  };
  const applicationSource = (anchor = 'application-financials'): ActionSource => ({
    kind: 'application',
    label: 'Текущая анкета',
    at: a.updatedAt,
    version: a.version,
    href: `${base}#${anchor}`,
    detail:
      'Сведения владельца. Дата относится к сохранению версии заявки, а не к проверке показателей.',
  });
  const decisionVersion = detail.timeline
    .filter(
      (event) =>
        ['needs_info', 'approved', 'counter_offer', 'declined'].includes(event.action) &&
        event.context?.assessment?.decision?.decidedAt === a.decision?.decidedAt,
    )
    .sort(
      (left, right) =>
        (right.context?.applicationVersion ?? 0) - (left.context?.applicationVersion ?? 0),
    )[0]?.context?.applicationVersion;
  const decisionSource: ActionSource = a.decision
    ? {
        kind: 'decision',
        label: 'Решение банка',
        at: a.decision.decidedAt,
        ...(decisionVersion === undefined ? {} : { version: decisionVersion }),
        href: `${base}#application-decision`,
        detail: `Правила ${a.decision.ruleVersion}.`,
      }
    : applicationSource(a.checks.length ? 'application-checks' : 'application-assessment');
  const process = (
    id: string,
    title: string,
    what: string,
    why: string,
    anchor: string,
    actionLabel: string,
  ) => {
    items.push({
      id,
      priority: 'next',
      category: 'process',
      title,
      what,
      why,
      href: `${base}#${anchor}`,
      actionLabel,
      sources: [applicationSource(anchor)],
    });
  };
  const finalStages: Partial<Record<ApplicationStatus, [string, string, string, string, string]>> =
    {
      approved: [
        'Изучите предложенные условия',
        'Сравните платёж, переплату и обязательства перед принятием условий.',
        'Принятие условий создаёт договор; его нужно отдельно прочитать и подтвердить.',
        'application-decision',
        'Открыть условия',
      ],
      counter_offer: [
        'Сравните варианты финансирования',
        'Проверьте предложенную сумму и допустимые альтернативы, затем выберите дальнейшее действие.',
        'Меньшая сумма и более длинный срок по-разному влияют на платёж и переплату.',
        'financing-alternatives',
        'Сравнить варианты',
      ],
      accepted: [
        'Прочитайте договор перед подтверждением',
        'Сверьте основные условия и полный текст договора.',
        'Подтверждение в прототипе не создаёт юридическую электронную подпись.',
        'application-terms',
        'К договору',
      ],
      signed: [
        'Перейдите к выдаче',
        'Проверьте подтверждение и запустите имитацию выдачи.',
        'Реальный перевод денег не выполняется.',
        'application-terms',
        'К выдаче',
      ],
      funded: [
        'Следите за платежами и остатком долга',
        'Откройте календарь, отметьте условный платёж или сравните досрочное погашение.',
        'Сопровождение использует зафиксированные условия выданного кредита.',
        'application-servicing',
        'Открыть сопровождение',
      ],
    };
  const finalStage = finalStages[a.status];
  if (finalStage) {
    if (a.status === 'funded' && servicing?.status === 'closed')
      process(
        'funded',
        'Сохраните историю погашения',
        'Основной долг погашен в модели. Посмотрите историю отметок и сохраните её при необходимости.',
        'Будущих платежей по этому графику нет; реальные деньги не переводились.',
        'application-servicing',
        'Открыть историю',
      );
    else process(a.status, ...finalStage);
    if (a.status === 'funded' && servicing)
      items[0].sources = [
        {
          kind: 'calculation',
          label: 'Сопровождение кредита',
          at: servicing.history.at(-1)?.recordedAt ?? servicing.fundedAt,
          version: servicing.version,
          href: `${base}#application-servicing`,
          detail:
            'Версия относится к сопровождению, а не к анкете. Состояние платежей в локальной модели.',
        },
      ];
  } else {
    const failedChecks = (
      editable ? detail.assessment.checks : a.checks.length ? a.checks : detail.assessment.checks
    ).filter((check) => check.status === 'failed');
    const previewStop = editable && detail.assessment.decision.outcome === 'declined';
    if (failedChecks.length || a.status === 'declined' || previewStop) {
      items.push({
        id: 'policy-constraints',
        priority: 'required',
        category: 'decision',
        title:
          a.status === 'declined'
            ? 'Разберите причины решения'
            : previewStop
              ? 'Проверьте ограничения предварительного расчёта'
              : 'Учтите ограничения проверки',
        what:
          [
            ...new Set([
              ...(a.decision?.reasons ?? []),
              ...(previewStop ? detail.assessment.decision.reasons : []),
              ...failedChecks.map((check) => `${check.label}: ${check.details}`),
            ]),
          ].join(' ') || detail.assessment.decision.reasons.join(' '),
        why:
          failedChecks.length ||
          (editable ? currentOrganization : detail.organization).monthsActive < 6
            ? 'Изменение суммы не снимает ограничения регистрации, кредитной истории или возраста бизнеса. Если сведения спорные, изучите источник и основание проверки; изменение поля не подтверждает исправление.'
            : 'Проверьте исходные финансовые показатели и нагрузку нового платежа. Предварительный расчёт не является новым решением банка; изменение суммы само по себе не гарантирует одобрение.',
        href: `${base}#${a.checks.length ? 'application-checks' : 'application-assessment'}`,
        actionLabel: 'Посмотреть основания',
        sources: previewStop
          ? [
              {
                kind: 'calculation',
                label: 'Предварительный расчёт по текущим сведениям',
                at,
                version: a.version,
                href: `${base}#application-financials`,
                detail: `Текущий профиль версии ${profile.version}; ${detail.assessment.score.modelVersion}, ${detail.assessment.decision.ruleVersion}. Решение банка не изменено.`,
              },
              ...(a.decision ? [decisionSource] : []),
            ]
          : [decisionSource],
      });
    }
    if (editable) {
      const guidance = documentGuidance(profile, a.productId);
      const request = documentRequestStatus(a.decision, detail.documents);
      const missing = [
        ...new Set([
          ...detail.product.requiredDocuments.filter(
            (category) => !detail.documents.some((document) => document.category === category),
          ),
          ...request.categories.filter((item) => !item.satisfied).map((item) => item.category),
        ]),
      ];
      if (missing.length)
        items.push({
          id: 'missing-documents',
          priority: 'required',
          category: 'documents',
          title: 'Добавьте недостающие документы',
          what:
            missing
              .map(
                (category) =>
                  guidance.find((item) => item.category === category)?.title ??
                  documentLabels[category] ??
                  'Документ из запроса банка',
              )
              .join('; ') + '.',
          why:
            a.status === 'needs_info'
              ? [
                  a.decision?.reasons.join(' ') || 'Банк запросил дополнения к пакету.',
                  request.note,
                ]
                  .filter(Boolean)
                  .join(' ')
              : 'Эти категории нужны для рассмотрения выбранного продукта.',
          href: `${base}#application-documents`,
          actionLabel: 'Добавить документы',
          sources: [a.decision ? decisionSource : applicationSource('application-documents')],
        });
      else if (a.status === 'needs_info' && a.decision?.requestedDocuments.length) {
        items.push({
          id: 'requested-documents',
          priority: 'review',
          category: 'documents',
          title: 'Новые файлы готовы к проверке банка',
          what: 'В каждой запрошенной категории есть файл после запроса. Сверьте содержание и период перед повторной отправкой: наличие вложения не означает его принятие банком.',
          why:
            a.decision.reasons.join(' ') ||
            'Наличие категории не означает, что содержание документа принято банком.',
          href: `${base}#application-documents`,
          actionLabel: 'Сверить пакет',
          sources: [decisionSource],
        });
      }
      const days = Math.floor(
        (Date.parse(at.slice(0, 10)) - Date.parse(profile.financialsAsOf)) / 86400000,
      );
      if (days > 120)
        items.push({
          id: 'stale-financials',
          priority: 'required',
          category: 'financials',
          title: 'Обновите дату и подтверждение финансов',
          what: `Сведения в профиле относятся к ${profile.financialsAsOf}. Укажите актуальный период и приложите свежий финансовый документ.`,
          why: 'По правилам оценки сведения старше 120 дней требуют уточнения. Новая дата без подтверждающих показателей не заменяет документ.',
          href: '/business#profile-financialsAsOf',
          actionLabel: 'Обновить профиль',
          sources: [
            {
              kind: 'profile',
              label: 'Профиль компании',
              at: profile.updatedAt,
              version: profile.version,
              href: '/business#profile-financialsAsOf',
              detail: `Дата финансовых сведений: ${profile.financialsAsOf}.`,
            },
          ],
        });
      if (!a.consent)
        items.push({
          id: 'consent',
          priority: 'required',
          category: 'consent',
          title: 'Прочитайте и подтвердите условия проверки',
          what: 'Откройте согласие и подтвердите его перед отправкой.',
          why: 'Отправка без согласия заблокирована.',
          href: `${base}#application-consent`,
          actionLabel: 'К согласию',
          sources: [applicationSource('application-consent')],
        });
    }
    const report = reports
      .filter((item) => item.applicationVersion <= a.version)
      .sort((left, right) => right.applicationVersion - left.applicationVersion)[0];
    if (report && a.status !== 'declined') {
      const changed = Object.keys(a.financials).some(
        (key) =>
          a.financials[key as keyof typeof a.financials] !==
          report.analysis.declaredFinancials[key as keyof typeof a.financials],
      );
      const findings = report.analysis.findings.filter(
        (finding) => finding.severity === 'attention',
      );
      if (changed || findings.length)
        items.push({
          id: 'statement-review',
          priority: 'review',
          category: 'statement',
          title: changed
            ? 'Сверьте выписку с обновлённой анкетой'
            : 'Проверьте наблюдения по выписке',
          what: changed
            ? 'После сохранения анализа показатели анкеты изменились. Старый отчёт сравнивает исходные суммы; откройте источник и сверьте текущие показатели.'
            : findings.map((finding) => finding.title).join('; ') + '.',
          why: 'Расхождение может объясняться периодом или классификацией операций. Анализ не подтверждает подлинность и не меняет финансовые сведения автоматически.',
          href: `${base}#application-statement`,
          actionLabel: 'Открыть анализ',
          sources: [
            {
              kind: 'statement',
              label: report.documentName,
              at: report.createdAt,
              version: report.applicationVersion,
              href: `${base}#application-statement`,
              detail: `Период ${report.analysis.period.from} — ${report.analysis.period.to}; ${report.analysis.methodVersion}.`,
            },
            applicationSource(),
          ],
        });
    }
    if (a.status === 'draft')
      process(
        'submit',
        'Проверьте и отправьте заявку',
        'Сверьте сумму, срок, финансовые сведения и комплект.',
        'План помогает подготовить данные. Решение принимается после отправки и рассмотрения.',
        'application-actions',
        'К отправке',
      );
    if (
      a.status === 'declined' &&
      !failedChecks.length &&
      detail.organization.monthsActive >= 6 &&
      detail.assessment.score.value >= 40 &&
      detail.assessment.score.paymentLimit &&
      detail.assessment.score.paymentLimit > 0
    )
      process(
        'consider-alternatives',
        'Проверьте другой размер или срок запроса',
        'Сравните допустимые расчётные варианты. Исходное решение останется в истории; выбранный вариант можно проверить в отдельном черновике.',
        'Изменение суммы или срока может снизить нагрузку, но не гарантирует одобрение и не устраняет ограничения документов.',
        'financing-alternatives',
        'Сравнить варианты',
      );
    if (a.status === 'needs_info')
      process(
        'supplement',
        'Верните дополненный пакет на рассмотрение',
        'После проверки изменений отправьте дополнения.',
        'Повторная отправка закрепит актуальный профиль компании; решение будет рассчитано заново.',
        'application-actions',
        'Отправить дополнения',
      );
    if (a.status === 'submitted' || a.status === 'in_review')
      process(
        'wait-review',
        'Следите за рассмотрением',
        'Банк проверяет отправленный пакет. Если потребуются сведения, здесь появится конкретный запрос.',
        'На этом этапе редактирование заявки закрыто, чтобы банк и клиент видели одну версию.',
        'application-assessment',
        'Посмотреть статус',
      );
  }
  const priority = { required: 0, review: 1, next: 2 };
  items.sort((left, right) => priority[left.priority] - priority[right.priority]);
  return {
    applicationId: a.id,
    applicationVersion: a.version,
    generatedAt: at,
    methodVersion: 'application-actions-v1',
    status: a.status,
    headline:
      a.status === 'funded'
        ? servicing?.status === 'closed'
          ? 'Кредит погашен в модели'
          : 'Следующий шаг по кредиту'
        : 'Что делать дальше',
    items,
    limitations: [
      'План основан на сохранённых данных и правилах; выполнение пунктов не гарантирует одобрение.',
      'Загруженный документ и проверенный пользователем OCR-текст не считаются подтверждённым внешним источником.',
    ],
  };
}
