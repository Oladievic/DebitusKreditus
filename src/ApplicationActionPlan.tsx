import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { ApplicationActionPlan as Plan } from '../shared/application-actions';
import { useApi } from './api';
import './application-action-plan.css';

export function ApplicationActionPlan({
  applicationId,
  version,
  bank = false,
}: {
  applicationId: string;
  version: number;
  bank?: boolean;
}) {
  const remote = useApi<Plan>(`/applications/${encodeURIComponent(applicationId)}/action-plan`);
  const lastVersion = useRef(version);
  useEffect(() => {
    if (lastVersion.current !== version) {
      lastVersion.current = version;
      void remote.refresh();
    }
  }, [version, remote.refresh]);
  const data = remote.data?.applicationVersion === version && !remote.error ? remote.data : null;
  return (
    <section
      className="surface application-action-plan"
      id="application-action-plan"
      aria-labelledby="application-action-plan-title"
    >
      <div className="action-plan-heading">
        <h2 id="application-action-plan-title">{data?.headline ?? 'Что делать дальше'}</h2>
        {data && <span>Версия {data.applicationVersion}</span>}
      </div>
      {remote.loading && <p role="status">Собираем следующие действия…</p>}
      {!remote.loading && !remote.error && !data && (
        <div role="status">
          <p>Версия заявки изменилась. Обновите её, чтобы увидеть актуальный план.</p>
          <button className="text-button" type="button" onClick={() => window.location.reload()}>
            Обновить заявку
          </button>
        </div>
      )}
      {remote.error && (
        <div role="alert">
          <p>{remote.error}</p>
          <button className="text-button" type="button" onClick={() => void remote.refresh()}>
            Повторить загрузку плана
          </button>
        </div>
      )}
      {data && (
        <>
          {bank && (
            <p className="action-plan-perspective">
              Действия клиента по текущему пакету. Полномочия сотрудника и решение остаются в
              банковской части заявки.
            </p>
          )}
          <ul className="action-plan-items">
            {data.items.map((item) => (
              <li key={item.id} className={`action-plan-item priority-${item.priority}`}>
                <div className="action-plan-priority">
                  {item.priority === 'required'
                    ? 'Требует внимания'
                    : item.priority === 'review'
                      ? 'Проверить'
                      : 'Следующий шаг'}
                </div>
                <div className="action-plan-content">
                  <h3>{item.title}</h3>
                  <p>{item.what}</p>
                  <details className="action-plan-evidence">
                    <summary>Почему и на каких данных</summary>
                    <p>{item.why}</p>
                    <ul>
                      {item.sources.map((source, index) => (
                        <li key={`${source.kind}-${index}`}>
                          {bank && source.href.startsWith('/business') ? (
                            <span>{source.label}</span>
                          ) : (
                            <Link to={source.href}>{source.label}</Link>
                          )}
                          <span>
                            {formatDate(source.at)}
                            {source.version === undefined ? '' : ` · версия ${source.version}`}
                          </span>
                          {source.detail && <p>{source.detail}</p>}
                        </li>
                      ))}
                    </ul>
                  </details>
                  {!bank && (
                    <Link className="action-plan-link" to={item.href}>
                      {item.actionLabel}
                      <span aria-hidden="true">↗</span>
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!data.items.length && (
            <p>Действий для текущего состояния нет. Проверьте историю заявки.</p>
          )}
          <details className="action-plan-limits">
            <summary>Границы плана действий</summary>
            {data.limitations.map((text) => (
              <p key={text}>{text}</p>
            ))}
            <p>
              {data.methodVersion}. Составлено {formatDate(data.generatedAt)}.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
function formatDate(value: string) {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime())
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow',
      }).format(timestamp)
    : 'Дата не сохранена';
}
