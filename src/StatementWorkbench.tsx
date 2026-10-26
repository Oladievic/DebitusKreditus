import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Financials } from '../shared/types';
import type { StatementAnalysis, StatementPeriod, StatementReport } from '../shared/statements';
import { STATEMENT_HEADER } from '../shared/statements';
import { api, date, download, money, useApi } from './api';
import { ArrowDownToLine, FileSearch, Upload } from './icons';
import './statement-workbench.css';

function defaultPeriod(): StatementPeriod {
  const now = new Date();
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))
      .toISOString()
      .slice(0, 10),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10),
  };
}
const monthName = (month: string) =>
  new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
const pct = (bps: number) =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(bps / 100)}%`;

export function StatementWorkbench({
  applicationId,
  version,
  financials,
  editable,
  canPlan,
  onSaved,
}: {
  applicationId: string;
  version: number;
  financials: Financials;
  editable: boolean;
  canPlan: boolean;
  onSaved: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const stored = useApi<{ report: StatementReport | null }>(
    `/applications/${applicationId}/statement`,
  );
  const [expanded, setExpanded] = useState(false);
  const [csv, setCsv] = useState('');
  const [sourceName, setSourceName] = useState('statement.csv');
  const [period, setPeriod] = useState(defaultPeriod);
  const [preview, setPreview] = useState<{
    analysis: StatementAnalysis;
    sourceSha256: string;
  } | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Partial<Record<keyof Financials, boolean>>>({});
  const sequence = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    void stored.refresh();
    setReviewed(false);
    setSelected({});
  }, [version]);
  const key = JSON.stringify([applicationId, version, csv, sourceName, period]);
  const ready = !!preview && previewKey === key && !busy;
  const report = stored.data?.report;
  const forecastFinancials =
    report && report.analysis.fullMonthCount > 0
      ? {
          monthlyRevenue: report.analysis.averageMonthlyRevenue,
          monthlyExpenses: report.analysis.averageMonthlyExpenses,
          monthlyDebtPayment: report.analysis.averageMonthlyDebtPayment,
        }
      : null;
  const canForecast =
    forecastFinancials &&
    Object.values(forecastFinancials).every(
      (value) =>
        value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000,
    );
  const showPreview = !!preview && expanded;
  const analysis = showPreview ? preview!.analysis : report?.analysis;
  function change() {
    sequence.current++;
    setReviewed(false);
    setFailure('');
    setMessage('');
  }
  async function read(file: File) {
    change();
    const request = ++sequence.current;
    if (file.size > 1024 * 1024) {
      setFailure('CSV должен быть не больше 1 МБ.');
      return;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        await file.arrayBuffer(),
      );
      if (alive.current && request === sequence.current) {
        setCsv(text);
        setSourceName(file.name);
        setPreview(null);
      }
    } catch {
      if (alive.current) setFailure('Не удалось прочитать файл. Выберите исправный CSV в UTF-8.');
    }
  }
  function example() {
    const proposed = defaultPeriod();
    const rows = [STATEMENT_HEADER];
    const start = new Date(`${proposed.from}T00:00:00Z`);
    for (let i = 0; i < 3; i++) {
      const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))
        .toISOString()
        .slice(0, 7);
      const a = Math.floor(financials.monthlyRevenue * 0.6);
      const b = financials.monthlyRevenue - a;
      if (a > 0) rows.push(`${month}-05;in;${a};buyer-01;Покупатель Север;revenue;${month}-sale-1`);
      if (b > 0) rows.push(`${month}-18;in;${b};buyer-02;Покупатель Юг;revenue;${month}-sale-2`);
      if (financials.monthlyExpenses > 0)
        rows.push(
          `${month}-20;out;${financials.monthlyExpenses};supplier-01;Поставщик;expense;${month}-cost-1`,
        );
      if (financials.monthlyDebtPayment > 0)
        rows.push(
          `${month}-25;out;${financials.monthlyDebtPayment};lender-01;Кредитор;debt;${month}-debt-1`,
        );
      rows.push(`${month}-08;in;100000;own-account;Свой счёт;transfer;${month}-own-1`);
    }
    change();
    setPeriod(proposed);
    setSourceName('statement-example.csv');
    setCsv(rows.join('\r\n'));
    setPreview(null);
  }
  async function analyze() {
    const request = ++sequence.current;
    setBusy(true);
    setFailure('');
    setMessage('');
    setReviewed(false);
    try {
      const value = await api<{ analysis: StatementAnalysis; sourceSha256: string }>(
        `/applications/${applicationId}/statement/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ version, csv, sourceName, period }),
        },
      );
      if (alive.current && request === sequence.current) {
        setPreview(value);
        setPreviewKey(key);
      }
    } catch (error) {
      if (alive.current && request === sequence.current) setFailure((error as Error).message);
    } finally {
      if (alive.current && request === sequence.current) setBusy(false);
    }
  }
  async function save() {
    if (!ready || !reviewed) return;
    setBusy(true);
    setFailure('');
    try {
      const result = await api<{ report: StatementReport }>(
        `/applications/${applicationId}/statement`,
        {
          method: 'POST',
          body: JSON.stringify({ version, csv, sourceName, period, reviewed: true }),
        },
      );
      if (!alive.current) return;
      stored.setData(result);
      setPreview(null);
      setExpanded(false);
      setSelected({});
      setMessage('Выписка и отчёт сохранены в заявке. Финансовые поля не изменены.');
      await onSaved();
    } catch (error) {
      if (alive.current) setFailure((error as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function apply() {
    if (!report) return;
    const source = report.analysis;
    const values: Partial<Financials> = {};
    const mapping: [keyof Financials, number | null][] = [
      ['monthlyRevenue', source.averageMonthlyRevenue],
      ['monthlyExpenses', source.averageMonthlyExpenses],
      ['monthlyDebtPayment', source.averageMonthlyDebtPayment],
    ];
    for (const [field, value] of mapping)
      if (selected[field] && value !== null) values[field] = value;
    if (!Object.keys(values).length) return;
    setBusy(true);
    setFailure('');
    try {
      await api(`/applications/${applicationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ version, financials: { ...financials, ...values } }),
      });
      if (!alive.current) return;
      setSelected({});
      setMessage(
        'Выбранные средние суммы перенесены в анкету. Сохранённый отчёт остаётся снимком на дату анализа.',
      );
      await onSaved();
    } catch (error) {
      if (alive.current) setFailure((error as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const changed =
    report &&
    (['monthlyRevenue', 'monthlyExpenses', 'monthlyDebtPayment'] as const).some(
      (field) => report.analysis.declaredFinancials[field] !== financials[field],
    );
  return (
    <section
      className="surface statement-workbench"
      aria-labelledby={`statement-title-${applicationId}`}
    >
      <div className="section-head">
        <div>
          <h2 id={`statement-title-${applicationId}`}>Что показывает выписка</h2>
          <p className="section-description">
            Операции, месяцы и расхождения с анкетой — с понятными правилами расчёта.
          </p>
        </div>
        <FileSearch size={24} />
      </div>
      {editable && (
        <button
          type="button"
          className="button secondary"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
            setFailure('');
          }}
        >
          {expanded
            ? 'Закрыть импорт'
            : report
              ? 'Разобрать другую выписку'
              : 'Загрузить выписку CSV'}
        </button>
      )}
      {expanded && editable && (
        <div className="statement-import">
          <p>
            Укажите полный период выгрузки, даже если в некоторые дни операций не было. Дата первой
            операции не доказывает начало периода.
          </p>
          <div className="statement-period">
            <label>
              Период с
              <input
                aria-label="Начало периода выписки"
                type="date"
                value={period.from}
                disabled={busy}
                onChange={(e) => {
                  change();
                  setPeriod({ ...period, from: e.target.value });
                }}
              />
            </label>
            <label>
              По
              <input
                aria-label="Конец периода выписки"
                type="date"
                value={period.to}
                disabled={busy}
                onChange={(e) => {
                  change();
                  setPeriod({ ...period, to: e.target.value });
                }}
              />
            </label>
          </div>
          <div className="statement-file-actions">
            <label className="button secondary file-button">
              <Upload size={17} />
              Выбрать CSV
              <input
                aria-label="CSV банковской выписки"
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) void read(file);
                  e.currentTarget.value = '';
                }}
              />
            </label>
            <button className="text-button" type="button" disabled={busy} onClick={example}>
              Заполнить пример
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() =>
                download(
                  'statement-template.csv',
                  '\uFEFF' + STATEMENT_HEADER + '\r\n',
                  'text/csv;charset=utf-8',
                )
              }
            >
              Скачать шаблон
            </button>
          </div>
          <label className="statement-csv-label">
            Содержимое CSV · {sourceName}
            <textarea
              aria-label="Содержимое выписки CSV"
              value={csv}
              maxLength={1024 * 1024}
              rows={6}
              disabled={busy}
              spellCheck={false}
              onChange={(e) => {
                change();
                setCsv(e.target.value);
                setSourceName('statement.csv');
              }}
            />
          </label>
          <details>
            <summary>Формат и правила классификации</summary>
            <p>
              UTF-8, разделитель «;», до 5000 операций и 1 МБ. Сумма — целые рубли больше нуля;
              направление in / out. kind: revenue — выручка, expense — операционные расходы, debt —
              кредитные платежи, transfer — свои переводы, loan — займы, refund — возвраты.
              Последние четыре категории не входят в операционные выручку и расходы; debt
              учитывается отдельно.
            </p>
            <code>{STATEMENT_HEADER}</code>
            <p>
              Идентификатор контрагента должен быть стабильным. Программа не подтверждает назначение
              платежей, полноту выгрузки или подлинность документа.
            </p>
          </details>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !csv.trim()}
            onClick={() => void analyze()}
          >
            {busy ? 'Обрабатываем…' : 'Проанализировать выписку'}
          </button>
          {preview && !ready && !busy && (
            <p className="statement-notice" role="status">
              Параметры изменились. Пересчитайте анализ перед сохранением.
            </p>
          )}
        </div>
      )}
      {failure && (
        <p className="form-error" role="alert">
          {failure}
        </p>
      )}
      {message && (
        <p className="statement-notice" role="status">
          {message}
        </p>
      )}
      {!expanded && stored.error && (
        <p role="alert">
          {stored.error}
          <button type="button" className="text-button" onClick={() => void stored.refresh()}>
            Повторить
          </button>
        </p>
      )}
      {!analysis && !stored.loading && !expanded && !stored.error && (
        <p className="muted">
          Отчёт ещё не прикреплён. После импорта его увидит банк вместе с отправленной заявкой.
        </p>
      )}
      {analysis && (
        <>
          <p className="statement-source">
            {showPreview
              ? 'Предварительный анализ'
              : `Сохранено ${date(report!.createdAt)} · ${report!.documentName}`}
            <br />
            {analysis.period.from} — {analysis.period.to} · {analysis.uniqueRows} уникальных
            операций · {analysis.fullMonthCount} полных месяцев
          </p>
          {changed && !expanded && (
            <p className="statement-notice">
              Анкета изменилась после анализа. Расхождения ниже сравнивают выписку с сохранёнными
              тогда показателями.
            </p>
          )}
          <StatementAnalysisView analysis={analysis} />
          {ready && expanded && (
            <div className="statement-confirm">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                Проверил период, категории операций и результаты. Сохранить выписку и отчёт в
                заявку.
              </label>
              <button
                type="button"
                className="button primary"
                disabled={busy || !reviewed}
                onClick={() => void save()}
              >
                Сохранить отчёт в заявку
              </button>
            </div>
          )}
          {!expanded && report && (
            <div className="statement-report-actions">
              <a className="button secondary" href={`/api/documents/${report.documentId}/download`}>
                <ArrowDownToLine size={16} />
                Исходный CSV
              </a>
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  download(`statement-analysis-${report.id}.json`, JSON.stringify(report, null, 2))
                }
              >
                <ArrowDownToLine size={16} />
                Отчёт JSON
              </button>
              {canPlan && canForecast && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    navigate('/simulator#cashflow-planner', {
                      state: {
                        statementBaseline: {
                          organizationId: report.organizationId,
                          financials: forecastFinancials,
                          reportId: report.id,
                          label: `Из сохранённого отчёта выписки за ${analysis.period.from} — ${analysis.period.to}: средние за ${analysis.fullMonthCount} полных месяцев.`,
                        },
                      },
                    })
                  }
                >
                  Проверить остаток по этим суммам
                </button>
              )}
              <p className="small muted statement-hash">
                Правила {analysis.methodVersion} · версия заявки {report.applicationVersion}
                <br />
                SHA-256: {report.sourceSha256}
              </p>
            </div>
          )}
          {editable && !expanded && report && analysis.fullMonthCount > 0 && (
            <details className="statement-apply">
              <summary>Перенести выбранные средние суммы в анкету</summary>
              <p>
                Только средние за полные месяцы. Текущие суммы показаны для сравнения. Это изменит
                анкету, но не старый отчёт и не профиль компании.
              </p>
              {(
                [
                  ['monthlyRevenue', 'Выручка', analysis.averageMonthlyRevenue],
                  ['monthlyExpenses', 'Операционные расходы', analysis.averageMonthlyExpenses],
                  ['monthlyDebtPayment', 'Кредитные платежи', analysis.averageMonthlyDebtPayment],
                ] as const
              ).map(([field, label, value]) => (
                <label className="check-row" key={field}>
                  <input
                    type="checkbox"
                    disabled={busy || value === null}
                    checked={!!selected[field]}
                    onChange={(e) => setSelected({ ...selected, [field]: e.target.checked })}
                  />
                  <span>
                    {label}: {value === null ? 'не рассчитано' : money(value)}
                    <small>В анкете {money(financials[field])}</small>
                  </span>
                </label>
              ))}
              <button
                className="button secondary"
                type="button"
                disabled={busy || !Object.values(selected).some(Boolean)}
                onClick={() => void apply()}
              >
                Применить выбранные суммы
              </button>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function StatementAnalysisView({ analysis: a }: { analysis: StatementAnalysis }) {
  return (
    <div className="statement-analysis">
      <dl className="statement-totals">
        <div>
          <dt>Выручка за период</dt>
          <dd>{money(a.totals.revenue)}</dd>
        </div>
        <div>
          <dt>Операционные расходы</dt>
          <dd>{money(a.totals.expenses)}</dd>
        </div>
        <div>
          <dt>Кредитные платежи</dt>
          <dd>{money(a.totals.debtPayment)}</dd>
        </div>
      </dl>
      <div className="statement-observations">
        <p>
          Средняя выручка за полный месяц:{' '}
          <b>
            {a.averageMonthlyRevenue === null
              ? 'нет полных месяцев'
              : money(a.averageMonthlyRevenue)}
          </b>
        </p>
        <p>
          Изменение последнего полного месяца к предыдущему:{' '}
          <b>{a.trendBps === null ? 'недостаточно сопоставимых месяцев' : pct(a.trendBps)}</b>
        </p>
        <p>
          Крупнейший покупатель:{' '}
          <b>
            {a.largestRevenueCounterparty
              ? `${a.largestRevenueCounterparty.name} · ${pct(a.largestRevenueCounterparty.shareBps)}`
              : 'нет выручки'}
          </b>
        </p>
        <p>
          Дни с выручкой:{' '}
          <b>
            {a.regularity.activeRevenueDays} из {a.regularity.totalDays}
          </b>
          . Недели с выручкой:{' '}
          <b>
            {a.regularity.activeRevenueWeeks} из {a.regularity.totalWeeks}
          </b>
          .
        </p>
      </div>
      <div
        className="table-scroll statement-months"
        tabIndex={0}
        role="region"
        aria-label="Операции по месяцам"
      >
        <table>
          <caption>Месячные итоги. Переводы, займы и возвраты исключены из выручки.</caption>
          <thead>
            <tr>
              <th>Месяц</th>
              <th>Период</th>
              <th>Выручка</th>
              <th>Расходы</th>
              <th>Кредиты</th>
            </tr>
          </thead>
          <tbody>
            {a.months.map((month) => (
              <tr key={month.month}>
                <th scope="row">{monthName(month.month)}</th>
                <td>{month.fullMonth ? 'Полный' : 'Часть месяца'}</td>
                <td>{money(month.revenue)}</td>
                <td>{money(month.expenses)}</td>
                <td>{money(month.debtPayment)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="statement-findings">
        <h3>Что проверить</h3>
        {a.findings.length ? (
          a.findings.map((finding, index) => (
            <div
              className={`statement-finding ${finding.severity}`}
              key={`${finding.code}-${index}`}
            >
              <b>{finding.title}</b>
              <p>{finding.detail}</p>
              {finding.rows?.length ? <small>Строки CSV: {finding.rows.join(', ')}</small> : null}
            </div>
          ))
        ) : (
          <p>
            По применённым правилам расхождений не найдено. Это не подтверждает подлинность, полноту
            или кредитоспособность.
          </p>
        )}
      </div>
      <details>
        <summary>Что не вошло в операционные показатели</summary>
        <dl className="statement-excluded">
          {(
            [
              ['transfer', 'Свои переводы'],
              ['loan', 'Займы'],
              ['refund', 'Возвраты'],
              ['debt', 'Кредитные платежи'],
            ] as const
          ).map(([kind, label]) => (
            <div key={kind}>
              <dt>{label}</dt>
              <dd>
                Входящие {money(a.excludedTotals[kind].inflow)} · исходящие{' '}
                {money(a.excludedTotals[kind].outflow)}
              </dd>
            </div>
          ))}
        </dl>
        <p>
          Точные повторные строки исключены один раз. Разные операции с разными reference не
          склеиваются. Расхождение — повод сверить данные; оно не означает мошенничество и не меняет
          решение банка автоматически.
        </p>
      </details>
    </div>
  );
}
