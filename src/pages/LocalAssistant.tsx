import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Application, ApplicationDetail } from '../../shared/types';
import type { LocalAIExplanation, LocalAIStatus, LocalAITopic } from '../../shared/local-ai';
import { api, money, useApi } from '../api';
import { useAuth } from '../context';
import { ArrowRight, CircleHelp, RefreshCw, ShieldCheck, Sparkles, X } from '../icons';
import { Empty, ErrorState, Loading, PageHead, Status, statuses } from '../ui';
import '../local-ai-v5.css';

const topics: { id: LocalAITopic; title: string; description: string }[] = [
  {
    id: 'overview',
    title: 'Что влияет на оценку',
    description: 'Этап заявки и причины результата',
  },
  { id: 'payment', title: 'Как читать условия', description: 'Сумма, срок и платёж из расчёта' },
  {
    id: 'documents',
    title: 'Какие сведения нужны',
    description: 'Загруженные и запрошенные документы',
  },
];
const stateNames: Record<LocalAIStatus['state'], string> = {
  ready: 'Модель готова',
  disabled: 'Помощник выключен',
  cloud: 'Доступен при локальном запуске',
  offline: 'Нет связи с Ollama',
  no_model: 'Модель не установлена',
  unsupported_model: 'Нужна совместимая модель',
  low_memory: 'Недостаточно свободной памяти',
  busy: 'Модель занята',
  config_error: 'Проверьте настройки запуска',
};

export function LocalAssistant() {
  const { auth } = useAuth();
  const runtime = useApi<LocalAIStatus>('/local-ai/status');
  return (
    <div className="local-assistant">
      <PageHead
        title="Разобраться в заявке"
        subtitle="Короткий разбор заявки и главные факторы из проверенного расчёта."
      />
      <section className="assistant-runtime" aria-labelledby="assistant-runtime-title">
        <span className="assistant-runtime-icon">
          <ShieldCheck size={25} />
        </span>
        <div>
          <h2 id="assistant-runtime-title">
            {runtime.data ? stateNames[runtime.data.state] : 'Проверяем локальный помощник'}
          </h2>
          <p role="status">
            {runtime.error || runtime.data?.message || 'Проверка не загружает модель в память.'}
          </p>
          {runtime.data?.model && (
            <span className="assistant-model">
              {runtime.data.model} · CPU · только на вашем компьютере
            </span>
          )}
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={runtime.loading}
          onClick={() => void runtime.refresh()}
        >
          <RefreshCw size={16} />
          Проверить
        </button>
      </section>
      {auth.user.role !== 'admin' && (
        <AssistantWorkspace runtime={runtime.data} refreshRuntime={runtime.refresh} />
      )}
      <details className="assistant-setup">
        <summary>Как подключить на своём компьютере</summary>
        <p>
          Помощник работает через установленную Ollama. Запустите кабинет локально, подготовьте
          модель Qwen3 и включите LOCAL_AI_ENABLED в файле .env. Настройка адреса доступна только в
          конфигурации запуска.
        </p>
        <p>
          В локальной папке проекта есть подробная инструкция docs/local-ai.md. Кабинет не скачивает
          модели, не отправляет данные в облачный ИИ и не выполняет действия по ответу модели.
        </p>
        <p>
          При 8 ГБ общей памяти начните с qwen3:0.6b. Для qwen3:1.7b проверка требует 4 ГиБ
          свободной памяти перед запросом. Скорость и качество зависят от компьютера; все расчёты
          доступны и без модели.
        </p>
      </details>
    </div>
  );
}

function AssistantWorkspace({
  runtime,
  refreshRuntime,
}: {
  runtime: LocalAIStatus | null;
  refreshRuntime: () => Promise<void>;
}) {
  const list = useApi<{ applications: Application[] }>('/applications');
  const [selected, setSelected] = useState('');
  const applications = list.data?.applications ?? [];
  const selectedId = applications.some((a) => a.id === selected)
    ? selected
    : (applications[0]?.id ?? '');
  if (list.loading) return <Loading />;
  if (list.error) return <ErrorState message={list.error} retry={list.refresh} />;
  if (!selectedId)
    return (
      <Empty
        title="Пока нечего объяснять"
        text="Помощник работает с сохранёнными заявками. Сначала рассчитайте условия и создайте заявку."
        action={
          <Link className="button primary" to="/applications">
            К заявкам
            <ArrowRight size={17} />
          </Link>
        }
      />
    );
  return (
    <>
      <label className="assistant-application-picker">
        Заявка для разбора
        <select value={selectedId} onChange={(event) => setSelected(event.target.value)}>
          {applications.map((application) => (
            <option key={application.id} value={application.id}>
              {application.number} · {application.organizationName} · {money(application.amount)}
            </option>
          ))}
        </select>
      </label>
      <ApplicationExplanation
        key={selectedId}
        applicationId={selectedId}
        runtime={runtime}
        refreshRuntime={refreshRuntime}
      />
    </>
  );
}

