import type { Hono } from 'hono';
import type { Organization } from '../shared/types.js';
import { businessProfile } from '../shared/business-profile.js';
import {
  calculateCashflow,
  CashflowInputError,
  validateCashflowInputs,
} from '../shared/cashflow.js';
import type { Database } from './db.js';
import type { AppEnv } from './http-types.js';
import { calculateScenario, DomainError, now, productById, validateInput } from './domain.js';
import { getOrganization } from './repository.js';
import { requireProfileOwner } from './profile.js';

export function calculateCashflowForOrganization(organization: Organization, value: unknown) {
  try {
    const inputs = validateCashflowInputs(value);
    const body = value as Record<string, unknown>;
    const product = productById(String(body.productId ?? ''));
    const financials = {
      monthlyRevenue: inputs.monthlyInflow,
      monthlyExpenses: inputs.monthlyOperatingOutflow,
      monthlyDebtPayment: inputs.monthlyExistingDebtPayment,
    };
    const validated = validateInput({
      productId: product.id,
      amount: body.amount,
      termMonths: body.termMonths,
      financials,
      consent: false,
      purpose: 'Сравнение денежного потока',
    });
    const scenario = calculateScenario(
      validated.amount,
      validated.termMonths,
      product.rateBps,
      financials,
      `${inputs.startingMonth}-01`,
    );
    const result = calculateCashflow(inputs, scenario, now());
    const profile = businessProfile(organization);
    return {
      ...result,
      source: {
        organizationId: organization.id,
        profileVersion: profile.version,
        financialsAsOf: profile.financialsAsOf,
      },
    };
  } catch (error) {
    if (error instanceof CashflowInputError)
      throw new DomainError('INVALID_CASHFLOW', error.message);
    throw error;
  }
}

export function registerCashflowRoutes(app: Hono<AppEnv>, db: Database) {
  app.post('/api/scenario/cashflow', async (c) => {
    const organizationId = requireProfileOwner(c.get('user'));
    const organization = await getOrganization(db, organizationId);
    return c.json(calculateCashflowForOrganization(organization, await c.req.json()));
  });
}
