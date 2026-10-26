import type { ApplicationInput, Assessment, Financials, ScenarioResult } from './types.js';

export type AlternativeIntent = 'lower_payment' | 'less_interest' | 'closer_amount';

export interface FinancingAlternative {
  id: string;
  intent: AlternativeIntent;
  title: string;
  explanation: string;
  calculation: ScenarioResult;
  maximumPayment: number;
  minimumRemainingCash: number;
  assessment: Assessment;
  blockers: string[];
  deltas: {
    amount: number;
    termMonths: number;
    maximumPayment: number;
    totalInterest: number;
  };
  draft: ApplicationInput;
}

export interface AlternativesResponse {
  applicationId: string;
  applicationVersion: number;
  profileVersion: number;
  financialsAsOf: string;
  generatedAt: string;
  source: 'current_profile' | 'submission_snapshot';
  snapshotCapturedAt: string | null;
  product: { id: string; name: string; intakePaused: boolean };
  purpose: string;
  financials: Financials;
  baseline: {
    calculation: ScenarioResult;
    maximumPayment: number;
    assessment: Assessment;
  };
  options: FinancingAlternative[];
  unavailable: { intent: AlternativeIntent; reason: string }[];
  blockers: string[];
  assumptions: string[];
  search: { termStepMonths: 1; amountStep: 1000; termsChecked: number; evaluations: number };
  methodVersion: 'same-purpose-alternatives-v1';
}
