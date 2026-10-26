import type { DocumentRequestMetadata } from './document-requests.js';

export type Role = 'client' | 'bank' | 'admin';
export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'needs_info'
  | 'approved'
  | 'counter_offer'
  | 'declined'
  | 'accepted'
  | 'signed'
  | 'funded';
export type DecisionOutcome = 'approved' | 'needs_info' | 'counter_offer' | 'declined';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  organizationId: string | null;
}
export interface Organization {
  id: string;
  name: string;
  inn: string;
  industry: string;
  city: string;
  monthsActive: number;
  monthlyRevenue: number;
  monthlyExpenses: number;
  monthlyDebtPayment: number;
  overdueDays: number;
  registered: boolean;
  scenario: 'strong' | 'missing' | 'overdue';
  profile?: BusinessProfile;
}
export interface BusinessProfile {
  legalForm: 'ip' | 'ooo' | 'ao' | 'other';
  taxSystem: 'osno' | 'usn' | 'patent' | 'eshn' | 'npd';
  financingGoal: 'working_capital' | 'equipment' | 'credit_line';
  requestedAmount: number;
  preferredTermMonths: number;
  lowSeasonRevenueDropPct: number;
  largestCustomerSharePct: number;
  cashReserve: number;
  receivablesDays: number;
  financialsAsOf: string;
  version: number;
  updatedAt: string;
}
export interface DocumentGuidance {
  category: string;
  title: string;
  explanation: string;
  required: boolean;
}
export interface BusinessProfileResponse {
  organization: Organization;
  profile: BusinessProfile;
  documentGuidance: DocumentGuidance[];
}
export interface CreditRecommendation {
  product: Product;
  rank: number;
  fitScore: number;
  eligible: boolean;
  reasons: string[];
  cautions: string[];
  blockers: string[];
  proposedAmount: number;
  proposedTermMonths: number;
  calculation: ScenarioResult | null;
  stressRemainingCash: number | null;
  reserveCoverageMonths: number | null;
  score: Score | null;
  documentGuidance: DocumentGuidance[];
}
export interface RecommendationsResponse {
  generatedAt: string;
  methodVersion: string;
  profileVersion: number;
  financialsAsOf: string;
  staleFinancials: boolean;
  market: {
    reviewedAt: string;
    keyRateBps: number;
    keyRateAsOf: string;
    smeShortTermRateBps: number;
    smeLongTermRateBps: number;
    smePeriod: string;
    sources: { title: string; url: string; publishedAt?: string; checkedAt?: string }[];
    note: string;
  };
  inputs: {
    financials: Financials;
    profile: BusinessProfile;
    monthsActive: number;
    overdueDays: number;
    registered: boolean;
  };
  recommendations: CreditRecommendation[];
}
export interface AuthResponse {
  user: User;
  organization: Organization | null;
}
export interface DemoAccount {
  id: string;
  name: string;
  email: string;
  role: Role;
  organization: string;
  scenario: string;
  password: string;
}
export interface Product {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  minAmount: number;
  maxAmount: number;
  minTerm: number;
  maxTerm: number;
  rateBps: number;
  purposes: string[];
  requiredDocuments: string[];
  color: string;
  intake?: ProductIntake;
}
export interface ProductIntake {
  productId: string;
  paused: boolean;
  reason: string;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}
