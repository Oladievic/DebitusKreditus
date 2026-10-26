import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AlternativesResponse, FinancingAlternative } from '../shared/alternatives';
import { api, money, rate, useApi } from './api';
import './financing-alternatives.css';

const outcomeLabel = {
  approved: 'Числовая нагрузка проходит',
  counter_offer: 'Нужна корректировка нагрузки',
  needs_info: 'Нужны дополнительные сведения',
  declined: 'Есть ограничения правил',
};
const difference = (value: number, format = money) =>
  value === 0 ? 'Без изменения' : `${value > 0 ? '+' : '−'}${format(Math.abs(value))}`;
const fullDate = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));

function AlternativeMetrics({ option }: { option: FinancingAlternative }) {
  return (
    <dl className="alternative-metrics">
      <div>
        <dt>Сумма на задачу</dt>
        <dd>{money(option.calculation.amount)}</dd>
        <small>{difference(option.deltas.amount)}</small>
      </div>
      <div>
        <dt>Срок</dt>
        <dd>{option.calculation.termMonths} мес.</dd>
        <small>{difference(option.deltas.termMonths, (value) => `${value} мес.`)}</small>
      </div>
      <div>
        <dt>Максимальный платёж</dt>
        <dd>{money(option.maximumPayment)}</dd>
        <small>{difference(option.deltas.maximumPayment)}</small>
      </div>
      <div>
        <dt>Проценты за весь срок</dt>
        <dd>{money(option.calculation.totalInterest)}</dd>
        <small>{difference(option.deltas.totalInterest)}</small>
      </div>
      <div>
        <dt>Всего вернуть</dt>
        <dd>{money(option.calculation.totalRepayment)}</dd>
      </div>
      <div>
        <dt>Остаток потока после платежа</dt>
        <dd>{money(option.minimumRemainingCash)}</dd>
      </div>
    </dl>
  );
}

