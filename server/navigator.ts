import type { Hono } from 'hono';
import type { NavigatorAnalysis, NavigatorDraft } from '../shared/financing-intent.js';
import { parseFinancingIntent } from '../shared/financing-intent.js';
import { businessProfile } from '../shared/business-profile.js';
import type { Organization, Product } from '../shared/types.js';
import type { AppEnv } from './http-types.js';
import type { Database } from './db.js';
import { calculateScenario, DomainError, now, validateInput } from './domain.js';
import { productsWithIntake } from './admin.js';
import { getOrganization } from './repository.js';
import { requireProfileOwner } from './profile.js';
import { recommendProducts } from './recommendations.js';

export function analyzeFinancingRequest(
  organization: Organization,
  request: unknown,
  products: Product[],
): NavigatorAnalysis {
  if (typeof request !== 'string')
    throw new DomainError('INVALID_REQUEST', 'Опишите задачу текстом.');
  let intent;
  try {
    intent = parseFinancingIntent(request);
  } catch (error) {
    throw new DomainError('INVALID_REQUEST', (error as Error).message);
  }
  const profile = businessProfile(organization);
  const selected = products.find((product) => product.id === intent.productId);
  const generatedAt = now();
  const term =
    intent.termMonths ??
    (selected
      ? Math.max(selected.minTerm, Math.min(selected.maxTerm, profile.preferredTermMonths))
      : profile.preferredTermMonths);
  const suggestion =
    recommendProducts(
      {
        ...organization,
        profile: {
          ...profile,
          financingGoal: intent.productId ?? profile.financingGoal,
          requestedAmount: intent.amount ?? profile.requestedAmount,
          preferredTermMonths: term,
        },
      },
      products,
      generatedAt,
    ).recommendations.find((item) => item.product.id === selected?.id) ?? null;
  return {
    intent,
    suggestedTermMonths: term,
    profileVersion: profile.version,
    financialsAsOf: profile.financialsAsOf,
    generatedAt,
    recommendation: intent.amount !== null && intent.productId !== null ? suggestion : null,
  };
}

export function prepareNavigatorDraft(
  organization: Organization,
  raw: unknown,
  products: Product[],
): NavigatorDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new DomainError('INVALID_INPUT', 'Проверьте параметры черновика.');
  const body = raw as Record<string, unknown>;
  const profile = businessProfile(organization);
  if (body.expectedProfileVersion !== profile.version)
    throw new DomainError(
      'PROFILE_VERSION_CONFLICT',
      'Профиль изменился. Разберите запрос заново перед подготовкой черновика.',
      409,
    );
  const product = products.find((item) => item.id === body.productId);
  if (!product) throw new DomainError('INVALID_PRODUCT', 'Выберите продукт из каталога.');
  if (product.intake?.paused)
    throw new DomainError(
      'PRODUCT_PAUSED',
      product.intake.reason || 'Приём заявок по продукту приостановлен.',
      409,
    );
  const financials = {
    monthlyRevenue: organization.monthlyRevenue,
    monthlyExpenses: organization.monthlyExpenses,
    monthlyDebtPayment: organization.monthlyDebtPayment,
  };
  const draft = validateInput({ ...body, financials, consent: false });
  const calculation = calculateScenario(
    draft.amount,
    draft.termMonths,
    product.rateBps,
    financials,
  );
  return {
    draft,
    product,
    calculation,
    profileVersion: profile.version,
    financialsAsOf: profile.financialsAsOf,
    notes: [
      'Параметры подготовлены для проверки. Заявка ещё не создана и не отправлена.',
      'Финансовые показатели взяты из сохранённого профиля. Их можно уточнить в анкете.',
      'Платёж рассчитан по правилам продукта. Решение банк примет после проверки заявки и документов.',
      ...(product.id === 'credit_line'
        ? [
            'Резерв моделируется одним траншем с равными платежами; это не возобновляемый лимит и не овердрафт.',
          ]
        : []),
    ],
  };
}

export function registerNavigatorRoutes(app: Hono<AppEnv>, db: Database) {
  app.post('/api/navigator/analyze', async (c) => {
    const organization = await getOrganization(db, requireProfileOwner(c.get('user')));
    const body = await c.req.json();
    return c.json(
      analyzeFinancingRequest(organization, body?.request, await productsWithIntake(db)),
    );
  });
  app.post('/api/navigator/prepare', async (c) => {
    const organization = await getOrganization(db, requireProfileOwner(c.get('user')));
    return c.json(
      prepareNavigatorDraft(organization, await c.req.json(), await productsWithIntake(db)),
    );
  });
}
