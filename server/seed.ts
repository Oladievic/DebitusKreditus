import type { DemoAccount, Organization } from '../shared/types.js';
import type { Database, SqlStatement } from './db.js';
import { assess, newApplication, PRODUCTS } from './domain.js';
import { passwordHash, sha256, toBase64 } from './security.js';
import { businessProfile } from '../shared/business-profile.js';
export const DEMO_PASSWORD = 'Demo2026!';
export const DEMO_ORGANIZATIONS: Organization[] = [
  {
    id: 'org_sever',
    name: 'Северная мастерская',
    inn: '0000000001',
    industry: 'Производство мебели',
    city: 'Санкт-Петербург',
    monthsActive: 48,
    monthlyRevenue: 2400000,
    monthlyExpenses: 1650000,
    monthlyDebtPayment: 120000,
    overdueDays: 0,
    registered: true,
    scenario: 'strong',
  },
  {
    id: 'org_terra',
    name: 'Терра Кофе',
    inn: '0000000002',
    industry: 'Кофейни и пекарни',
    city: 'Казань',
    monthsActive: 18,
    monthlyRevenue: 1200000,
    monthlyExpenses: 850000,
    monthlyDebtPayment: 40000,
    overdueDays: 0,
    registered: true,
    scenario: 'missing',
  },
  {
    id: 'org_vector',
    name: 'Вектор Логистик',
    inn: '0000000003',
    industry: 'Грузоперевозки',
    city: 'Екатеринбург',
    monthsActive: 36,
    monthlyRevenue: 1800000,
    monthlyExpenses: 1300000,
    monthlyDebtPayment: 200000,
    overdueDays: 75,
    registered: true,
    scenario: 'overdue',
  },
];
export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: 'user_sever',
    name: 'Александр Северин',
    email: 'owner@sever.example.test',
    role: 'client',
    organization: 'Северная мастерская',
    scenario: 'Устойчивый бизнес · одобрение и новые условия',
    password: DEMO_PASSWORD,
  },
  {
    id: 'user_terra',
    name: 'Мария Третьякова',
    email: 'owner@terra.example.test',
    role: 'client',
    organization: 'Терра Кофе',
    scenario: 'Нужны документы · путь с дополнением',
    password: DEMO_PASSWORD,
  },
  {
    id: 'user_vector',
    name: 'Денис Волков',
    email: 'owner@vector.example.test',
    role: 'client',
    organization: 'Вектор Логистик',
    scenario: 'Просрочка · объяснимый отказ',
    password: DEMO_PASSWORD,
  },
  {
    id: 'user_bank',
    name: 'Елена Орлова',
    email: 'bank@debitus.example.test',
    role: 'bank',
    organization: 'Кредитный центр · симулятор',
    scenario: 'Все заявки · проверки и решения',
    password: DEMO_PASSWORD,
  },
  {
    id: 'user_admin',
    name: 'Анна Лебедева',
    email: 'admin@debitus.example.test',
    role: 'admin',
    organization: 'Администрация платформы',
    scenario: 'Приём заявок · доступы · журнал платформы',
    password: DEMO_PASSWORD,
  },
];
export async function initializeDatabase(db: Database): Promise<void> {
  const admin = DEMO_ACCOUNTS.find((account) => account.role === 'admin')!;
  const salt = `debitus-synthetic-${admin.id}-v1`;
  await db.batch([
    {
      sql: 'INSERT OR IGNORE INTO users(id,email,name,role,organization_id,password_hash,password_salt) VALUES(?,?,?,?,NULL,?,?)',
      params: [
        admin.id,
        admin.email,
        admin.name,
        admin.role,
        await passwordHash(DEMO_PASSWORD, salt),
        salt,
      ],
    },
    ...PRODUCTS.map((product) => ({
      sql: "INSERT OR IGNORE INTO product_intake(product_id,paused,reason,version,updated_at,updated_by) VALUES(?,0,'',1,?,NULL)",
      params: [product.id, '2026-10-20T09:00:00.000Z'],
    })),
  ]);
  const existing = await db.query<{ id: string }>('SELECT id FROM users WHERE id=?', ['user_bank']);
  if (existing.length) return;
  const statements: SqlStatement[] = DEMO_ORGANIZATIONS.map((o) => ({
    sql: 'INSERT OR IGNORE INTO organizations(id,data) VALUES(?,?)',
    params: [o.id, JSON.stringify(o)],
  }));
  for (const [i, a] of DEMO_ACCOUNTS.entries()) {
    const salt = `debitus-synthetic-${a.id}-v1`;
    statements.push({
      sql: 'INSERT OR IGNORE INTO users(id,email,name,role,organization_id,password_hash,password_salt) VALUES(?,?,?,?,?,?,?)',
      params: [
        a.id,
        a.email,
        a.name,
        a.role,
        DEMO_ORGANIZATIONS[i]?.id ?? null,
        await passwordHash(DEMO_PASSWORD, salt),
        salt,
      ],
    });
  }
  const at = '2026-10-19T09:00:00.000Z';
  const samples = [
    {
      id: 'app_sever_working',
      org: 0,
      amount: 1200000,
      termMonths: 24,
      productId: 'working_capital',
      purpose: 'Закупка древесины под новый контракт',
      status: 'draft',
    },
    {
      id: 'app_sever_expansion',
      org: 0,
      amount: 8000000,
      termMonths: 12,
      productId: 'working_capital',
      purpose: 'Большая партия сырья для расширения',
      status: 'submitted',
    },
    {
      id: 'app_terra_missing',
      org: 1,
      amount: 900000,
      termMonths: 24,
      productId: 'working_capital',
      purpose: 'Сезонная закупка кофе и упаковки',
      status: 'needs_info',
    },
    {
      id: 'app_vector_review',
      org: 2,
      amount: 1500000,
      termMonths: 24,
      productId: 'working_capital',
      purpose: 'Ремонт и обслуживание автопарка',
      status: 'submitted',
    },
  ] as const;
  for (const s of samples) {
    const org = DEMO_ORGANIZATIONS[s.org],
      a = newApplication(
        {
          productId: s.productId,
          amount: s.amount,
          termMonths: s.termMonths,
          purpose: s.purpose,
          financials: {
            monthlyRevenue: org.monthlyRevenue,
            monthlyExpenses: org.monthlyExpenses,
            monthlyDebtPayment: org.monthlyDebtPayment,
          },
          consent: true,
        },
        org,
        s.id,
        at,
      );
    a.status = s.status;
    a.submittedAt = s.status === 'draft' ? null : at;
    if (s.status !== 'draft') {
      a.organizationSnapshot = { ...org, profile: businessProfile(org) };
      a.organizationSnapshotMeta = { source: 'synthetic_seed', capturedAt: at, profileVersion: 1 };
    }
    const categories = s.org === 1 ? ['statement'] : ['statement', 'financials'];
    if (s.status === 'needs_info') {
      const evaluated = assess(
        a,
        org,
        categories.map((category) => ({ category })),
        'user_bank',
        at,
      );
      a.score = evaluated.score;
      a.checks = evaluated.checks;
      a.decision = evaluated.decision;
    }
    statements.push({
      sql: 'INSERT OR IGNORE INTO applications(id,organization_id,status,version,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      params: [a.id, org.id, a.status, a.version, JSON.stringify(a), at, at],
    });
    for (const category of categories) {
      const bytes = new TextEncoder().encode(
        `СИНТЕТИЧЕСКИЙ ДЕМОНСТРАЦИОННЫЙ ДОКУМЕНТ\n${org.name}\nКатегория: ${category}\nВыручка: ${org.monthlyRevenue} RUB в месяц\nРасходы: ${org.monthlyExpenses} RUB в месяц\nНе является реальной выпиской.\n`,
      );
      statements.push({
        sql: 'INSERT OR IGNORE INTO documents(id,application_id,organization_id,name,category,mime_type,size,sha256,content,synthetic,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        params: [
          `doc_${s.id}_${category}`,
          a.id,
          org.id,
          `${category}-demo.txt`,
          category,
          'text/plain',
          bytes.length,
          await sha256(bytes),
          toBase64(bytes),
          1,
          at,
        ],
      });
    }
    statements.push({
      sql: 'INSERT OR IGNORE INTO audit(id,organization_id,application_id,actor_id,actor_name,action,detail,created_at) VALUES(?,?,?,?,?,?,?,?)',
      params: [
        `audit_${a.id}_seed`,
        org.id,
        a.id,
        DEMO_ACCOUNTS[s.org].id,
        DEMO_ACCOUNTS[s.org].name,
        'created',
        'Синтетическая заявка для демонстрации. Внешние системы не вызывались.',
        at,
      ],
    });
    if (a.status !== 'draft')
      statements.push({
        sql: 'INSERT OR IGNORE INTO audit(id,organization_id,application_id,actor_id,actor_name,action,detail,created_at) VALUES(?,?,?,?,?,?,?,?)',
        params: [
          `audit_${a.id}_status`,
          org.id,
          a.id,
          a.status === 'needs_info' ? 'user_bank' : DEMO_ACCOUNTS[s.org].id,
          a.status === 'needs_info' ? 'Елена Орлова' : DEMO_ACCOUNTS[s.org].name,
          a.status,
          a.status === 'needs_info'
            ? 'Нужна управленческая отчётность: категория financials.'
            : 'Заявка находится в очереди кредитного центра.',
          '2026-10-19T09:05:00.000Z',
        ],
      });
  }
  await db.batch(statements);
}