export interface AdminProduct extends Product {
  intake: ProductIntake;
}
export interface AdminOverview {
  generatedAt: string;
  organizations: number;
  users: number;
  activeSessions: number;
  pausedProducts: number;
  applicationCounts: { status: ApplicationStatus; count: number }[];
  submittedAmount: number;
  fundedAmount: number;
}
export interface AdminUserStatus extends User {
  organizationName: string | null;
  activeSessions: number;
  expiredSessions: number;
  latestSessionExpiresAt: string | null;
}
export interface AdminRegistryRow {
  id: string;
  number: string;
  organizationName: string;
  productId: string;
  status: ApplicationStatus;
  amount: number;
  termMonths: number;
  createdAt: string;
  updatedAt: string;
}
export interface Financials {
  monthlyRevenue: number;
  monthlyExpenses: number;
  monthlyDebtPayment: number;
}
export interface ApplicationInput {
  productId: string;
  amount: number;
  termMonths: number;
  purpose: string;
  financials: Financials;
  consent: boolean;
}
export interface ScoreFactor {
  code: string;
  label: string;
  points: number;
  detail: string;
}
export interface Score {
  value: number;
  band: 'low' | 'medium' | 'high';
  factors: ScoreFactor[];
  modelVersion: string;
  evaluatedAt?: string;
  profileVersion?: number;
  paymentLimit?: number;
  stressRemainingCash?: number;
}
export interface Offer {
  amount: number;
  termMonths: number;
  rateBps: number;
  monthlyPayment: number;
  totalRepayment: number;
  totalInterest: number;
}
export interface CreditDecision {
  outcome: DecisionOutcome;
  reasons: string[];
  requestedDocuments: string[];
  offer: Offer | null;
  ruleVersion: string;
  decidedBy: string;
  decidedAt: string;
  documentRequest?: DocumentRequestMetadata;
}
export interface ExternalCheck {
  source: string;
  simulated: true;
  status: 'passed' | 'warning' | 'failed';
  label: string;
  details: string;
  checkedAt: string;
}
export interface Application extends ApplicationInput {
  id: string;
  number: string;
  organizationId: string;
  organizationName: string;
  status: ApplicationStatus;
  version: number;
  score: Score | null;
  decision: CreditDecision | null;
  checks: ExternalCheck[];
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  signedAt: string | null;
  fundedAt: string | null;
  organizationSnapshot?: Organization;
  organizationSnapshotMeta?: {
    source: 'submission' | 'synthetic_seed' | 'legacy_recovery';
    capturedAt: string;
    profileVersion: number;
    captureId?: string;
  };
}
export interface DocumentRecord {
  id: string;
  applicationId: string;
  name: string;
  category: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
  downloadUrl: string;
  synthetic: boolean;
  ocr?: {
    sourceName: string;
    sourceSha256: string;
    sourceSize: number;
    sourceMimeType: string;
    pages: number;
    engine: string;
    reviewedAt: string;
    reviewedBy: string;
  };
}
export interface TimelineEvent {
  id: string;
  action: string;
  title: string;
  detail: string;
  actor: string;
  createdAt: string;
  context?: AuditContext;
}
export interface AuditVersions {
  schemaVersion: 1;
  applicationVersion: number;
  profileVersion?: number;
  scoringVersion?: string;
  policyVersion?: string;
}
export interface AuditContext extends AuditVersions {
  input?: {
    status: ApplicationStatus;
    productId: string;
    productSnapshot?: Product;
    amount: number;
    termMonths: number;
    purpose: string;
    financials: Financials;
    organizationSnapshot?: Organization;
    organizationSnapshotMeta?: Application['organizationSnapshotMeta'];
  };
  assessment?: {
    score: Score | null;
    decision: CreditDecision | null;
    checks: ExternalCheck[];
  };
}
export interface Assessment {
  score: Score;
  decision: CreditDecision;
  checks: ExternalCheck[];
}
export interface ApplicationDetail {
  application: Application;
  documents: DocumentRecord[];
  timeline: TimelineEvent[];
  product: Product;
  organization: Organization;
  assessment: Assessment;
}
export interface PaymentRow {
  month: number;
  dueDate: string;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}
export interface ScenarioResult extends Offer {
  schedule: PaymentRow[];
  debtLoadBps: number;
  availableCash: number;
  affordable: boolean;
  assumptions: string[];
  methodVersion: string;
}
export interface BudgetScenarioInput {
  productId: string;
  termMonths: number;
  comfortablePayment: number;
  monthlyReserve: number;
  financials: Financials;
}
export interface BudgetScenarioResult {
  input: BudgetScenarioInput;
  availableCash: number;
  policyPaymentLimit: number;
  reservePaymentLimit: number;
  effectivePaymentLimit: number;
  minimumProductPayment: number;
  maximumScheduledPayment: number;
  minimumRemainingCash: number;
  bindingLimits: ('comfortable_payment' | 'monthly_reserve' | 'policy' | 'product_maximum')[];
  suggestion: ScenarioResult | null;
  amountStep: number;
  assumptions: string[];
  methodVersion: string;
}
export interface Preferences {
  theme: 'light' | 'dark';
  accent: 'red' | 'mint' | 'violet' | 'amber';
  density: 'comfortable' | 'compact';
  reducedMotion: boolean;
  widgets: string[];
  interests: string[];
}
export interface FeedItem {
  id: string;
  category: string;
  title: string;
  body: string;
  reason: string;
  actionLabel: string;
  href: string;
  publishedAt: string;
  synthetic: true;
}
export interface Dashboard {
  organization: Organization | null;
  stats: {
    activeApplications: number;
    requestedAmount: number;
    fundedAmount: number;
    nextPayment: number;
  };
  applications: Application[];
  products: Product[];
  feed: FeedItem[];
  actions: { title: string; description: string; href: string; priority: 'high' | 'normal' }[];
}
export interface SearchResult {
  id: string;
  type: 'application' | 'product' | 'document';
  title: string;
  description: string;
  href: string;
}
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
export interface ImportPreview {
  previewId: string;
  valid: boolean;
  count: number;
  errors: { row: number; field: string; message: string }[];
  rows: ApplicationInput[];
  expiresAt: string;
}
export interface AuditRecord {
  id: string;
  organizationId: string | null;
  applicationId: string | null;
  actorId: string;
  actorName: string;
  action: string;
  detail: string;
  createdAt: string;
  context?: AuditContext;
}
