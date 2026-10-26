import type { ApplicationDetail, ApplicationStatus, DecisionOutcome } from '../shared/types.js';
import type { LocalAITopic } from '../shared/local-ai.js';
import { DomainError } from './domain.js';

const states: Record<ApplicationStatus, string> = {
  draft: 'Черновик: заявка ещё не отправлена',
  submitted: 'Заявка отправлена',
  in_review: 'Заявка на рассмотрении',
  needs_info: 'Запрошены дополнительные сведения',
  approved: 'Заявка одобрена',
  counter_offer: 'Предложены другие условия',
  declined: 'По заявке отказано',
  accepted: 'Условия приняты клиентом',
  signed: 'Подписание договора завершено в кабинете',
  funded: 'Выдача отражена в кабинете',
};
const outcomes: Record<DecisionOutcome, string> = {
  approved: 'одобрение',
  needs_info: 'нужны дополнительные сведения',
  counter_offer: 'другие условия',
  declined: 'отказ',
};
const categories: Record<string, string> = {
  statement: 'выписка по счёту',
  financials: 'финансовые сведения',
  invoice: 'счёт на оборудование',
  other: 'дополнительные сведения',
  contract: 'договор',
  receipt: 'подтверждение выдачи',
};
const rub = (value: number) =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} ₽`;
const names = (values: string[]) =>
  [...new Set(values)].map((value) => categories[value] ?? 'дополнительный документ').join(', ');

export function assistantBrief(facts: ApplicationDetail, topic: LocalAITopic) {
  const { application: a, assessment, documents } = facts;
  const decision = a.decision ?? assessment.decision;
  const candidates: { id: string; text: string }[] = [];
  const add = (id: string, text: string) => candidates.push({ id, text });
  const header = `${states[a.status]}. ${a.decision ? 'Сохранённое решение' : 'Предварительная оценка, решение ещё не принято'}: ${outcomes[decision.outcome]}.`;
  let required = '';
  if (topic === 'overview') {
    required = decision.reasons[0] ?? '';
    add(
      'score',
      `Оценка ${assessment.score.value} из 100 описывает факторы риска по правилам кабинета, а не вероятность одобрения.`,
    );
    assessment.score.factors
      .slice(0, 8)
      .forEach((factor, index) => add(`factor_${index}`, `${factor.label}: ${factor.detail}`));
    decision.reasons.slice(1, 4).forEach((reason, index) => add(`reason_${index}`, reason));
  } else if (topic === 'payment') {
    const freeCash =
      a.financials.monthlyRevenue - a.financials.monthlyExpenses - a.financials.monthlyDebtPayment;
    required = decision.offer
      ? `${a.decision ? 'Условия сохранённого решения' : 'Предварительно рассчитанные условия'}: ${rub(decision.offer.amount)} на ${decision.offer.termMonths} мес., платёж ${rub(decision.offer.monthlyPayment)} в месяц.`
      : 'Условия кредита пока не сформированы. Причина: ' +
        (decision.reasons[0] ?? 'требуется завершить оценку.');
    required += ` До нового кредита после расходов и текущих платежей остаётся ${rub(freeCash)} в месяц.`;
    if (
      !decision.offer ||
      decision.offer.amount !== a.amount ||
      decision.offer.termMonths !== a.termMonths
    ) {
      add('requested', `В заявке запрошено ${rub(a.amount)} на ${a.termMonths} мес.`);
    }
    add(
      'current_debt',
      `Текущие платежи по данным заявки: ${rub(a.financials.monthlyDebtPayment)} в месяц.`,
    );
    if (decision.offer) {
      add(
        'interest',
        `Ставка ${(decision.offer.rateBps / 100).toLocaleString('ru-RU')}% годовых. Общая сумма процентов — ${rub(decision.offer.totalInterest)}.`,
      );
      required += ` После нового регулярного платежа — ${rub(freeCash - decision.offer.monthlyPayment)} в месяц.`;
      add('schedule', 'Последний платёж может отличаться из-за округления: проверьте график.');
    }
    add(
      'stress',
      'В репетиции заявки проверьте слабый месяц: расходы могут сохраниться при снижении выручки.',
    );
  } else {
    required = decision.requestedDocuments.length
      ? `Запрошено по ${a.decision ? 'сохранённому решению' : 'предварительной оценке'}: ${names(decision.requestedDocuments)}.`
      : 'Дополнительных документов по текущей оценке не запрошено.';
    required += documents.length
      ? ` В досье есть: ${names(documents.map((d) => d.category))}.`
      : ' В досье пока нет документов.';
    add('verification', 'Наличие файла не подтверждает достоверность его содержимого.');
    add(
      'ocr',
      'После распознавания скана или PDF проверьте найденные суммы. Перенос чисел в финансовые поля подтверждается отдельно.',
    );
    if (a.status === 'draft' || a.status === 'needs_info')
      add(
        'upload',
        'Документ можно добавить на странице заявки. После сохранения проверьте комплектность досье.',
      );
  }
  return { header, required, candidates };
}

export function selectionSchema(brief: ReturnType<typeof assistantBrief>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['selected'],
    properties: {
      selected: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
        items: { type: 'string', enum: brief.candidates.map((fact) => fact.id) },
      },
    },
  };
}

export function materializeBrief(brief: ReturnType<typeof assistantBrief>, raw: string) {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    input = null;
  }
  const selected =
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.keys(input).length === 1 &&
    'selected' in input
      ? input.selected
      : null;
  if (
    !Array.isArray(selected) ||
    selected.length < 1 ||
    selected.length > 3 ||
    new Set(selected).size !== selected.length ||
    selected.some(
      (id) => typeof id !== 'string' || !brief.candidates.some((fact) => fact.id === id),
    )
  ) {
    throw new DomainError(
      'LOCAL_AI_INVALID_RESPONSE',
      'Модель не смогла выбрать подтверждённые факты. Полный разбор доступен выше; попробуйте повторить запрос.',
      502,
    );
  }
  return {
    selectedFactIds: selected as string[],
    text: [
      brief.header,
      brief.required,
      ...selected.map((id) => brief.candidates.find((fact) => fact.id === id)!.text),
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
