import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Info,
  SlidersHorizontal,
  TrendingUp,
} from '../icons';
import type {
  ApplicationInput,
  BudgetScenarioResult,
  Product,
  ScenarioResult,
} from '../../shared/types';
import { api, download, money, rate, useApi } from '../api';
import { useAuth } from '../context';
import { ErrorState, Loading, PageHead } from '../ui';
import { CreditTerms } from '../FieldGuide';
import { CashflowPlanner } from '../CashflowPlanner';
import '../simulator-v4.css';

export function Simulator() {
  const { data, loading, error, refresh } = useApi<{ products: Product[] }>('/products');
  const location = useLocation();
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} retry={refresh} />;
  return <SimulatorForm key={location.key} products={data.products} />;
}

interface ApplicationDraft extends Omit<ApplicationInput, 'consent'> {
  userId: string;
  organizationId: string;
}
function readApplicationDraft(
  value: unknown,
  products: Product[],
  userId: string,
  organizationId: string,
): ApplicationDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const product = products.find((item) => item.id === candidate.productId);
  const validInteger = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
  if (
    candidate.userId !== userId ||
    candidate.organizationId !== organizationId ||
    !product ||
    !validInteger(candidate.amount, product.minAmount, product.maxAmount) ||
    !validInteger(candidate.termMonths, product.minTerm, product.maxTerm) ||
    typeof candidate.purpose !== 'string' ||
    candidate.purpose.trim().length < 3 ||
    candidate.purpose.length > 500 ||
    !candidate.financials ||
    typeof candidate.financials !== 'object' ||
    Array.isArray(candidate.financials)
  )
    return null;
  const financials = candidate.financials as Record<string, unknown>;
  if (
    !['monthlyRevenue', 'monthlyExpenses', 'monthlyDebtPayment'].every((field) =>
      validInteger(financials[field], 0, 1_000_000_000),
    )
  )
    return null;
  return {
    userId,
    organizationId,
    productId: product.id,
    amount: candidate.amount as number,
    termMonths: candidate.termMonths as number,
    purpose: candidate.purpose,
    financials: {
      monthlyRevenue: financials.monthlyRevenue as number,
      monthlyExpenses: financials.monthlyExpenses as number,
      monthlyDebtPayment: financials.monthlyDebtPayment as number,
    },
  };
}

