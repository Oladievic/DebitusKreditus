import { useEffect, useRef } from 'react';
import type { ApplicationChanges as Changes } from '../shared/application-changes';
import { useApi, num } from './api';
import './application-changes.css';

const statuses: Record<string, string> = {
  passed: 'Пройдено по правилам',
  warning: 'Нужно уточнение',
  failed: 'Ограничение',
  approved: 'Одобрение',
  counter_offer: 'Другие условия',
  declined: 'Отказ',
  needs_info: 'Нужны сведения',
};
export function ApplicationChanges({
  applicationId,
  version,
}: {
  applicationId: string;
  version: number;
}) {
  const remote = useApi<Changes>(`/bank/applications/${encodeURIComponent(applicationId)}/changes`);
  const lastVersion = useRef(version);
  useEffect(() => {
    if (lastVersion.current !== version) {
      lastVersion.current = version;
      void remote.refresh();
    }
  }, [version, remote.refresh]);
  const data = remote.data?.currentVersion === version && !remote.error ? remote.data : null;
  return (
    <section
      className="surface application-changes"
      id="application-changes"
      aria-labelledby="application-changes-title"
    >
      <div className="application-changes-heading">
        <h2 id="application-changes-title">Что изменилось в пакете</h2>
        {data && <span>Текущая версия {data.currentVersion}</span>}
      </div>
      {remote.loading && <p role="status">Сравниваем сохранённые версии…</p>}
      {!remote.loading && !remote.error && !data && (
        <div role="status">
          <p>Версия заявки изменилась. Обновите её перед сравнением пакетов.</p>
          <button className="text-button" type="button" onClick={() => window.location.reload()}>
            Обновить заявку
          </button>
        </div>
      )}
      {remote.error && (
        <div role="alert">
          <p>{remote.error}</p>
          <button className="text-button" type="button" onClick={() => void remote.refresh()}>
            Повторить сравнение
          </button>
        </div>
      )}
      {data && (
        <>
          <p className="changes-baseline">
            {data.baseline.label}
            {data.baseline.version === undefined ? '' : ` · версия ${data.baseline.version}`}
            {data.baseline.at ? ` · ${date(data.baseline.at)}` : ''}
          </p>
          {data.baseline.limitation && <p className="changes-notice">{data.baseline.limitation}</p>}
          {data.baseline.available && !data.hasChanges && (
            <p className="changes-notice" role="status">
              В сопоставимых данных изменений нет. Неопределённые источники перечислены отдельно.
            </p>
          )}
          {data.fields.length > 0 && (
            <div className="changes-group">
              <h3>Анкета и финансовые сведения</h3>
              <dl className="changes-rows">
                {data.fields.map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>
                      <span>
                        <small>Было</small>
                        {value(field.before)}
                      </span>
                      <span>
                        <small>Стало</small>
                        {value(field.after)}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div className="changes-group">
            <h3>Оценка текущего пакета</h3>
            <div className="changes-score">
              <span>
                <small>Исходный балл</small>
                <b>{data.assessment.before?.score ?? 'Нет снимка'}</b>
              </span>
              <span>
                <small>Текущий балл</small>
                <b>
                  {data.assessment.current.score}
                  <em> / 100</em>
                </b>
              </span>
            </div>
            <p className="changes-note">{data.assessment.note}</p>
            <dl className="changes-rows">
              <div>
                <dt>Решение и расчётный исход</dt>
                <dd>
                  <span>
                    <small>Ранее принятое решение</small>
                    {data.assessment.before?.outcome
                      ? statuses[data.assessment.before.outcome]
                      : 'Не сохранено в исходном снимке'}
                  </span>
                  <span>
                    <small>Текущий расчёт, без принятия решения</small>
                    {statuses[data.assessment.current.outcome]}
                  </span>
                </dd>
              </div>
            </dl>
            <p className="changes-note">
              Правила скоринга: {data.assessment.before?.scoringVersion ?? 'не сохранены'} →{' '}
              {data.assessment.current.scoringVersion}. Политика:{' '}
              {data.assessment.before?.policyVersion ?? 'не сохранена'} →{' '}
              {data.assessment.current.policyVersion}.
            </p>
            {data.factors.length > 0 && (
              <dl className="changes-rows">
                {data.factors.map((factor) => (
                  <div key={factor.code}>
                    <dt>{factor.label}</dt>
                    <dd>
                      <span>
                        <small>
                          Было:{' '}
                          {factor.beforePoints === null
                            ? 'нет снимка'
                            : `${factor.beforePoints > 0 ? '+' : ''}${factor.beforePoints} баллов`}
                        </small>
                        {factor.beforeDetail ?? 'Признак отсутствовал'}
                      </span>
                      <span>
                        <small>
                          Стало:{' '}
                          {factor.afterPoints === null
                            ? 'нет признака'
                            : `${factor.afterPoints > 0 ? '+' : ''}${factor.afterPoints} баллов`}
                        </small>
                        {factor.afterDetail ?? 'Признак отсутствует'}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {data.checks.length > 0 && (
            <div className="changes-group">
              <h3>Проверки</h3>
              <dl className="changes-rows">
                {data.checks.map((check) => (
                  <div key={check.key}>
                    <dt>{check.label}</dt>
                    <dd>
                      <span>
                        <small>
                          Было:{' '}
                          {check.beforeStatus
                            ? (statuses[check.beforeStatus] ?? check.beforeStatus)
                            : 'нет снимка'}
                        </small>
                        {check.beforeDetail}
                      </span>
                      <span>
                        <small>
                          Стало:{' '}
                          {check.afterStatus
                            ? (statuses[check.afterStatus] ?? check.afterStatus)
                            : 'нет проверки'}
                        </small>
                        {check.afterDetail}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div className="changes-group">
            <h3>Новые документы</h3>
            {data.documents.added.length ? (
              <ul className="changes-documents">
                {data.documents.added.map((document) => (
                  <li key={document.id}>
                    <a href={document.downloadUrl}>{document.name}</a>
                    <span>
                      {date(document.createdAt)} · {num(document.size)} байт
                      {document.ocr ? ' · распознанный текст, проверен пользователем' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="changes-note">
                Добавленные после исходного пакета документы не определены.
              </p>
            )}
            {!!data.documents.uncertain.length && (
              <details>
                <summary>Нельзя точно отнести к периоду: {data.documents.uncertain.length}</summary>
                <ul className="changes-documents">
                  {data.documents.uncertain.map((document) => (
                    <li key={document.id}>
                      <a href={document.downloadUrl}>{document.name}</a>
                      <span>{date(document.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="changes-note">{data.documents.note}</p>
          </div>
          <div className="changes-group">
            <h3>Наблюдения по выписке</h3>
            <p className="changes-note">{data.statements.note}</p>
            {(data.statements.before || data.statements.current) && (
              <div className="changes-statement-columns">
                {(
                  [
                    ['Было', data.statements.before],
                    ['Сейчас', data.statements.current],
                  ] as const
                ).map(([label, statement]) => (
                  <div key={label}>
                    <h4>{label}</h4>
                    {statement ? (
                      <>
                        <p>
                          {statement.period}
                          <br />
                          Версия заявки {statement.applicationVersion} · {date(statement.createdAt)}
                        </p>
                        {statement.findings.length ? (
                          <ul>
                            {statement.findings.map((finding, index) => (
                              <li key={`${finding.code}-${index}`}>
                                <b>{finding.title}</b>
                                <br />
                                {finding.detail}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>Наблюдений уровня «проверить» в отчёте нет.</p>
                        )}
                      </>
                    ) : (
                      <p>Отчёт не сохранён.</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <details className="changes-limits">
            <summary>Как определены изменения</summary>
            {data.limitations.map((text) => (
              <p key={text}>{text}</p>
            ))}
            <p>
              {data.methodVersion}. Составлено {date(data.generatedAt)}.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
function value(input: number | string | boolean | null) {
  return input === null
    ? 'Нет снимка'
    : typeof input === 'boolean'
      ? input
        ? 'Да'
        : 'Нет'
      : typeof input === 'number'
        ? num(input)
        : input;
}
function date(input: string) {
  const date = new Date(input);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow',
      }).format(date)
    : 'Дата не сохранена';
}