export function FinancingAlternatives({
  applicationId,
  applicationVersion,
  canCreateDraft = false,
  onApplicationChanged,
}: {
  applicationId: string;
  applicationVersion: number;
  canCreateDraft?: boolean;
  onApplicationChanged?: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const { data, error, loading, refresh } = useApi<AlternativesResponse>(
    `/applications/${encodeURIComponent(applicationId)}/alternatives?version=${applicationVersion}`,
  );
  const [selected, setSelected] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const request = useRef<{ sequence: number; controller: AbortController | null }>({
    sequence: 0,
    controller: null,
  });
  useEffect(() => {
    setSelected('');
    setConfirmed(false);
  }, [data]);
  useEffect(() => {
    request.current.sequence++;
    request.current.controller?.abort();
    setSelected('');
    setConfirmed(false);
    setBusy(false);
    return () => {
      request.current.sequence++;
      request.current.controller?.abort();
    };
  }, [applicationId, applicationVersion]);
  const current = data?.applicationVersion === applicationVersion;
  const option = current ? data?.options.find((item) => item.id === selected) : undefined;
  async function openDraft() {
    if (!data || !option || !confirmed || busy || data.product.intakePaused) return;
    const sequence = ++request.current.sequence;
    const controller = new AbortController();
    request.current.controller = controller;
    setBusy(true);
    setFailure('');
    try {
      const fresh = await api<AlternativesResponse>(
        `/applications/${encodeURIComponent(applicationId)}/alternatives`,
        { signal: controller.signal },
      );
      if (sequence !== request.current.sequence) return;
      const checked = fresh.options.find((item) => item.id === option.id);
      if (
        fresh.applicationVersion !== data.applicationVersion ||
        fresh.profileVersion !== data.profileVersion ||
        fresh.product.intakePaused ||
        !checked ||
        JSON.stringify(checked.blockers) !== JSON.stringify(option.blockers)
      ) {
        setConfirmed(false);
        setSelected('');
        setFailure('Данные или условия изменились. Выберите и проверьте вариант заново.');
        if (fresh.applicationVersion !== data.applicationVersion && onApplicationChanged)
          await onApplicationChanged();
        else await refresh();
        return;
      }
      const draft = checked.draft;
      navigate(
        `/applications/new?product=${encodeURIComponent(draft.productId)}&amount=${draft.amount}&term=${draft.termMonths}`,
        {
          state: { scenarioFinancials: draft.financials, navigatorPurpose: draft.purpose },
        },
      );
    } catch (e) {
      if (sequence === request.current.sequence && (e as Error).name !== 'AbortError')
        setFailure((e as Error).message);
    } finally {
      if (sequence === request.current.sequence) setBusy(false);
    }
  }
  return (
    <section
      className="surface financing-alternatives"
      id="financing-alternatives"
      tabIndex={-1}
      aria-labelledby="alternatives-title"
    >
      <div className="alternatives-heading">
        <div>
          <h2 id="alternatives-title">Сравнить варианты финансирования</h2>
          <p>
            Что важнее для этой задачи: платёж, проценты или сумма? Сравниваем одну цель и
            показываем цену каждого изменения.
          </p>
        </div>
      </div>
      {loading && <p role="status">Сравниваем допустимые сроки и платежи…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" className="button secondary" onClick={() => void refresh()}>
            Повторить сравнение
          </button>
        </div>
      )}
      {data && !error && (
        <>
          {!current && (
            <p className="alternatives-notice" role="status">
              Заявка изменилась.{' '}
              <button
                type="button"
                className="text-button"
                onClick={() => void (onApplicationChanged ? onApplicationChanged() : refresh())}
              >
                Обновить сравнение
              </button>
            </p>
          )}
          <div className="alternatives-baseline">
            <div>
              <h3>Исходный запрос</h3>
              <p>
                {data.product.name} · {rate(data.baseline.calculation.rateBps)} годовых
              </p>
            </div>
            <dl>
              <div>
                <dt>Сумма</dt>
                <dd>{money(data.baseline.calculation.amount)}</dd>
              </div>
              <div>
                <dt>Срок</dt>
                <dd>{data.baseline.calculation.termMonths} мес.</dd>
              </div>
              <div>
                <dt>Максимальный платёж</dt>
                <dd>{money(data.baseline.maximumPayment)}</dd>
              </div>
              <div>
                <dt>Проценты за весь срок</dt>
                <dd>{money(data.baseline.calculation.totalInterest)}</dd>
              </div>
            </dl>
          </div>
          {data.blockers.length > 0 && (
            <div className="alternatives-notice">
              <strong>Что учитывает исходная оценка</strong>
              <ul>
                {data.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="alternatives-grid">
            {data.options.map((item) => (
              <article
                key={item.id}
                className={`alternative-option${selected === item.id ? ' is-selected' : ''}`}
              >
                <h3>{item.title}</h3>
                <p>{item.explanation}</p>
                <AlternativeMetrics option={item} />
                <p
                  className={`alternative-outcome${item.blockers.length ? ' has-requirements' : ''}`}
                >
                  {outcomeLabel[item.assessment.decision.outcome]}
                </p>
                {item.blockers.length > 0 && (
                  <ul className="alternative-blockers">
                    {item.blockers.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                )}
                {canCreateDraft && (
                  <button
                    type="button"
                    className="button secondary"
                    aria-pressed={selected === item.id}
                    disabled={!current || busy || data.product.intakePaused}
                    onClick={() => {
                      setSelected(item.id);
                      setConfirmed(false);
                      setFailure('');
                    }}
                  >
                    {selected === item.id ? 'Вариант выбран' : 'Выбрать для новой анкеты'}
                  </button>
                )}
              </article>
            ))}
          </div>
          {data.unavailable.length > 0 && (
            <details className="alternatives-method">
              <summary>
                {data.options.length
                  ? 'Почему показаны не все варианты'
                  : 'Почему нет подходящих вариантов'}
              </summary>
              <ul>
                {data.unavailable.map((item) => (
                  <li key={item.intent}>{item.reason}</li>
                ))}
              </ul>
            </details>
          )}
          {option && canCreateDraft && (
            <div
              className="alternative-confirmation"
              role="region"
              aria-label="Подтверждение выбранного варианта"
            >
              <h3>
                Новая анкета: {money(option.calculation.amount)} на {option.calculation.termMonths}{' '}
                мес.
              </h3>
              <p>
                Исходная заявка и её решение сохраняются. Новая анкета откроется для проверки;
                документы нужно приложить заново.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  Проверил сумму, срок, проценты и ограничения. Понимаю, что это расчёт, а не
                  одобрение.
                </span>
              </label>
              <button
                type="button"
                className="button primary"
                disabled={!confirmed || busy || !current || data.product.intakePaused}
                onClick={() => void openDraft()}
              >
                {busy ? 'Проверяем актуальность…' : 'Открыть новую анкету'}
              </button>
            </div>
          )}
          {failure && (
            <p className="form-error" role="alert">
              {failure}
            </p>
          )}
          <details className="alternatives-method">
            <summary>Данные, правила и ограничения расчёта</summary>
            <p>
              {data.source === 'submission_snapshot'
                ? 'Используется сохранённый снимок профиля заявки'
                : 'Используется текущий профиль организации'}
              , версия {data.profileVersion}. Дата финансовых сведений в профиле —{' '}
              {fullDate(data.financialsAsOf)}; суммы — из сохранённой анкеты версии{' '}
              {data.applicationVersion}. Сравнение на {fullDate(data.generatedAt)}.
            </p>
            <p>
              Выручка {money(data.financials.monthlyRevenue)}, операционные расходы{' '}
              {money(data.financials.monthlyExpenses)}, действующие платежи{' '}
              {money(data.financials.monthlyDebtPayment)} в месяц.
            </p>
            <ul>
              {data.assumptions.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
            <small>
              Метод {data.methodVersion}; проверено сроков: {data.search.termsChecked}. Исходное
              решение и расчёт вариантов могут относиться к разным датам.
            </small>
          </details>
        </>
      )}
    </section>
  );
}