function SimulatorForm({ products }: { products: Product[] }) {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const org = auth.organization!;
  const applicationDraft = readApplicationDraft(
    location.state?.applicationDraft,
    products,
    auth.user.id,
    org.id,
  );
  const proposedBaseline = location.state?.statementBaseline;
  const baseline =
    proposedBaseline &&
    proposedBaseline.organizationId === auth.organization?.id &&
    typeof proposedBaseline.label === 'string' &&
    proposedBaseline.label.length <= 500 &&
    proposedBaseline.financials &&
    ['monthlyRevenue', 'monthlyExpenses', 'monthlyDebtPayment'].every(
      (field) =>
        Number.isSafeInteger(proposedBaseline.financials[field]) &&
        proposedBaseline.financials[field] >= 0 &&
        proposedBaseline.financials[field] <= 1_000_000_000,
    )
      ? { financials: proposedBaseline.financials, label: proposedBaseline.label }
      : undefined;
  useEffect(() => {
    if (location.hash !== '#cashflow-planner') return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById('cashflow-planner');
      target?.scrollIntoView({ block: 'start', behavior: 'instant' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash]);
  const [mode, setMode] = useState<'amount' | 'payment'>('amount');
  const [productId, setProductId] = useState(applicationDraft?.productId ?? 'working_capital');
  const [amount, setAmount] = useState(applicationDraft?.amount ?? 1500000);
  const [termMonths, setTerm] = useState(applicationDraft?.termMonths ?? 24);
  const [stress, setStress] = useState(0);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [comparison, setComparison] = useState<ScenarioResult | null>(null);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [calculatedKey, setCalculatedKey] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);
  const [comfortablePayment, setComfortablePayment] = useState(100000);
  const [monthlyReserve, setMonthlyReserve] = useState(150000);
  const [budget, setBudget] = useState<BudgetScenarioResult | null>(null);
  const [budgetFailure, setBudgetFailure] = useState('');
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [budgetCalculatedKey, setBudgetCalculatedKey] = useState('');
  const [budgetAttempt, setBudgetAttempt] = useState(0);
  const product = products.find((p) => p.id === productId);
  const sourceFinancials = applicationDraft?.financials ?? org;
  const financials = {
    monthlyRevenue: Math.round(sourceFinancials.monthlyRevenue * (1 - stress / 100)),
    monthlyExpenses: sourceFinancials.monthlyExpenses,
    monthlyDebtPayment: sourceFinancials.monthlyDebtPayment,
  };
  const requestKey = JSON.stringify([productId, amount, termMonths, financials]);
  const ready = !!result && calculatedKey === requestKey && !busy && !failure;
  const budgetRequestKey = JSON.stringify([
    productId,
    termMonths,
    comfortablePayment,
    monthlyReserve,
    financials,
  ]);
  const budgetReady =
    !!budget && budgetCalculatedKey === budgetRequestKey && !budgetBusy && !budgetFailure;
  useEffect(() => {
    let active = true;
    if (!product || mode !== 'amount') return;
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(() => {
      const common = { productId, amount, financials };
      Promise.all([
        api<ScenarioResult>('/scenario', {
          method: 'POST',
          body: JSON.stringify({ ...common, termMonths }),
          signal: controller.signal,
        }),
        api<ScenarioResult>('/scenario', {
          method: 'POST',
          body: JSON.stringify({
            ...common,
            termMonths: Math.min(product.maxTerm, termMonths + 12),
          }),
          signal: controller.signal,
        }),
      ])
        .then(([r, c]) => {
          if (active) {
            setResult(r);
            setComparison(c);
            setCalculatedKey(requestKey);
            setFailure('');
          }
        })
        .catch((e) => {
          if (active) setFailure(e.message);
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, product?.id, attempt, mode]);
  useEffect(() => {
    if (!product || mode !== 'payment') return;
    const controller = new AbortController();
    let active = true;
    setBudgetBusy(true);
    setBudgetFailure('');
    const timer = setTimeout(() => {
      void api<BudgetScenarioResult>('/scenario/affordability', {
        method: 'POST',
        body: JSON.stringify({
          productId,
          termMonths,
          comfortablePayment,
          monthlyReserve,
          financials,
        }),
        signal: controller.signal,
      })
        .then((response) => {
          if (!active) return;
          setBudget(response);
          setBudgetCalculatedKey(budgetRequestKey);
        })
        .catch((error) => {
          if (active) setBudgetFailure((error as Error).message);
        })
        .finally(() => {
          if (active) setBudgetBusy(false);
        });
    }, 180);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [budgetRequestKey, product?.id, budgetAttempt, mode]);
  if (!product)
    return <ErrorState message="Кредитный продукт недоступен. Вернитесь к выбору продукта." />;
  const cash =
    financials.monthlyRevenue - financials.monthlyExpenses - financials.monthlyDebtPayment;
  const percent = result && cash > 0 ? Math.round((result.monthlyPayment / cash) * 100) : null;
  const gaugePercent = percent === null ? 0 : Math.min(100, percent);
  function exportSchedule() {
    if (!result || !ready) return;
    const rows = [
      ['ДЕМО — синтетический расчёт', result.methodVersion],
      ['Месяц', 'Дата', 'Платёж RUB', 'Основной долг RUB', 'Проценты RUB', 'Остаток RUB'],
      ...result.schedule.map((r) => [
        r.month,
        r.dueDate,
        r.payment,
        r.principal,
        r.interest,
        r.balance,
      ]),
    ];
    download(
      'debitus-payment-schedule-demo.csv',
      '\uFEFF' + rows.map((r) => r.join(';')).join('\r\n'),
      'text/csv;charset=utf-8',
    );
  }
  return (
    <>
      <PageHead
        title="Репетиция заявки"
        subtitle="Проверьте следующий шаг бизнеса — до отправки в банк."
        action={
          <span className="badge blue">
            <SlidersHorizontal size={14} />
            Расчёт без заявки
          </span>
        }
      />
      {applicationDraft && (
        <section className="surface budget-result" aria-label="Источник параметров расчёта">
          <h2>Параметры из анкеты</h2>
          <p>
            Выручка {money(sourceFinancials.monthlyRevenue)}, операционные расходы{' '}
            {money(sourceFinancials.monthlyExpenses)}, действующие платежи{' '}
            {money(sourceFinancials.monthlyDebtPayment)} в месяц. Профиль компании не изменён.
          </p>
        </section>
      )}
      <CreditTerms />
      <div className="simulator-mode" role="group" aria-label="Способ расчёта">
        <button aria-pressed={mode === 'amount'} onClick={() => setMode('amount')}>
          <strong>От суммы</strong>
          <span>Какой будет платёж</span>
        </button>
        <button aria-pressed={mode === 'payment'} onClick={() => setMode('payment')}>
          <strong>От комфортного платежа</strong>
          <span>Какая сумма укладывается в бюджет</span>
        </button>
      </div>
      <div className="simulator-grid">
        <section className="surface simulator-controls">
          <div className="section-head">
            <h2>{mode === 'payment' ? 'Сначала — бюджет месяца' : 'Соберите свой сценарий'}</h2>
            <span className="icon-tile blue">
              <SlidersHorizontal size={21} />
            </span>
          </div>
          <label>
            Продукт
            <select
              aria-label="Продукт расчёта"
              value={productId}
              onChange={(e) => {
                const p = products.find((p) => p.id === e.target.value)!;
                setProductId(p.id);
                setAmount(Math.min(p.maxAmount, Math.max(p.minAmount, amount)));
                setTerm(Math.min(p.maxTerm, Math.max(p.minTerm, termMonths)));
              }}
            >
              {products.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {mode === 'payment' && (
            <div className="budget-inputs">
              <label htmlFor="comfortable-payment">Комфортный платёж в месяц</label>
              <div className="budget-input-line">
                <input
                  id="comfortable-payment"
                  type="number"
                  min="0"
                  max="1000000000"
                  step="1000"
                  inputMode="numeric"
                  value={comfortablePayment}
                  onChange={(event) => setComfortablePayment(Number(event.target.value))}
                />
                <span>₽</span>
              </div>
              <label htmlFor="monthly-reserve">Оставлять свободно каждый месяц</label>
              <div className="budget-input-line">
                <input
                  id="monthly-reserve"
                  type="number"
                  min="0"
                  max="1000000000"
                  step="1000"
                  inputMode="numeric"
                  value={monthlyReserve}
                  onChange={(event) => setMonthlyReserve(Number(event.target.value))}
                />
                <span>₽</span>
              </div>
              <p>
                Этот запас остаётся после расходов и всех кредитных платежей. Сейчас до нового
                кредита свободно{' '}
                <b>
                  {money(
                    financials.monthlyRevenue -
                      financials.monthlyExpenses -
                      financials.monthlyDebtPayment,
                  )}
                </b>{' '}
                в месяц.
              </p>
            </div>
          )}
          {mode === 'amount' && (
            <div className="range-field">
              <div className="range-title">
                <label htmlFor="scenario-amount">Сколько нужно бизнесу</label>
                <div className="range-value">
                  <input
                    id="scenario-amount"
                    type="number"
                    min={product.minAmount}
                    max={product.maxAmount}
                    value={amount}
                    onChange={(e) => setAmount(+e.target.value)}
                    onBlur={() =>
                      setAmount(Math.max(product.minAmount, Math.min(product.maxAmount, amount)))
                    }
                  />
                  <span>₽</span>
                </div>
              </div>
              <input
                aria-label="Сумма кредита"
                type="range"
                min={product.minAmount}
                max={product.maxAmount}
                step={50000}
                value={amount}
                onChange={(e) => setAmount(+e.target.value)}
                style={
                  {
                    '--range-progress': `${((amount - product.minAmount) / (product.maxAmount - product.minAmount)) * 100}%`,
                  } as React.CSSProperties
                }
              />
              <div className="range-limits">
                <span>{money(product.minAmount, true)}</span>
                <span>{money(product.maxAmount, true)}</span>
              </div>
            </div>
          )}
          <div className="range-field">
            <div className="range-title">
              <label htmlFor="scenario-term">На какой срок</label>
              <div className="range-value">
                <input
                  id="scenario-term"
                  type="number"
                  min={product.minTerm}
                  max={product.maxTerm}
                  value={termMonths}
                  onChange={(e) => setTerm(+e.target.value)}
                  onBlur={() =>
                    setTerm(Math.max(product.minTerm, Math.min(product.maxTerm, termMonths)))
                  }
                />
                <span>мес.</span>
              </div>
            </div>
            <input
              aria-label="Срок кредита"
              type="range"
              min={product.minTerm}
              max={product.maxTerm}
              value={termMonths}
              onChange={(e) => setTerm(+e.target.value)}
              style={
                {
                  '--range-progress': `${((termMonths - product.minTerm) / (product.maxTerm - product.minTerm)) * 100}%`,
                } as React.CSSProperties
              }
            />
            <div className="range-limits">
              <span>{product.minTerm} мес.</span>
              <span>{product.maxTerm} мес.</span>
            </div>
          </div>
          <div className="stress-test">
            <div>
              <span className="icon-tile peach">
                <TrendingUp size={20} />
              </span>
              <h3>А если выручка снизится?</h3>
            </div>
            <p>Проверим запас прочности при прежних расходах.</p>
            <div className="stress-options">
              {[0, 10, 20, 30].map((s) => (
                <button
                  key={s}
                  onClick={() => setStress(s)}
                  className={stress === s ? 'selected' : ''}
                >
                  {s === 0 ? 'Без снижения' : `−${s}%`}
                </button>
              ))}
            </div>
            <p className="small">
              Выручка в сценарии: <b>{money(financials.monthlyRevenue)}</b>
            </p>
          </div>
        </section>
        {mode === 'amount' ? (
          <section className={`scenario-result ${!ready ? 'calculating' : ''}`} aria-busy={busy}>
            <div className="result-heading">
              <span>Ваш будущий платёж</span>
              <span>{rate(product.rateBps)} годовых</span>
            </div>
            {failure ? (
              <div className="inline-alert" role="alert">
                {failure}
                <button className="text-button" onClick={() => setAttempt((n) => n + 1)}>
                  Повторить расчёт
                </button>
              </div>
            ) : result ? (
              <>
                <strong className="payment-number" aria-live="polite">
                  {money(result.monthlyPayment)}
                  <small>в месяц</small>
                </strong>
                <div className="cash-gauge">
                  <svg
                    viewBox="0 0 260 145"
                    role="img"
                    aria-label={
                      percent === null
                        ? 'Свободного денежного потока нет: доля платежа не рассчитывается'
                        : `Кредитный платёж займёт ${percent}% свободных денег`
                    }
                  >
                    <path
                      className="gauge-bg"
                      d="M 25 125 A 105 105 0 0 1 235 125"
                      fill="none"
                      pathLength="100"
                    />
                    <path
                      className={`gauge-fill ${result.affordable ? '' : 'warning'}`}
                      d="M 25 125 A 105 105 0 0 1 235 125"
                      fill="none"
                      pathLength="100"
                      strokeDasharray={`${gaugePercent} 100`}
                    />
                    <text x="130" y="102" textAnchor="middle">
                      {percent === null ? '—' : `${percent}%`}
                    </text>
                    <text className="gauge-caption" x="130" y="125" textAnchor="middle">
                      {percent === null ? 'нет свободного потока' : 'от свободных денег'}
                    </text>
                  </svg>
                </div>
                <div className={`affordability ${result.affordable ? 'good' : 'risky'}`}>
                  <span>{result.affordable ? <Check size={19} /> : <Info size={19} />}</span>
                  <div>
                    <b>
                      {result.affordable
                        ? 'Есть запас для нового платежа'
                        : 'Нагрузка требует внимания'}
                    </b>
                    <p>
                      {result.affordable
                        ? 'Платёж укладывается в лимит учебной модели.'
                        : 'Попробуйте меньшую сумму или более длинный срок.'}
                    </p>
                  </div>
                </div>
                <div className="result-breakdown">
                  <div>
                    <span>Останется свободно в месяц</span>
                    <b>{money(result.availableCash - result.monthlyPayment)}</b>
                  </div>
                  <div>
                    <span>Проценты за весь срок</span>
                    <b>{money(result.totalInterest)}</b>
                  </div>
                  <div>
                    <span>Всего к возврату</span>
                    <b>{money(result.totalRepayment)}</b>
                  </div>
                </div>
                {!ready && (
                  <p role="status" className="calculation-pending">
                    Пересчитываем условия… Предыдущий результат пока недоступен для заявки.
                  </p>
                )}
                <button
                  className="button primary full"
                  disabled={!ready}
                  onClick={() => {
                    if (ready)
                      navigate(
                        `/applications/new?product=${productId}&amount=${amount}&term=${termMonths}`,
                        {
                          state: {
                            scenarioFinancials: financials,
                            ...(applicationDraft
                              ? { navigatorPurpose: applicationDraft.purpose }
                              : {}),
                          },
                        },
                      );
                  }}
                >
                  Создать заявку с этими условиями
                  <ArrowUpRight size={17} />
                </button>
                <p className="result-note">
                  Предварительный расчёт. Он не является решением банка.
                </p>
              </>
            ) : (
              <Loading />
            )}
          </section>
        ) : (
          <section
            className={`surface budget-result ${budgetReady ? '' : 'is-pending'}`}
            aria-busy={budgetBusy}
            aria-label="Результат расчёта от платежа"
          >
            {budgetFailure ? (
              <div className="inline-alert" role="alert">
                {budgetFailure}
                <button
                  className="text-button"
                  onClick={() => setBudgetAttempt((value) => value + 1)}
                >
                  Повторить расчёт бюджета
                </button>
              </div>
            ) : budget ? (
              <>
                <div className="budget-heading">
                  <span>Сумма под ваш бюджет</span>
                  <span>
                    {rate(product.rateBps)} · {termMonths} мес.
                  </span>
                </div>
                {budget.suggestion ? (
                  <>
                    <strong className="budget-amount" aria-live="polite">
                      {money(budget.suggestion.amount)}
                    </strong>
                    <p className="budget-summary">
                      Все платежи укладываются в предел <b>{money(budget.effectivePaymentLimit)}</b>
                      . Подобрали сумму с шагом {money(budget.amountStep)}.
                    </p>
                    <dl className="budget-ledger">
                      <div>
                        <dt>Обычный платёж</dt>
                        <dd>{money(budget.suggestion.monthlyPayment)}</dd>
                      </div>
                      <div>
                        <dt>Самый большой платёж</dt>
                        <dd>{money(budget.maximumScheduledPayment)}</dd>
                      </div>
                      <div className="budget-retained">
                        <dt>Останется даже в месяц наибольшего платежа</dt>
                        <dd>{money(budget.minimumRemainingCash)}</dd>
                      </div>
                      <div>
                        <dt>Проценты за весь срок</dt>
                        <dd>{money(budget.suggestion.totalInterest)}</dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <div className="budget-empty">
                    <Info size={28} />
                    <h3>В этот бюджет сумма не помещается</h3>
                    <p>
                      Для минимальных {money(product.minAmount)} на {termMonths} мес. нужен предел
                      не меньше <b>{money(budget.minimumProductPayment)}</b> в месяц. Сейчас
                      доступно <b>{money(budget.effectivePaymentLimit)}</b>.
                    </p>
                    <p>
                      Проверьте свободный поток и размер запаса. Более длинный срок может снизить
                      платёж, но увеличит проценты.
                    </p>
                  </div>
                )}
                <div className="budget-limits">
                  <h3>Что ограничивает платёж</h3>
                  <dl>
                    <div
                      className={
                        budget.bindingLimits.includes('comfortable_payment') ? 'is-binding' : ''
                      }
                    >
                      <dt>Ваш комфортный платёж</dt>
                      <dd>{money(budget.input.comfortablePayment)}</dd>
                    </div>
                    <div
                      className={
                        budget.bindingLimits.includes('monthly_reserve') ? 'is-binding' : ''
                      }
                    >
                      <dt>Поток за вычетом вашего запаса</dt>
                      <dd>{money(budget.reservePaymentLimit)}</dd>
                    </div>
                    <div className={budget.bindingLimits.includes('policy') ? 'is-binding' : ''}>
                      <dt>65% свободного потока по модели</dt>
                      <dd>{money(budget.policyPaymentLimit)}</dd>
                    </div>
                  </dl>
                  <p>Берём меньшую границу. Максимум продукта — {money(product.maxAmount)}.</p>
                </div>
                {!budgetReady && (
                  <p className="calculation-pending" role="status">
                    Обновляем сумму под новые параметры… Предыдущий результат нельзя перенести.
                  </p>
                )}
                {budget.suggestion && (
                  <button
                    className="button primary full"
                    disabled={!budgetReady}
                    onClick={() => {
                      if (!budgetReady || !budget.suggestion) return;
                      setAmount(budget.suggestion.amount);
                      setMode('amount');
                      setShowSchedule(true);
                    }}
                  >
                    Перенести в расчёт
                    <ArrowRight size={18} />
                  </button>
                )}
                <p className="budget-note">
                  Перенос откроет полный график. Создать черновик можно следующим шагом. Это расчёт
                  бюджета, а не одобрение кредита.
                </p>
                <details className="calculation-details">
                  <summary>
                    <CircleHelp size={17} />
                    Допущения расчёта
                  </summary>
                  {budget.assumptions.map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </details>
              </>
            ) : (
              <Loading />
            )}
          </section>
        )}
      </div>
      {mode === 'amount' &&
        ready &&
        result &&
        comparison &&
        comparison.termMonths !== result.termMonths && (
          <section className="compare-scenario">
            <span className="icon-tile mint">
              <TrendingUp size={23} />
            </span>
            <div>
              <h3>Чуть больше времени — ниже платёж</h3>
              <p>
                При сроке {comparison.termMonths} месяцев платёж составит{' '}
                <b>{money(comparison.monthlyPayment)}</b>. Проценты за весь срок:{' '}
                {money(comparison.totalInterest)} вместо {money(result.totalInterest)}.
              </p>
            </div>
            <button className="button secondary" onClick={() => setTerm(comparison.termMonths)}>
              Сравнить вариант
              <ArrowRight size={17} />
            </button>
          </section>
        )}
      {mode === 'amount' && result && (
        <section className="surface schedule-section">
          <div className="section-head">
            <button
              className="section-toggle"
              onClick={() => setShowSchedule(!showSchedule)}
              aria-expanded={showSchedule}
            >
              <h2>График платежей</h2>
              <ChevronDown className={showSchedule ? 'rotated' : ''} size={20} />
            </button>
            <button className="text-button" disabled={!ready} onClick={exportSchedule}>
              <ArrowDownToLine size={17} />
              Скачать CSV
            </button>
          </div>
          {!ready && (
            <p className="calculation-pending" role="status">
              График будет доступен после успешного расчёта новых условий.
            </p>
          )}
          {showSchedule && ready && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Месяц</th>
                    <th>Дата</th>
                    <th className="number">Платёж</th>
                    <th className="number">Основной долг</th>
                    <th className="number">Проценты</th>
                    <th className="number">Остаток</th>
                  </tr>
                </thead>
                <tbody>
                  {result.schedule.map((r) => (
                    <tr key={r.month}>
                      <td>{r.month}</td>
                      <td>{new Date(r.dueDate).toLocaleDateString('ru-RU')}</td>
                      <td className="number">{money(r.payment)}</td>
                      <td className="number">{money(r.principal)}</td>
                      <td className="number">{money(r.interest)}</td>
                      <td className="number">{money(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details className="calculation-details">
            <summary>
              <CircleHelp size={17} />
              Как мы считаем
            </summary>
            {result.assumptions.map((s) => (
              <p key={s}>{s}</p>
            ))}
            <p>
              Расчёт выполняется сервером по версии {result.methodVersion}. Значения округляются до
              целых рублей. Проверки БКИ и регистрационного статуса в репетицию не входят.
            </p>
          </details>
        </section>
      )}
      <CashflowPlanner
        key={
          applicationDraft
            ? `application-${location.key}`
            : baseline
              ? String(proposedBaseline.reportId)
              : 'profile'
        }
        baseline={
          applicationDraft
            ? { financials: applicationDraft.financials, label: 'Показатели из анкеты' }
            : baseline
        }
        organization={org}
        product={product}
        amount={amount}
        termMonths={termMonths}
      />
    </>
  );
}
