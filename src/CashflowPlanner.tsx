import { useEffect, useRef, useState } from 'react';
import type { Financials, Organization, Product } from '../shared/types';
import type { CashflowInputs, CashflowResult } from '../shared/cashflow';
import { businessProfile } from '../shared/business-profile';
import { api, download, money } from './api';
import './cashflow-planner.css';

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T12:00:00Z`),
  );
interface CashflowBaseline {
  financials: Financials;
  label: string;
}
function initialInputs(organization: Organization, baseline?: CashflowBaseline): CashflowInputs {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  return {
    startingMonth: `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`,
    horizonMonths: 6,
    openingBalance: businessProfile(organization).cashReserve,
    monthlyInflow: baseline?.financials.monthlyRevenue ?? organization.monthlyRevenue,
    monthlyOperatingOutflow: baseline?.financials.monthlyExpenses ?? organization.monthlyExpenses,
    monthlyExistingDebtPayment:
      baseline?.financials.monthlyDebtPayment ?? organization.monthlyDebtPayment,
    investmentCost: 0,
    monthlyAdditionalNetCash: 0,
    benefitStartMonth: 2,
    seasonalRevenuePct: Array(12).fill(100),
    assumptionsConfirmed: false,
  };
}

function FlowChart({ result }: { result: CashflowResult }) {
  const [active, setActive] = useState(0);
  const index = Math.min(active, result.rows.length - 1);
  const row = result.rows[index];
  const values = [
    result.inputs.openingBalance,
    0,
    ...result.rows.flatMap((r) => [r.noLoan.endingBalance, r.withLoan.endingBalance]),
  ];
  const min = Math.min(...values),
    max = Math.max(...values);
  const span = Math.max(max - min, 1000);
  const y = (value: number) => 24 + ((max - value) / span) * 204;
  const x = (month: number) => 40 + (month / result.rows.length) * 680;
  const path = (track: 'noLoan' | 'withLoan') =>
    [result.inputs.openingBalance, ...result.rows.map((r) => r[track].endingBalance)]
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`)
      .join(' ');
  return (
    <div className="cashflow-chart">
      <div className="cashflow-chart-legend">
        <span>
          <i className="cashflow-line-reference" />
          Без кредита и покупки
        </span>
        <span>
          <i className="cashflow-line-loan" />С кредитом и покупкой
        </span>
      </div>
      <svg
        viewBox="0 0 760 260"
        role="img"
        aria-label="Сравнение остатков денег на конец месяца. Точные суммы доступны ниже и в таблице."
      >
        <line x1="40" y1={y(0)} x2="720" y2={y(0)} className="cashflow-zero" />
        <text x="40" y={Math.max(14, y(0) - 8)} className="cashflow-zero-label">
          0 ₽
        </text>
        <path d={path('noLoan')} className="cashflow-path cashflow-path-reference" />
        <path d={path('withLoan')} className="cashflow-path cashflow-path-loan" />
        <line x1={x(index + 1)} x2={x(index + 1)} y1="18" y2="236" className="cashflow-selector" />
        {(['noLoan', 'withLoan'] as const).map((track) => (
          <circle
            key={track}
            cx={x(index + 1)}
            cy={y(row[track].endingBalance)}
            r="5"
            className={`cashflow-dot cashflow-dot-${track}`}
          />
        ))}
        <text x="40" y="255" className="cashflow-zero-label">
          Начало
        </text>
        <text x="720" y="255" textAnchor="end" className="cashflow-zero-label">
          {monthLabel(result.rows.at(-1)!.month)}
        </text>
      </svg>
      <div className="cashflow-chart-axis" aria-hidden="true">
        <span>Начальный остаток</span>
        <span>{monthLabel(result.rows.at(-1)!.month)}</span>
      </div>
      <div className="cashflow-months" role="group" aria-label="Выберите месяц графика">
        {result.rows.map((r, i) => (
          <button
            type="button"
            key={r.month}
            aria-pressed={index === i}
            onClick={() => setActive(i)}
            onFocus={() => setActive(i)}
            onPointerEnter={() => setActive(i)}
          >
            {monthLabel(r.month)}
          </button>
        ))}
      </div>
      <dl className="cashflow-readout" aria-live="polite">
        <div>
          <dt>{monthLabel(row.month)} · без кредита</dt>
          <dd>{money(row.noLoan.endingBalance)}</dd>
        </div>
        <div>
          <dt>С кредитом и покупкой</dt>
          <dd>{money(row.withLoan.endingBalance)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function CashflowPlanner({
  organization,
  product,
  amount,
  termMonths,
  baseline,
}: {
  organization: Organization;
  product: Product;
  amount: number;
  termMonths: number;
  baseline?: CashflowBaseline;
}) {
  const [inputs, setInputs] = useState<CashflowInputs>(() => initialInputs(organization, baseline));
  const [result, setResult] = useState<CashflowResult | null>(null);
  const [calculatedKey, setCalculatedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ sequence: number; controller: AbortController | null }>({
    sequence: 0,
    controller: null,
  });
  const requestBody = { ...inputs, productId: product.id, amount, termMonths };
  const baselineKey = JSON.stringify(baseline ?? null);
  const requestKey = JSON.stringify([organization.id, organization.profile?.version, requestBody]);
  const ready = !!result && calculatedKey === requestKey && !busy && !error;
  useEffect(
    () => () => {
      request.current.sequence++;
      request.current.controller?.abort();
    },
    [],
  );
  useEffect(() => {
    request.current.sequence++;
    request.current.controller?.abort();
    setBusy(false);
    setError('');
    setCalculatedKey('');
    setInputs(initialInputs(organization, baseline));
    setResult(null);
  }, [organization.id, baselineKey]);
  useEffect(() => {
    setInputs((current) => ({ ...current, assumptionsConfirmed: false }));
  }, [amount, termMonths, product.id, organization.profile?.version]);
  const update = <K extends keyof CashflowInputs>(key: K, value: CashflowInputs[K]) => {
    setInputs((current) => ({
      ...current,
      [key]: value,
      ...(key !== 'assumptionsConfirmed' ? { assumptionsConfirmed: false } : {}),
    }));
    setError('');
  };
  const numberField = (
    key:
      | 'openingBalance'
      | 'monthlyInflow'
      | 'monthlyOperatingOutflow'
      | 'monthlyExistingDebtPayment'
      | 'investmentCost'
      | 'monthlyAdditionalNetCash'
      | 'benefitStartMonth',
    label: string,
    hint?: string,
  ) => (
    <label className="cashflow-field" key={key}>
      <span id={`cashflow-${key}-label`}>{label}</span>
      <input
        aria-labelledby={`cashflow-${key}-label`}
        aria-describedby={hint ? `cashflow-${key}-hint` : undefined}
        type="number"
        inputMode={key === 'monthlyAdditionalNetCash' ? 'text' : 'numeric'}
        min={
          key === 'monthlyAdditionalNetCash' ? -1_000_000_000 : key === 'benefitStartMonth' ? 1 : 0
        }
        max={key === 'benefitStartMonth' ? 60 : 1_000_000_000}
        step="1"
        required
        value={Number.isNaN(inputs[key]) ? '' : inputs[key]}
        onChange={(e) => update(key, e.target.value === '' ? NaN : Number(e.target.value))}
      />
      {hint && <small id={`cashflow-${key}-hint`}>{hint}</small>}
    </label>
  );
  async function calculate(event: React.FormEvent) {
    event.preventDefault();
    request.current.controller?.abort();
    const controller = new AbortController(),
      sequence = ++request.current.sequence;
    request.current.controller = controller;
    setBusy(true);
    setError('');
    try {
      const response = await api<CashflowResult>('/scenario/cashflow', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (sequence !== request.current.sequence) return;
      setResult(response);
      setCalculatedKey(requestKey);
    } catch (failure) {
      if (sequence === request.current.sequence && (failure as Error).name !== 'AbortError')
        setError((failure as Error).message);
    } finally {
      if (sequence === request.current.sequence) setBusy(false);
    }
  }
  function exportCsv() {
    if (!ready || !result) return;
    const rows: (string | number)[][] = [
      ['Метод', result.methodVersion],
      ['Дата расчёта UTC', result.generatedAt],
      ['Первый месяц', result.inputs.startingMonth],
      ['Горизонт, месяцев', result.inputs.horizonMonths],
      ['Начальный остаток RUB', result.inputs.openingBalance],
      ['Сумма кредита RUB', result.loan.amount],
      ['Срок кредита, месяцев', result.loan.termMonths],
      ['Ставка, базисных пунктов', result.loan.rateBps],
      ['Поступления обычного месяца RUB', result.inputs.monthlyInflow],
      ['Операционные выплаты RUB', result.inputs.monthlyOperatingOutflow],
      ['Действующие кредиты RUB', result.inputs.monthlyExistingDebtPayment],
      ['Разовая покупка RUB', result.inputs.investmentCost],
      ['Дополнительный чистый поток RUB', result.inputs.monthlyAdditionalNetCash],
      ['Первый месяц эффекта покупки', result.inputs.benefitStartMonth],
      ...result.inputs.seasonalRevenuePct.map((value, index) => [
        `Сезонность ${MONTHS[index]}, %`,
        value,
      ]),
      [
        'Месяц',
        'Поступления RUB',
        'Операционные выплаты RUB',
        'Действующие кредиты RUB',
        'Получено кредита RUB',
        'Покупка RUB',
        'Эффект покупки RUB',
        'Новый платёж RUB',
        'Без кредита: начало RUB',
        'Без кредита: поток RUB',
        'Без кредита: конец RUB',
        'С кредитом: начало RUB',
        'С кредитом: поток RUB',
        'С кредитом: конец RUB',
      ],
      ...result.rows.map((r) => [
        r.month,
        r.inflow,
        r.operatingOutflow,
        r.existingDebtPayment,
        r.loanProceeds,
        r.investmentOutflow,
        r.additionalNetCash,
        r.loanPayment,
        r.noLoan.openingBalance,
        r.noLoan.netCash,
        r.noLoan.endingBalance,
        r.withLoan.openingBalance,
        r.withLoan.netCash,
        r.withLoan.endingBalance,
      ]),
      ['Долг после горизонта RUB', result.loan.debtAfterHorizon],
      ['Платежи после горизонта RUB', result.loan.paymentsAfterHorizon],
      ...result.assumptions.map((s) => ['Допущение', s]),
    ];
    download(
      'debitus-cashflow.csv',
      '\uFEFF' +
        rows
          .map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(';'))
          .join('\r\n'),
      'text/csv;charset=utf-8',
    );
  }
  return (
    <section
      className="surface cashflow-planner"
      id="cashflow-planner"
      tabIndex={-1}
      aria-labelledby="cashflow-title"
    >
      <div className="cashflow-heading">
        <div>
          <h2 id="cashflow-title">Что будет с деньгами</h2>
          <p>Сравните два пути: продолжить работу или взять кредит и сделать покупку.</p>
        </div>
        <span>{inputs.horizonMonths} месяцев</span>
      </div>
      <form onSubmit={calculate}>
        <p className="cashflow-basis">
          {baseline ? (
            <>
              Начальные поступления и выплаты: {baseline.label}. Это основа для ваших допущений, а
              не будущие поступления. Остаток на начало взят из профиля: проверьте суммы, включая
              налоги.{' '}
            </>
          ) : (
            <>
              Для начала подставлены выручка, расходы и резерв из профиля. Они могут отличаться от
              движения денег на счёте: проверьте суммы, включая налоги.{' '}
            </>
          )}
          Эти изменения останутся только в расчёте.
        </p>
        <div className="cashflow-controls">
          <label className="cashflow-field">
            <span>Первый месяц</span>
            <input
              type="month"
              required
              min="2000-01"
              max="2099-12"
              value={inputs.startingMonth}
              onChange={(e) => update('startingMonth', e.target.value)}
            />
          </label>
          <label className="cashflow-field">
            <span id="cashflow-horizon-label">Горизонт расчёта</span>
            <select
              aria-labelledby="cashflow-horizon-label"
              value={inputs.horizonMonths}
              onChange={(e) => update('horizonMonths', Number(e.target.value) as 6 | 12)}
            >
              <option value={6}>6 месяцев</option>
              <option value={12}>12 месяцев</option>
            </select>
          </label>
          {numberField('openingBalance', 'Деньги на начало, ₽', 'Доступный остаток, а не прибыль.')}
          {numberField('monthlyInflow', 'Поступления в обычный месяц, ₽')}
          {numberField(
            'monthlyOperatingOutflow',
            'Операционные выплаты в месяц, ₽',
            'Без кредитов и разовой покупки.',
          )}
          {numberField('monthlyExistingDebtPayment', 'Действующие кредиты в месяц, ₽')}
        </div>
        <div className="cashflow-investment">
          <h3>Если сделать покупку</h3>
          <p>
            {product.name}: {money(amount)}, {termMonths} мес. Кредит поступает в первый месяц;
            первый платёж — в следующий.
          </p>
          <div className="cashflow-controls">
            {numberField(
              'investmentCost',
              'Разовая покупка, ₽',
              'Только в пути с кредитом. Можно оставить 0 для резерва.',
            )}
            {numberField(
              'monthlyAdditionalNetCash',
              'Изменение чистого потока в месяц, ₽',
              'Ваше допущение после текущих затрат. Можно указать минус.',
            )}
            {numberField(
              'benefitStartMonth',
              'С какого месяца будет эффект',
              '1 — сразу. Если позже горизонта, эффекта на графике нет.',
            )}
          </div>
        </div>
        <details className="cashflow-seasonality">
          <summary>Сезонность поступлений</summary>
          <p>
            100% — обычный месяц, 50% — половина поступлений, 150% — в полтора раза больше. Выплаты
            и эффект покупки не меняются.
          </p>
          <div className="cashflow-season-grid">
            {MONTHS.map((month, index) => (
              <label className="cashflow-field" key={month}>
                <span>{month}, %</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="300"
                  step="1"
                  required
                  value={
                    Number.isNaN(inputs.seasonalRevenuePct[index])
                      ? ''
                      : inputs.seasonalRevenuePct[index]
                  }
                  onChange={(e) =>
                    update(
                      'seasonalRevenuePct',
                      inputs.seasonalRevenuePct.map((v, i) =>
                        i === index ? (e.target.value === '' ? NaN : Number(e.target.value)) : v,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <label className="cashflow-confirm">
          <input
            type="checkbox"
            checked={inputs.assumptionsConfirmed === true}
            onChange={(e) => update('assumptionsConfirmed', e.target.checked)}
          />
          <span>Я проверил денежные суммы и понимаю, что эффект покупки — моё допущение.</span>
        </label>
        <div className="cashflow-actions">
          <button
            className="button primary"
            type="submit"
            disabled={busy || inputs.assumptionsConfirmed !== true}
          >
            {busy ? 'Считаем движение денег…' : 'Сравнить денежный поток'}
          </button>
          <button className="button secondary" type="button" onClick={exportCsv} disabled={!ready}>
            Скачать прогноз CSV
          </button>
        </div>
        {error && (
          <p role="alert" className="cashflow-error">
            {error}
          </p>
        )}
      </form>
      {result ? (
        <div className="cashflow-result" aria-busy={busy}>
          {!ready && (
            <p className="cashflow-stale" role="status">
              Параметры изменились. На графике прежний расчёт; подтвердите новые суммы и сравните
              ещё раз.
            </p>
          )}
          <FlowChart result={result} />
          <div className="cashflow-outcomes">
            {(['noLoan', 'withLoan'] as const).map((track) => (
              <div key={track}>
                <h3>{track === 'noLoan' ? 'Без кредита и покупки' : 'С кредитом и покупкой'}</h3>
                <p>
                  {result[track].firstNegativeMonth
                    ? `Первый минус на конец месяца: ${monthLabel(result[track].firstNegativeMonth!)}.`
                    : 'Отрицательного остатка на конец месяца в этом сценарии нет.'}
                </p>
                <small>
                  Минимум с учётом начального остатка: {money(result[track].minimumBalance)}.
                </small>
              </div>
            ))}
          </div>
          <p className="cashflow-basis">
            После показанного периода основной долг составит {money(result.loan.debtAfterHorizon)},
            будущие платежи по графику — {money(result.loan.paymentsAfterHorizon)}. Остаток на счёте
            не уменьшен на весь этот будущий долг.
          </p>
          <details className="cashflow-table-details">
            <summary>Движение денег по месяцам</summary>
            <div
              className="cashflow-table-scroll"
              role="region"
              tabIndex={0}
              aria-label="Денежный поток по месяцам, таблица с горизонтальной прокруткой"
            >
              <table>
                <caption>
                  Суммы в рублях. Выплаты показаны положительными суммами и вычитаются из
                  поступлений.
                </caption>
                <thead>
                  <tr>
                    {[
                      'Месяц',
                      'Поступления',
                      'Операционные выплаты',
                      'Действующие кредиты',
                      'Получено кредита',
                      'Покупка',
                      'Эффект покупки',
                      'Новый платёж',
                      'Без кредита: начало',
                      'Без кредита: поток',
                      'Без кредита: конец',
                      'С кредитом: начало',
                      'С кредитом: поток',
                      'С кредитом: конец',
                    ].map((title) => (
                      <th key={title} scope="col">
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.month}>
                      <th scope="row">{monthLabel(r.month)}</th>
                      {[
                        r.inflow,
                        r.operatingOutflow,
                        r.existingDebtPayment,
                        r.loanProceeds,
                        r.investmentOutflow,
                        r.additionalNetCash,
                        r.loanPayment,
                        r.noLoan.openingBalance,
                        r.noLoan.netCash,
                        r.noLoan.endingBalance,
                        r.withLoan.openingBalance,
                        r.withLoan.netCash,
                        r.withLoan.endingBalance,
                      ].map((v, i) => (
                        <td key={i}>{new Intl.NumberFormat('ru-RU').format(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details className="cashflow-method">
            <summary>Как рассчитан сценарий</summary>
            <ul>
              {result.assumptions.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <p>
              Расчёт:{' '}
              {new Intl.DateTimeFormat('ru-RU', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Europe/Moscow',
              }).format(new Date(result.generatedAt))}{' '}
              МСК. Версия: {result.methodVersion}. Дата данных профиля:{' '}
              {result.source?.financialsAsOf ?? 'не указана'}.
            </p>
          </details>
        </div>
      ) : (
        <p className="cashflow-empty">
          Укажите покупку и её ожидаемый эффект или оставьте нули, чтобы оценить кредит как резерв.
          График появится после подтверждения расчёта.
        </p>
      )}
    </section>
  );
}
