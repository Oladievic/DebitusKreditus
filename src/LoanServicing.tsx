import { useEffect, useRef, useState } from 'react';
import { api, download, money, rate, useApi } from './api';
import {
  servicingCsv,
  type LoanServicingState,
  type PrepaymentMode,
  type PrepaymentPreview,
} from '../shared/servicing';
import './loan-servicing.css';

const fullDate = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
interface Props {
  applicationId: string;
  readOnly?: boolean;
  onSaved?: () => void;
}
export function LoanServicing({ applicationId, readOnly = false, onSaved }: Props) {
  const { data, setData, loading, error, refresh } = useApi<{ servicing: LoanServicingState }>(
    `/applications/${applicationId}/servicing`,
  );
  const state = data?.servicing;
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PrepaymentMode>('reduce_payment');
  const [preview, setPreview] = useState<PrepaymentPreview | null>(null);
  const [confirmedPayment, setConfirmedPayment] = useState(false);
  const [confirmedPrepayment, setConfirmedPrepayment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const calculation = useRef({ sequence: 0, controller: null as AbortController | null });
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  useEffect(() => {
    calculation.current.sequence++;
    calculation.current.controller?.abort();
    setPreview(null);
    setConfirmedPayment(false);
    setConfirmedPrepayment(false);
    setBusy(false);
  }, [applicationId, state?.version]);
  useEffect(
    () => () => {
      calculation.current.sequence++;
      calculation.current.controller?.abort();
    },
    [applicationId],
  );
  const invalidate = () => {
    calculation.current.sequence++;
    calculation.current.controller?.abort();
    setPreview(null);
    setConfirmedPrepayment(false);
    setFailure('');
    setNotice('');
  };
  const calculate = async () => {
    if (!state) return;
    invalidate();
    const controller = new AbortController(),
      sequence = ++calculation.current.sequence;
    calculation.current.controller = controller;
    setBusy(true);
    try {
      const result = await api<{ preview: PrepaymentPreview }>(
        `/applications/${applicationId}/servicing/prepayment/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ version: state.version, amount: Number(amount), mode }),
          signal: controller.signal,
        },
      );
      if (sequence === calculation.current.sequence) setPreview(result.preview);
    } catch (e) {
      if (sequence === calculation.current.sequence && (e as Error).name !== 'AbortError')
        setFailure((e as Error).message);
    } finally {
      if (sequence === calculation.current.sequence) setBusy(false);
    }
  };
  const record = async (kind: 'payment' | 'prepayment') => {
    if (!state || busy || readOnly) return;
    if (kind === 'payment' && !confirmedPayment) return;
    if (
      kind === 'prepayment' &&
      (!confirmedPrepayment ||
        !preview ||
        preview.version !== state.version ||
        preview.amount !== Number(amount) ||
        preview.mode !== mode)
    )
      return;
    const body = {
      version: state.version,
      ...(kind === 'prepayment' ? { amount: Number(amount), mode } : {}),
      confirmed: true,
    };
    const fingerprint = JSON.stringify({ kind, applicationId, ...body });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setFailure('');
    setNotice('');
    try {
      const result = await api<{ servicing: LoanServicingState }>(
        `/applications/${applicationId}/servicing/${kind}`,
        {
          method: 'POST',
          body: JSON.stringify({ ...body, idempotencyKey: pending.current.key }),
        },
      );
      setData(result);
      setPreview(null);
      setConfirmedPayment(false);
      setConfirmedPrepayment(false);
      pending.current = null;
      setNotice(
        result.servicing.status === 'closed'
          ? 'Кредит погашен в модели. История и график доступны для скачивания.'
          : kind === 'payment'
            ? 'Платёж отмечен в модели. Остаток и следующий период обновлены.'
            : 'Досрочное погашение сохранено в модели. Новый график закреплён.',
      );
      onSaved?.();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <section
        className="surface loan-servicing"
        id="application-servicing"
        tabIndex={-1}
        aria-busy="true"
      >
        <h2>Сопровождение кредита</h2>
        <p>Загружаем график и историю…</p>
      </section>
    );
  if (!state || error)
    return (
      <section className="surface loan-servicing" id="application-servicing" tabIndex={-1}>
        <h2>Сопровождение кредита</h2>
        <p role="alert">{error || 'График пока недоступен.'}</p>
        <button className="button secondary" onClick={() => void refresh()}>
          Обновить сопровождение
        </button>
      </section>
    );
  const completed =
    state.balance === 0
      ? 100
      : Math.min(99, Math.floor((state.paidPrincipal / state.offer.amount) * 100));
  const validAmount =
    Number.isSafeInteger(Number(amount)) && Number(amount) > 0 && Number(amount) <= state.balance;
  return (
    <section
      className="surface loan-servicing"
      id="application-servicing"
      tabIndex={-1}
      aria-labelledby="servicing-title"
    >
      <div className="section-head">
        <div>
          <h2 id="servicing-title">После выдачи</h2>
          <p className="section-description">График, остаток и варианты досрочного погашения.</p>
        </div>
        <button
          className="button secondary"
          onClick={() =>
            download(
              `credit-${applicationId}-servicing.csv`,
              servicingCsv(state),
              'text/csv;charset=utf-8',
            )
          }
        >
          Скачать историю и график CSV
        </button>
      </div>
      <p className="servicing-model-note">
        Операции здесь моделируются: отметка платежа и досрочное погашение не переводят деньги.
        Можно пройти и будущие периоды.
      </p>
      <div className="servicing-position">
        <div>
          <span>{state.status === 'closed' ? 'Погашено в модели' : 'Остаток основного долга'}</span>
          <strong>{money(state.balance)}</strong>
        </div>
        <div className="servicing-progress">
          <span>Погашено {completed}% основного долга</span>
          <div
            role="progressbar"
            aria-label="Погашенная часть основного долга"
            aria-valuenow={completed}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: `${completed}%` }} />
          </div>
          <small>
            {money(state.paidPrincipal)} из {money(state.offer.amount)}
          </small>
        </div>
      </div>
      <dl className="servicing-facts">
        <div>
          <dt>Закреплённая ставка</dt>
          <dd>{rate(state.offer.rateBps)} годовых</dd>
        </div>
        <div>
          <dt>Отмечено процентов</dt>
          <dd>{money(state.paidInterest)}</dd>
        </div>
        <div>
          <dt>Осталось по графику</dt>
          <dd>{money(state.remainingPayments)}</dd>
        </div>
      </dl>
      {failure && (
        <div className="servicing-error" role="alert">
          <p>{failure}</p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              invalidate();
              setConfirmedPayment(false);
              void refresh();
            }}
          >
            Обновить сопровождение
          </button>
        </div>
      )}
      {notice && (
        <p className="servicing-notice" role="status">
          {notice}
        </p>
      )}
      {state.nextPayment && (
        <div className="servicing-next">
          <div>
            <h3>Следующий платёж</h3>
            <p className="servicing-next-amount">{money(state.nextPayment.payment)}</p>
            <p>
              Период {state.nextPayment.month}: {fullDate(state.nextPayment.dueDate)}
            </p>
            <small>
              Основной долг {money(state.nextPayment.principal)} · проценты{' '}
              {money(state.nextPayment.interest)}
            </small>
          </div>
          {!readOnly && (
            <div className="servicing-record">
              <label className="servicing-check">
                <input
                  type="checkbox"
                  checked={confirmedPayment}
                  disabled={busy}
                  onChange={(e) => setConfirmedPayment(e.target.checked)}
                />
                <span>
                  Подтверждаю имитацию платежа {money(state.nextPayment.payment)} за{' '}
                  {fullDate(state.nextPayment.dueDate)} без перевода денег.
                </span>
              </label>
              <button
                className="button primary"
                disabled={busy || !confirmedPayment}
                onClick={() => void record('payment')}
              >
                {busy ? 'Сохраняем…' : 'Отметить платёж в модели'}
              </button>
            </div>
          )}
        </div>
      )}
      {!readOnly && state.status !== 'closed' && (
        <div className="servicing-prepayment">
          <h3>Погасить раньше</h3>
          <p>
            {state.prepaymentAvailable
              ? `Расчёт на границе периода ${fullDate(state.boundaryDate!)}. Проценты за этот период уже включены в отмеченный платёж.`
              : 'Досрочное погашение станет доступно после отметки следующего платежа — на границе его периода.'}
          </p>
          {state.prepaymentAvailable && (
            <>
              <div className="servicing-prepayment-fields">
                <label>
                  Сумма досрочного погашения, ₽
                  <input
                    type="number"
                    min="1"
                    max={state.balance}
                    step="1"
                    inputMode="numeric"
                    value={amount}
                    disabled={busy}
                    onChange={(e) => {
                      invalidate();
                      setAmount(e.target.value);
                    }}
                  />
                </label>
                <label>
                  Что уменьшить
                  <select
                    value={mode}
                    disabled={busy}
                    onChange={(e) => {
                      invalidate();
                      setMode(e.target.value as PrepaymentMode);
                    }}
                  >
                    <option value="reduce_payment">Ежемесячный платёж</option>
                    <option value="reduce_term">Срок кредита</option>
                  </select>
                </label>
                <button
                  className="button secondary"
                  disabled={busy || !validAmount}
                  onClick={() => void calculate()}
                >
                  Рассчитать досрочное погашение
                </button>
              </div>
              {preview && (
                <div className="servicing-preview">
                  <h4>{preview.balance === 0 ? 'Полное погашение' : 'Как изменится график'}</h4>
                  <dl>
                    <div>
                      <dt>Остаток долга</dt>
                      <dd>
                        <span>{money(preview.previousBalance)}</span> → {money(preview.balance)}
                      </dd>
                    </div>
                    <div>
                      <dt>Следующий платёж</dt>
                      <dd>
                        <span>{money(preview.previousPayment)}</span> → {money(preview.nextPayment)}
                      </dd>
                    </div>
                    <div>
                      <dt>Осталось платежей</dt>
                      <dd>
                        <span>{preview.previousTermMonths}</span> → {preview.remainingTermMonths}
                      </dd>
                    </div>
                    <div>
                      <dt>Меньше процентов по модели</dt>
                      <dd>{money(preview.interestSaved)}</dd>
                    </div>
                  </dl>
                  <p>
                    Взнос {money(preview.amount)} относится целиком к основному долгу. Комиссии и
                    дневные проценты не моделируются. Последний платёж может отличаться из-за
                    округления.
                  </p>
                  <label className="servicing-check">
                    <input
                      type="checkbox"
                      checked={confirmedPrepayment}
                      disabled={busy}
                      onChange={(e) => setConfirmedPrepayment(e.target.checked)}
                    />
                    <span>
                      Проверил новый график и подтверждаю имитацию досрочного погашения{' '}
                      {money(preview.amount)} без перевода денег.
                    </span>
                  </label>
                  <button
                    className="button primary"
                    disabled={busy || !confirmedPrepayment}
                    onClick={() => void record('prepayment')}
                  >
                    Сохранить досрочное погашение в модели
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <details className="servicing-calendar" open>
        <summary>
          Календарь оставшихся платежей <span>{state.schedule.length}</span>
        </summary>
        {state.schedule.length ? (
          <ol>
            {state.schedule.map((row) => (
              <li key={row.month}>
                <div>
                  <span>Период {row.month}</span>
                  <time dateTime={row.dueDate}>{fullDate(row.dueDate)}</time>
                </div>
                <strong>{money(row.payment)}</strong>
                <small>
                  Долг {money(row.principal)}
                  <br />
                  Проценты {money(row.interest)}
                </small>
                <small>
                  Остаток
                  <br />
                  {money(row.balance)}
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p>Будущих платежей нет. Основной долг погашен в модели.</p>
        )}
      </details>
      <details className="servicing-history">
        <summary>
          История отметок <span>{state.history.length}</span>
        </summary>
        {state.history.length ? (
          <ol>
            {[...state.history].reverse().map((event) => (
              <li key={event.id}>
                <div>
                  <strong>
                    {event.kind === 'payment' ? 'Платёж' : 'Досрочное погашение'} ·{' '}
                    {money(event.amount)}
                  </strong>
                  <p>
                    Период {fullDate(event.effectiveDate)}; остаток {money(event.balance)}
                  </p>
                  <small>
                    Записал {event.actor};{' '}
                    {new Date(event.recordedAt).toLocaleString('ru-RU', {
                      timeZone: 'Europe/Moscow',
                    })}{' '}
                    МСК
                    {event.mode &&
                      `; ${event.mode === 'reduce_term' ? 'уменьшение срока' : 'уменьшение платежа'}`}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>Платежи ещё не отмечали. Отметки сохранятся здесь и в журнале заявки.</p>
        )}
      </details>
      <details className="servicing-assumptions">
        <summary>Как считаем и что не учитываем</summary>
        <ul>
          {state.assumptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          Предложение на дату выдачи {fullDate(state.fundedAt)}. Метод {state.methodVersion}; версия
          сопровождения {state.version}.
        </p>
      </details>
    </section>
  );
}
