import type { Hono } from 'hono';
import type {
  AlternativeIntent,
  AlternativesResponse,
  FinancingAlternative,
} from '../shared/alternatives.js';
import { businessProfile, documentGuidance } from '../shared/business-profile.js';
import type {
  Application,
  ApplicationInput,
  Assessment,
  DocumentRecord,
  Organization,
  Product,
  User,
} from '../shared/types.js';
import { productsWithIntake } from './admin.js';
import type { Database } from './db.js';
import {
  assess,
  calculateScenario,
  DomainError,
  maximumPayment,
  now,
  validateInput,
} from './domain.js';
import type { AppEnv } from './http-types.js';
import { getApplication, getOrganization, listDocuments } from './repository.js';

function assessmentBlockers(assessment: Assessment, organization: Organization, product: Product) {
  const labels = documentGuidance(businessProfile(organization), product.id);
  return [
    ...new Set([
      ...(product.intake?.paused
        ? [`Приём заявок приостановлен: ${product.intake.reason || 'условия продукта уточняются'}.`]
        : []),
      ...(assessment.decision.outcome === 'approved' ? [] : assessment.decision.reasons),
      ...assessment.decision.requestedDocuments.map(
        (category) =>
          `Нужно приложить: ${labels.find((item) => item.category === category)?.title ?? category}.`,
      ),
    ]),
  ];
}

