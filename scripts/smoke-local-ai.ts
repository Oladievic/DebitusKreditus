import { freemem } from 'node:os';
import { configureLocalAI } from '../server/local-ai.js';
import { assess, newApplication, PRODUCTS } from '../server/domain.js';
import { DEMO_ORGANIZATIONS } from '../server/seed.js';

const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== '--generate')) {
  console.error(
    'Usage: node --env-file-if-exists=.env --import tsx scripts/smoke-local-ai.ts [--generate]',
  );
  process.exit(2);
}
const service = configureLocalAI(process.env, { freeMemory: freemem });
const state = await service.status();
console.log(
  JSON.stringify({
    state: state.state,
    model: state.model,
    message: state.message,
    freeMemoryGiB: Math.round((freemem() / 1024 ** 3) * 10) / 10,
    modelDigest: state.modelInfo?.digest,
    inferenceRequested: flags.includes('--generate'),
  }),
);
if (!state.available) process.exit(2);
if (flags.includes('--generate')) {
  const organization = DEMO_ORGANIZATIONS[0];
  const application = newApplication(
    {
      productId: PRODUCTS[0].id,
      amount: 1200000,
      termMonths: 24,
      purpose: 'Закупка материалов',
      financials: { monthlyRevenue: 2400000, monthlyExpenses: 1650000, monthlyDebtPayment: 120000 },
      consent: true,
    },
    organization,
  );
  const started = performance.now();
  try {
    const result = await service.explain(
      {
        application,
        organization,
        product: PRODUCTS[0],
        documents: [],
        timeline: [],
        assessment: assess(application, organization, []),
      },
      'overview',
    );
    console.log(
      JSON.stringify({
        ok: true,
        model: result.model,
        modelDigest: result.modelDigest,
        elapsedMs: Math.round(performance.now() - started),
        characters: result.text.length,
        truncated: result.truncated,
        generatedAt: result.generatedAt,
      }),
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Не удалось проверить локальный помощник.',
    );
    process.exitCode = 1;
  }
}