function ApplicationExplanation({
  applicationId,
  runtime,
  refreshRuntime,
}: {
  applicationId: string;
  runtime: LocalAIStatus | null;
  refreshRuntime: () => Promise<void>;
}) {
  const facts = useApi<ApplicationDetail>(`/applications/${applicationId}`);
  const [topic, setTopic] = useState<LocalAITopic>('overview');
  const [response, setResponse] = useState<LocalAIExplanation | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);
  const lastVersion = useRef<string | undefined>(undefined);
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const version = facts.data
      ? `${facts.data.application.version}:${facts.data.organization.profile?.version ?? 1}`
      : undefined;
    if (
      version !== undefined &&
      lastVersion.current !== undefined &&
      lastVersion.current !== version
    ) {
      request.current?.abort();
      request.current = null;
      setPending(false);
      setResponse(null);
      setError('');
      setNotice('Заявка или профиль обновились. Создайте объяснение по актуальным данным.');
    }
    lastVersion.current = version;
  }, [facts.data?.application.version, facts.data?.organization.profile?.version]);
  const explain = async () => {
    if (!facts.data || pending) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError('');
    setNotice('');
    setResponse(null);
    try {
      const result = await api<LocalAIExplanation>('/local-ai/explain', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          applicationId,
          version: facts.data.application.version,
          profileVersion: facts.data.organization.profile?.version ?? 1,
          topic,
        }),
      });
      if (request.current === controller) setResponse(result);
    } catch (e) {
      if (request.current === controller && !controller.signal.aborted) {
        setError((e as Error).message);
        void facts.refresh();
        void refreshRuntime();
      }
    } finally {
      if (request.current === controller) {
        setPending(false);
        request.current = null;
      }
    }
  };
  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setPending(false);
    setNotice('Объяснение отменено. Данные заявки не изменились.');
  };
  if (facts.loading) return <Loading />;
  if (facts.error || !facts.data)
    return <ErrorState message={facts.error || 'Заявка недоступна.'} retry={facts.refresh} />;
  const { application, assessment } = facts.data;
  const decision = application.decision ?? assessment.decision;
  const visibleResponse =
    response?.applicationVersion === application.version &&
    response.profileVersion === (facts.data.organization.profile?.version ?? 1)
      ? response
      : null;
  return (
    <div className="assistant-workspace">
      <section className="assistant-facts" aria-labelledby="assistant-facts-title">
        <div className="assistant-section-label">Исходные данные</div>
        <h2 id="assistant-facts-title">{application.number}</h2>
        <Status status={application.status} />
        <dl>
          <div>
            <dt>Запрошено</dt>
            <dd>{money(application.amount)}</dd>
          </div>
          <div>
            <dt>Срок</dt>
            <dd>{application.termMonths} мес.</dd>
          </div>
          <div>
            <dt>Расчётная оценка</dt>
            <dd>{assessment.score.value} / 100</dd>
          </div>
          {decision.offer && (
            <div>
              <dt>Платёж по условиям</dt>
              <dd>{money(decision.offer.monthlyPayment)}</dd>
            </div>
          )}
        </dl>
        <p>
          Эти значения рассчитаны правилами кабинета. Модель выбирает важные пункты из готовых
          фактов, без содержимого файлов и реквизитов организации.
        </p>
        <Link className="button secondary" to={`/applications/${applicationId}`}>
          Открыть полный расчёт
          <ArrowRight size={17} />
        </Link>
      </section>
      <section className="assistant-conversation" aria-labelledby="assistant-explanation-title">
        <div className="assistant-section-label">Локальное объяснение</div>
        <h2 id="assistant-explanation-title">На чём сосредоточиться</h2>
        <fieldset className="assistant-topics" disabled={pending}>
          <legend className="sr-only">Тема объяснения</legend>
          {topics.map((item) => (
            <label key={item.id} className={topic === item.id ? 'selected' : ''}>
              <input
                type="radio"
                name="assistant-topic"
                value={item.id}
                checked={topic === item.id}
                onChange={() => {
                  setTopic(item.id);
                  setResponse(null);
                  setError('');
                  setNotice('');
                }}
              />
              <span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <section className="assistant-brief" aria-label="Краткий разбор по правилам">
          <h3>Коротко по данным заявки</h3>
          {topic === 'overview' && (
            <>
              <p>{statuses[application.status].next}.</p>
              <ul>
                {decision.reasons.slice(0, 3).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p>
                Оценка {assessment.score.value} из 100 описывает факторы риска в правилах кабинета,
                а не вероятность одобрения.
              </p>
            </>
          )}
          {topic === 'payment' && (
            <>
              <p>
                До нового кредита после расходов и текущих платежей остаётся{' '}
                {money(
                  application.financials.monthlyRevenue -
                    application.financials.monthlyExpenses -
                    application.financials.monthlyDebtPayment,
                )}{' '}
                в месяц.
              </p>
              {decision.offer ? (
                <p>
                  В рассчитанных условиях: {money(decision.offer.amount)} на{' '}
                  {decision.offer.termMonths} мес., платёж {money(decision.offer.monthlyPayment)}.
                  Общая сумма процентов — {money(decision.offer.totalInterest)}. Округление
                  последнего платежа видно в графике.
                </p>
              ) : (
                <p>
                  Условий кредита пока нет. Сначала устраните причины из оценки или дополните
                  документы.
                </p>
              )}
              <p>
                Проверьте слабый месяц в репетиции заявки: постоянные расходы могут сохраниться при
                снижении выручки.
              </p>
            </>
          )}
          {topic === 'documents' && (
            <>
              <p>
                В досье{' '}
                {
                  facts.data.documents.filter(
                    (document) => !['contract', 'receipt'].includes(document.category),
                  ).length
                }{' '}
                документов. Наличие файла не подтверждает достоверность его содержимого.
              </p>
              {decision.requestedDocuments.length ? (
                <p>
                  Нужно дополнить:{' '}
                  {decision.requestedDocuments
                    .map(
                      (category) =>
                        ({
                          statement: 'выписка по счёту',
                          financials: 'финансовые сведения',
                          invoice: 'счёт на оборудование',
                          other: 'дополнительные сведения',
                        })[category] ?? category,
                    )
                    .join(', ')}
                  .
                </p>
              ) : (
                <p>Дополнительных документов по текущей оценке не запрошено.</p>
              )}
              <p>
                Распознайте скан или PDF, проверьте найденные суммы и сохраните документ. Ввод чисел
                в форму подтверждается отдельно.
              </p>
            </>
          )}
          <small>
            {application.decision ? 'По сохранённому решению' : 'Предварительный разбор'} · версия
            заявки {application.version}. Этот блок работает без модели.
          </small>
        </section>
        <div className="assistant-actions">
          <button
            type="button"
            className="button primary"
            disabled={!runtime?.available || pending}
            onClick={() => void explain()}
          >
            <Sparkles size={18} />
            {pending ? 'Готовим объяснение…' : 'Объяснить по данным заявки'}
          </button>
          {pending && (
            <button type="button" className="button secondary" onClick={cancel}>
              <X size={16} />
              Отменить
            </button>
          )}
        </div>
        {pending && <p role="status">Модель работает на CPU. Запрос ограничен 90 секундами.</p>}
        {error && (
          <div className="assistant-error" role="alert">
            <CircleHelp size={20} />
            <p>{error}</p>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {visibleResponse && (
          <article
            className="assistant-answer"
            aria-label="Ответ локальной модели"
            aria-live="polite"
          >
            <div className="assistant-answer-meta">
              <span>{visibleResponse.model}</span>
              <span>
                {new Date(visibleResponse.generatedAt).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                · версия заявки {visibleResponse.applicationVersion}
              </span>
            </div>
            <p>{visibleResponse.text}</p>
            {visibleResponse.truncated && (
              <p className="assistant-truncated">
                Достигнут лимит длины ответа. Полные сведения доступны в заявке.
              </p>
            )}
          </article>
        )}
        <p className="assistant-boundary">
          Модель выбирает акценты, а цифры и формулировки берутся из проверенных данных. Полный
          разбор доступен в заявке. Помощник не принимает решения и не выполняет действий.
          Объяснение не сохраняется в истории заявки.
        </p>
      </section>
    </div>
  );
}
