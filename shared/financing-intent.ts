import type { ApplicationInput, CreditRecommendation, Product, ScenarioResult } from './types';

export type FinancingGoal = 'working_capital' | 'equipment' | 'credit_line';
export interface FinancingIntent {
  request: string;
  amount: number | null;
  termMonths: number | null;
  productId: FinancingGoal | null;
  evidence: { amount: string | null; term: string | null; goal: string[] };
  questions: string[];
  methodVersion: string;
}
export interface NavigatorAnalysis {
  intent: FinancingIntent;
  suggestedTermMonths: number;
  profileVersion: number;
  financialsAsOf: string;
  generatedAt: string;
  recommendation: CreditRecommendation | null;
}
export interface NavigatorDraft {
  draft: ApplicationInput;
  product: Product;
  calculation: ScenarioResult;
  profileVersion: number;
  financialsAsOf: string;
  notes: string[];
}

export function parseFinancingIntent(raw: string): FinancingIntent {
  if (typeof raw !== 'string' || raw.trim().length < 3 || raw.length > 500 || /\0/.test(raw))
    throw new Error('Опишите задачу: от 3 до 500 символов.');
  const request = raw.trim();
  const result: FinancingIntent = {
    request,
    amount: null,
    termMonths: null,
    productId: null,
    evidence: { amount: null, term: null, goal: [] },
    questions: [],
    methodVersion: 'financing-intent-rules-1.0',
  };
  const foreign = /доллар|\busd\b|\beur\b|евро|[$€]|юан/iu.test(request);
  const range = /\d\s*[-–—]\s*\d|от\s+\d[\d\s,.]*\s+до\s+\d/iu.test(request);
  const amounts = [
    ...request.matchAll(
      /(?<![\p{L}\d.,+\-−])(\d(?:[\d \u00a0\u202f]*\d)?(?:[,.]\d{1,2})?)\s*(млрд|миллиард(?:а|ов)?|млн|миллион(?:а|ов)?|тыс(?:\.|яч(?:а|и)?)?|₽|руб(?:\.|лей|ля|ль)?)(?!\p{L})/giu,
    ),
  ];
  if (!foreign && !range && !/[-−+]\s*\d/u.test(request) && amounts.length === 1) {
    const match = amounts[0];
    const multiplier = /^млрд|^миллиард/iu.test(match[2])
      ? 1_000_000_000n
      : /^млн|^миллион/iu.test(match[2])
        ? 1_000_000n
        : /^тыс/iu.test(match[2])
          ? 1000n
          : 1n;
    const [whole, fraction = ''] = match[1]
      .replace(/[\s\u00a0\u202f]/g, '')
      .replace(',', '.')
      .split('.');
    const denominator = 10n ** BigInt(fraction.length);
    const numerator = BigInt(whole + fraction) * multiplier;
    if (
      numerator % denominator === 0n &&
      numerator / denominator > 0n &&
      numerator / denominator <= 30_000_000n
    ) {
      result.amount = Number(numerator / denominator);
      result.evidence.amount = match[0].trim();
    }
  }
  if (result.amount === null)
    result.questions.push(
      foreign
        ? 'Расчёт поддерживает только рубли. Укажите нужную сумму в ₽.'
        : range || amounts.length > 1
          ? 'В запросе несколько сумм или диапазон. Выберите одну сумму кредита.'
          : 'Укажите сумму в целых рублях: например, «3 млн» или «500 000 ₽», не более 30 млн.',
    );
  const terms = [
    ...request.matchAll(
      /(?<![\p{L}\d.,+\-−])(\d{1,3}(?:[,.]\d{1,2})?)\s*(месяц(?:а|ев)?|мес\.?|лет|год(?:а)?)(?!\p{L})/giu,
    ),
  ];
  const alternativeTerms =
    /\d+(?:[,.]\d+)?\s*(?:или|либо|\/|-)\s*\d+(?:[,.]\d+)?\s*(?:месяц|мес|лет|год)/iu.test(request);
  if (
    terms.length === 1 &&
    !range &&
    !alternativeTerms &&
    !/[-−+]\s*\d(?:[.,]\d{1,2})?\s*(?:месяц|мес|лет|год)/iu.test(request)
  ) {
    const term = Number(terms[0][1].replace(',', '.')) * (/лет|год/iu.test(terms[0][2]) ? 12 : 1);
    if (Number.isInteger(term) && term >= 1 && term <= 60) {
      result.termMonths = term;
      result.evidence.term = terms[0][0];
    }
  }
  if (terms.length && result.termMonths === null)
    result.questions.push(
      'Уточните один срок в месяцах, не более 60. У каждого продукта свой диапазон.',
    );
  const goals: [FinancingGoal, RegExp][] = [
    [
      'equipment',
      /оборудован[\p{L}]*|трактор[\p{L}]*|стан(?:ок|к)[\p{L}]*|экскаватор[\p{L}]*|производственн[\p{L}]*\s+лини[\p{L}]*/giu,
    ],
    [
      'working_capital',
      /оборотн[\p{L}]*|товар[\p{L}]*|сырь[\p{L}]*|контракт[\p{L}]*|материал[\p{L}]*/giu,
    ],
    [
      'credit_line',
      /кассов[\p{L}]*\s+разрыв[\p{L}]*|сезон[\p{L}]*|резерв[\p{L}]*|овердрафт[\p{L}]*/giu,
    ],
  ];
  const matches = goals
    .map(([goal, expression]) => ({
      goal,
      words: [...request.matchAll(expression)]
        .filter(
          (match) =>
            !/(?:не|без)(?:\s+\p{L}+){0,2}\s*$/iu.test(
              request.slice(Math.max(0, match.index - 25), match.index),
            ),
        )
        .map((match) => match[0]),
    }))
    .filter(({ words }) => words.length);
  if (matches.length === 1) {
    result.productId = matches[0].goal;
    result.evidence.goal = matches[0].words;
  } else
    result.questions.push(
      matches.length
        ? 'В запросе несколько задач. Выберите главную цель для этого черновика.'
        : 'Выберите цель: оборотные средства, оборудование или резерв ликвидности.',
    );
  if (/овердрафт/iu.test(request))
    result.questions.push(
      'В каталоге нет настоящего овердрафта. «Резерв для бизнеса» — одна выдача с равными платежами.',
    );
  return result;
}