export function calculateFinancingAlternatives(
  application: Application,
  organization: Organization,
  documents: Pick<DocumentRecord, 'category'>[],
  product: Product,
  at = now(),
): AlternativesResponse {
  const input = validateInput(application);
  if (input.productId !== product.id)
    throw new DomainError('PRODUCT_MISMATCH', 'Продукт расчёта не соответствует заявке.');
  if (application.status !== 'draft' && !application.organizationSnapshot)
    throw new DomainError(
      'SNAPSHOT_REQUIRED',
      'Для сравнения отправленной заявки нужен закреплённый снимок данных.',
      409,
    );
  const org = application.status === 'draft' ? organization : application.organizationSnapshot!;
  const profile = businessProfile(org);
  const asOf = at.slice(0, 10);
  let evaluations = 0;
  const evaluate = (amount: number, termMonths: number) => {
    evaluations++;
    const next = { ...input, amount, termMonths, consent: false };
    const calculation = calculateScenario(
      amount,
      termMonths,
      product.rateBps,
      input.financials,
      asOf,
    );
    // Пустой комплект нужен только для получения общих факторов без вложенного подбора суммы.
    const score = assess(next, org, [], 'alternatives-engine', at).score;
    const peak = maximumPayment(calculation);
    return {
      calculation,
      peak,
      fits:
        org.registered &&
        org.overdueDays < 60 &&
        org.monthsActive >= 6 &&
        calculation.availableCash > 0 &&
        score.value >= 40 &&
        peak <= (score.paymentLimit ?? 0),
    };
  };
  const baseline = evaluate(input.amount, input.termMonths);
  const baselineAssessment = assess(input, org, documents, 'alternatives-engine', at);
  const response: AlternativesResponse = {
    applicationId: application.id,
    applicationVersion: application.version,
    profileVersion: profile.version,
    financialsAsOf: profile.financialsAsOf,
    generatedAt: at,
    source: application.status === 'draft' ? 'current_profile' : 'submission_snapshot',
    snapshotCapturedAt:
      application.status === 'draft'
        ? null
        : (application.organizationSnapshotMeta?.capturedAt ?? application.submittedAt),
    product: { id: product.id, name: product.name, intakePaused: !!product.intake?.paused },
    purpose: input.purpose,
    financials: input.financials,
    baseline: {
      calculation: baseline.calculation,
      maximumPayment: baseline.peak,
      assessment: baselineAssessment,
    },
    options: [],
    unavailable: [],
    blockers: assessmentBlockers(baselineAssessment, org, product),
    assumptions: [
      'Сравнивается только продукт исходной заявки: цель, ставка и финансовые суммы сохраняются. Оборудование не подменяется оборотным кредитом.',
      'Проверяются все целые сроки продукта. Снижение суммы при исходном сроке — с шагом 1 000 ₽; сумма не увеличивается.',
      'Проверяется максимальный платёж, включая последний. Проценты указаны за весь срок; комиссии, страховка и перенос выходных не учитываются.',
      'Для каждого варианта повторно применены общие правила скоринга и фактический комплект документов. Расчёт не меняет решение по исходной заявке и не обещает одобрение.',
      'Данные уже загруженных документов не переносятся в новую заявку. В новом черновике нужно проверить актуальность профиля, заново приложить документы и дать согласие.',
      ...(application.organizationSnapshotMeta?.source === 'legacy_recovery'
        ? [
            'Снимок прежней заявки восстановлен из данных, доступных перед изменением профиля. Это не подтверждение первоначальных исторических сведений.',
          ]
        : []),
      ...(product.id === 'credit_line'
        ? [
            'Резерв моделируется одним полным траншем с равными платежами, без повторного использования лимита.',
          ]
        : []),
    ],
    search: { termStepMonths: 1, amountStep: 1000, termsChecked: 0, evaluations: 0 },
    methodVersion: 'same-purpose-alternatives-v1',
  };
  const terms: ReturnType<typeof evaluate>[] = [];
  for (let term = product.minTerm; term <= product.maxTerm; term++) {
    terms.push(term === input.termMonths ? baseline : evaluate(input.amount, term));
    response.search.termsChecked++;
  }
  const used = new Set([`${input.amount}:${input.termMonths}`]);
  const add = (
    intent: AlternativeIntent,
    title: string,
    explanation: string,
    candidate: ReturnType<typeof evaluate> | undefined,
    reason: string,
  ) => {
    if (
      !candidate ||
      used.has(`${candidate.calculation.amount}:${candidate.calculation.termMonths}`)
    ) {
      response.unavailable.push({ intent, reason });
      return;
    }
    const calculation = candidate.calculation;
    const draft: ApplicationInput = {
      ...input,
      amount: calculation.amount,
      termMonths: calculation.termMonths,
      consent: false,
    };
    const assessment = assess(draft, org, documents, 'alternatives-engine', at);
    const option: FinancingAlternative = {
      id: `${intent}:${calculation.amount}:${calculation.termMonths}`,
      intent,
      title,
      explanation,
      calculation,
      maximumPayment: candidate.peak,
      minimumRemainingCash: calculation.availableCash - candidate.peak,
      assessment,
      blockers: assessmentBlockers(assessment, org, product),
      deltas: {
        amount: calculation.amount - input.amount,
        termMonths: calculation.termMonths - input.termMonths,
        maximumPayment: candidate.peak - baseline.peak,
        totalInterest: calculation.totalInterest - baseline.calculation.totalInterest,
      },
      draft,
    };
    response.options.push(option);
    used.add(`${calculation.amount}:${calculation.termMonths}`);
  };
  const lowerPayment = terms
    .filter((item) => item.fits && item.peak < baseline.peak)
    .sort(
      (a, b) => a.peak - b.peak || a.calculation.totalInterest - b.calculation.totalInterest,
    )[0];
  add(
    'lower_payment',
    'Сохранить сумму, снизить платёж',
    'Более длинный срок уменьшает максимальный платёж. Сравните рост процентов за весь срок.',
    lowerPayment,
    'В границах продукта нет другого срока, который сохраняет сумму и снижает платёж с соблюдением числовой нагрузки.',
  );
  const lessInterest = terms
    .filter(
      (item) =>
        item.fits &&
        item.calculation.totalInterest < baseline.calculation.totalInterest &&
        !used.has(`${item.calculation.amount}:${item.calculation.termMonths}`),
    )
    .sort(
      (a, b) => a.calculation.totalInterest - b.calculation.totalInterest || a.peak - b.peak,
    )[0];
  add(
    'less_interest',
    'Сохранить сумму, сократить проценты',
    'Выбран самый короткий срок с меньшими процентами среди вариантов, проходящих числовые ограничения. Платёж может вырасти.',
    lessInterest,
    'Более короткий срок с меньшими процентами не проходит числовые ограничения либо совпадает с уже показанным вариантом.',
  );
  let closer: ReturnType<typeof evaluate> | undefined;
  if (!baseline.fits) {
    let low = Math.ceil(product.minAmount / 1000),
      high = Math.floor(Math.min(input.amount, product.maxAmount) / 1000);
    if (low <= high && evaluate(low * 1000, input.termMonths).fits) {
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (evaluate(middle * 1000, input.termMonths).fits) low = middle;
        else high = middle - 1;
      }
      closer = evaluate(low * 1000, input.termMonths);
    }
  }
  add(
    'closer_amount',
    'Подобрать сумму под исходный срок',
    'Это наибольшая сумма с шагом 1 000 ₽, не выше запроса, которая укладывается в числовые ограничения при исходном сроке. Проверьте, хватит ли её на задачу.',
    closer,
    baseline.fits
      ? 'Исходная сумма уже укладывается в числовые ограничения при выбранном сроке; уменьшать бюджет без вашей причины не предлагаем.'
      : 'Даже минимальная сумма продукта при исходном сроке не проходит числовые ограничения.',
  );
  response.search.evaluations = evaluations;
  return response;
}

export async function getFinancingAlternatives(
  db: Database,
  user: User,
  applicationId: string,
): Promise<AlternativesResponse> {
  const application = await getApplication(db, applicationId, user);
  const organization =
    application.status === 'draft'
      ? await getOrganization(db, application.organizationId)
      : application.organizationSnapshot;
  if (!organization)
    throw new DomainError(
      'SNAPSHOT_REQUIRED',
      'Для сравнения отправленной заявки нужен закреплённый снимок данных.',
      409,
    );
  const product = (await productsWithIntake(db)).find((item) => item.id === application.productId);
  if (!product) throw new DomainError('PRODUCT_NOT_FOUND', 'Продукт заявки не найден.', 404);
  return calculateFinancingAlternatives(
    application,
    organization,
    await listDocuments(db, user, applicationId),
    product,
  );
}

export function registerAlternativeRoutes(app: Hono<AppEnv>, db: Database) {
  app.get('/api/applications/:id/alternatives', async (c) =>
    c.json(await getFinancingAlternatives(db, c.get('user'), c.req.param('id'))),
  );
}
