import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  FileSearch,
  FileText,
  Info,
  Search,
  ShieldCheck,
} from '../icons';
import type { Application, ApplicationDetail } from '../../shared/types';
import { api, date, money, useApi } from '../api';
import { useAuth } from '../context';
import { Empty, ErrorState, Loading, PageHead, Status } from '../ui';

export function Bank() {
  const { data, loading, error, refresh } = useApi<{ applications: Application[] }>('/bank/queue');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} retry={refresh} />;
  const apps = data.applications.filter(
    (a) =>
      (filter === 'all' ||
        (filter === 'new'
          ? a.status === 'submitted'
          : filter === 'review'
            ? a.status === 'in_review'
            : a.status === 'needs_info')) &&
      `${a.number} ${a.organizationName} ${a.purpose}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHead
        title="Рабочее место банка"
        subtitle="Единая очередь. Прозрачная оценка. Обоснованное решение."
        action={
          <span className="badge blue">
            <ShieldCheck size={15} />
            Кредитный аналитик
          </span>
        }
      />
      <div className="bank-overview">
        <div>
          <span className="icon-tile blue">
            <FileText size={21} />
          </span>
          <span>
            Новые заявки
            <strong>{data.applications.filter((a) => a.status === 'submitted').length}</strong>
          </span>
        </div>
        <div>
          <span className="icon-tile peach">
            <FileSearch size={21} />
          </span>
          <span>
            На рассмотрении
            <strong>{data.applications.filter((a) => a.status === 'in_review').length}</strong>
          </span>
        </div>
        <div>
          <span className="icon-tile mint">
            <Clock3 size={21} />
          </span>
          <span>
            Ожидают клиента
            <strong>{data.applications.filter((a) => a.status === 'needs_info').length}</strong>
          </span>
        </div>
      </div>
      <div className="list-toolbar">
        <div className="tabs">
          {[
            ['all', 'Все'],
            ['new', 'Новые'],
            ['review', 'На рассмотрении'],
            ['waiting', 'Уточнение'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? 'active' : ''}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="small-search">
          <Search size={17} />
          <input
            aria-label="Поиск в очереди"
            placeholder="Компания или номер"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <section className="surface bank-queue">
        {apps.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Заявка и компания</th>
                  <th>Сумма / срок</th>
                  <th>Статус</th>
                  <th>Скоринг</th>
                  <th>Обновление</th>
                  <th>
                    <span className="sr-only">Открыть</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/applications/${a.id}`} className="table-primary-link">
                        <b>{a.organizationName}</b>
                        <span>
                          {a.number} · {a.purpose}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <b>{money(a.amount)}</b>
                      <span className="table-sub">{a.termMonths} месяцев</span>
                    </td>
                    <td>
                      <Status status={a.status} />
                    </td>
                    <td>
                      {a.score ? (
                        <span className={`score-pill ${a.score.band}`}>
                          {a.score.value}
                          <small>/100</small>
                        </span>
                      ) : (
                        <span className="muted">Не рассчитан</span>
                      )}
                    </td>
                    <td>{date(a.updatedAt)}</td>
                    <td>
                      <Link
                        className="icon-button"
                        to={`/applications/${a.id}`}
                        aria-label={`Открыть ${a.number}`}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="В этой очереди пока пусто"
            text="Заявки появятся после отправки из кабинета предпринимателя."
          />
        )}
      </section>
      <div className="help-strip">
        <Info size={20} />
        <p>
          Кредитная политика отделяет скоринговый балл от решения. Сотрудник запускает проверки, смотрит
          причины и подтверждает допустимый исход.
        </p>
      </div>
    </>
  );
}

export function BankDecision({
  detail,
  refresh,
}: {
  detail: ApplicationDetail;
  refresh: () => Promise<void>;
}) {
  const { toast } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [request, setRequest] = useState(false);
  const [documents, setDocuments] = useState<string[]>(['financials']);
  const a = detail.application;
  const assessment = detail.assessment;
  async function act(path: string, body: object) {
    setBusy(true);
    setError('');
    try {
      await api(`/bank/applications/${a.id}/${path}`, {
        method: 'POST',
        body: JSON.stringify({ version: a.version, ...body }),
      });
      await refresh();
      toast(
        path === 'review'
          ? 'Проверки выполнены. Можно принять решение.'
          : 'Решение сохранено и доступно клиенту',
      );
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  if (!['submitted', 'in_review', 'needs_info'].includes(a.status)) return null;
  return (
    <section className="surface bank-decision">
      <div className="section-head">
        <h2>Действия сотрудника</h2>
        <span className="badge blue">
          <ShieldCheck size={14} />
          Банк
        </span>
      </div>
      {a.status === 'submitted' ? (
        <>
          <p>
            Запустите проверку полноты данных, локальные симуляторы ФНС и БКИ и расчёт риска.
            Результат будет сохранён в заявке.
          </p>
          <button className="button primary" disabled={busy} onClick={() => void act('review', {})}>
            <FileSearch size={18} />
            Проверить заявку
          </button>
        </>
      ) : a.status === 'needs_info' ? (
        <div className="inline-notice">
          <Clock3 size={20} />
          Ожидаем дополнения от клиента. После их отправки заявка вернётся в очередь.
        </div>
      ) : (
        <>
          <p>
            Сверьте результаты и подтвердите решение. Проверяемые ограничения нельзя обойти вручную.
          </p>
          {assessment && (
            <div className="recommended-decision">
              <span className="small muted">Рекомендация кредитной политики</span>
              <Status status={assessment.decision.outcome} />
              <ul>
                {assessment.decision.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {assessment.decision.offer && (
                <div className="offer-grid">
                  <div>
                    <span>Сумма</span>
                    <b>{money(assessment.decision.offer.amount)}</b>
                  </div>
                  <div>
                    <span>Платёж</span>
                    <b>{money(assessment.decision.offer.monthlyPayment)}</b>
                  </div>
                </div>
              )}
            </div>
          )}
          <label>
            Комментарий клиенту
            <textarea
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Уточнение к решению понятным языком"
              rows={3}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={request}
              onChange={(e) => setRequest(e.target.checked)}
            />
            <span>Запросить дополнительные сведения вместо решения</span>
          </label>
          {request && (
            <div className="request-doc-options">
              {[
                ['statement', 'Выписка по счёту'],
                ['financials', 'Финансовая отчётность'],
                ['invoice', 'Счёт на оборудование'],
                ['other', 'Дополнительный документ'],
              ].map(([key, text]) => (
                <label className="checkbox-label" key={key}>
                  <input
                    type="checkbox"
                    checked={documents.includes(key)}
                    onChange={(e) =>
                      setDocuments(
                        e.target.checked ? [...documents, key] : documents.filter((d) => d !== key),
                      )
                    }
                  />
                  {text}
                </label>
              ))}
            </div>
          )}
          <button
            className="button primary"
            disabled={busy || (request && (!reason.trim() || !documents.length)) || !assessment}
            onClick={() =>
              void act('decision', {
                outcome: request ? 'needs_info' : assessment?.decision.outcome,
                reason: reason.trim() || undefined,
                requestedDocuments: request ? documents : undefined,
              })
            }
          >
            {busy ? 'Сохраняем…' : request ? 'Запросить сведения у клиента' : 'Подтвердить решение'}
            <ArrowRight size={17} />
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  );
}
