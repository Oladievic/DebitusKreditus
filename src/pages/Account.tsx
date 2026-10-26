import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  FileJson,
  FileText,
  Info,
  KeyRound,
  Moon,
  Plug,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  Upload,
} from '../icons';
import type {
  ApplicationInput,
  Application,
  AuditRecord,
  DocumentRecord,
  FeedItem,
  ImportPreview,
} from '../../shared/types';
import { api, download, downloadExport, money, useApi } from '../api';
import { documentLabels, normalizeSearch } from '../../shared/document-labels';
import { useAuth } from '../context';
import { Empty, ErrorState, Loading, Modal, PageHead } from '../ui';
import { FeedCard } from './Dashboard';
import { DocumentRow } from './Applications';
import { OcrWorkbench } from '../ocr/OcrWorkbench';
import { importCsvTemplate, parseImportCsv } from '../import-csv';

export function Documents() {
  const { auth } = useAuth();
  const isBank = auth.user.role === 'bank';
  const { data, error, loading, refresh } = useApi<{ documents: DocumentRecord[] }>('/documents');
  const [query, setQuery] = useState('');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} retry={refresh} />;
  const docs = data.documents.filter((d) =>
    normalizeSearch(`${d.name} ${d.category} ${documentLabels[d.category] ?? ''}`).includes(
      normalizeSearch(query),
    ),
  );
  return (
    <>
      <PageHead
        title={isBank ? 'Документы заявок' : 'Документы бизнеса'}
        subtitle={
          isBank
            ? 'Документы компаний, чьи заявки отправлены на рассмотрение.'
            : 'Выписки, отчётность и договоры ваших заявок.'
        }
      />
      {!isBank && <DocumentOcrAttach onSaved={refresh} />}
      <div className="document-banner">
        <span className="icon-tile blue">
          <FileText size={25} />
        </span>
        <div>
          <h2>Документ всегда рядом с заявкой</h2>
          <p>
            {isBank
              ? 'Открывайте документы вместе с заявкой, чтобы сопоставить сведения компании и запрос банка. До отправки заявки её файлы доступны только компании.'
              : 'Добавляйте файлы в нужной заявке — так банк получит их в правильном контексте.'}
          </p>
        </div>
        <Link className="button secondary" to={isBank ? '/bank' : '/applications'}>
          {isBank ? 'К банковской очереди' : 'К заявкам'}
          <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="list-toolbar">
        <span className="muted">Всего документов: {data.documents.length}</span>
        <div className="small-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Название документа"
            aria-label="Поиск документов"
          />
        </div>
      </div>
      <section className="surface documents-list">
        {docs.length ? (
          docs.map((d) => (
            <div className="document-with-link" key={d.id}>
              <DocumentRow doc={d} />
              <Link to={`/applications/${d.applicationId}`} className="text-link">
                Заявка
                <ArrowUpRight size={14} />
              </Link>
            </div>
          ))
        ) : (
          <Empty
            title={query ? 'По запросу ничего не найдено' : 'Документов пока нет'}
            text={
              query
                ? 'Попробуйте название или категорию: выписка, отчётность, договор.'
                : 'Откройте заявку и добавьте файл или распознанный документ в соответствующий раздел.'
            }
          />
        )}
      </section>
      <Link className="text-link" to="/legal">
        Данные и условия использования
      </Link>
    </>
  );
}

function DocumentOcrAttach({ onSaved }: { onSaved: () => Promise<void> }) {
  const { data, loading, error, refresh } = useApi<{ applications: Application[] }>(
    '/applications',
  );
  const [selectedId, setSelectedId] = useState('');
  const editable =
    data?.applications.filter((application) =>
      ['draft', 'needs_info'].includes(application.status),
    ) ?? [];
  const selected = editable.find((application) => application.id === selectedId) ?? editable[0];
  return (
    <>
      <section className="surface ocr-attach">
        <div>
          <h2>Из документа — в заявку</h2>
          <p className="muted">
            Распознайте PDF или снимок на устройстве, проверьте текст и сохраните в выбранную
            заявку.
          </p>
        </div>
        {loading ? (
          <p role="status">Загружаем доступные заявки…</p>
        ) : error ? (
          <ErrorState message={error} retry={refresh} />
        ) : selected ? (
          <>
            <label>
              Куда добавить текст
              <select
                aria-label="Заявка для распознанного документа"
                value={selected.id}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {editable.map((application) => (
                  <option key={application.id} value={application.id}>
                    {application.number} · {application.purpose}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <OcrWorkbench
                key={selected.id}
                applicationId={selected.id}
                version={selected.version}
                onSaved={async () => {
                  await refresh();
                  await onSaved();
                }}
              />
            </div>
          </>
        ) : (
          <Link to="/applications/new" className="button secondary">
            Создать черновик для документа
            <ArrowRight size={17} />
          </Link>
        )}
      </section>
      <div className="data-shortcuts">
        <Link to="/integrations" className="text-link">
          Импорт и экспорт заявок: JSON / CSV
          <ArrowUpRight size={16} />
        </Link>
        <Link to="/applications" className="text-link">
          Обычная загрузка оригиналов в заявке
          <ArrowRight size={16} />
        </Link>
      </div>
    </>
  );
}

export function Feed() {
  const { auth } = useAuth();
  const { data, error, loading, refresh } = useApi<{ items: FeedItem[] }>('/feed');
  const [filter, setFilter] = useState('Все');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} retry={refresh} />;
  const categories = ['Все', ...new Set(data.items.map((i) => i.category))];
  const validFilter = categories.includes(filter) ? filter : 'Все';
  const isBank = auth.user.role === 'bank';
  return (
    <>
      <PageHead
        title={isBank ? 'Лента кредитного аналитика' : 'Для вашего бизнеса'}
        subtitle={
          isBank
            ? 'Очередь, запросы документов и правила проверки.'
            : 'События, подсказки и материалы, подходящие вашей ситуации.'
        }
        action={
          <Link to={isBank ? '/bank' : '/settings'} className="button secondary">
            <SlidersHorizontal size={17} />
            {isBank ? 'К банковской очереди' : 'Настроить интересы'}
          </Link>
        }
      />
      <div className="feed-explanation">
        <span className="icon-tile mint">
          <BookOpen size={24} />
        </span>
        <div>
          <h2>Лента с понятной причиной</h2>
          <p>
            {isBank
              ? 'Она показывает заявки, которым требуется внимание банка, и объясняет правила проверки. У каждой публикации указана причина появления.'
              : 'Она учитывает отрасль, ваши интересы и этапы заявок. У каждой публикации есть объяснение, почему вы её видите.'}
          </p>
        </div>
      </div>
      <div className="tabs feed-tabs">
        {categories.map((c) => (
          <button
            key={c}
            className={c === validFilter ? 'active' : ''}
            onClick={() => setFilter(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="feed-grid full-feed">
        {data.items
          .filter((i) => validFilter === 'Все' || i.category === validFilter)
          .map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
      </div>
    </>
  );
}

export function Settings() {
  const {
    auth,
    preferences,
    updatePreferences,
    persistenceStatus,
    preferencesError,
    retryPreferences,
  } = useAuth();
  function toggle(key: 'widgets' | 'interests', value: string) {
    updatePreferences({
      [key]: preferences[key].includes(value)
        ? preferences[key].filter((v) => v !== value)
        : [...preferences[key], value],
    });
  }
  return (
    <>
      <PageHead
        title="Ваш кабинет, ваши правила"
        subtitle="Настройте внешний вид, плотность и полезные разделы."
        action={
          <div
            className={`preferences-status is-${persistenceStatus}`}
            role="status"
            aria-live="polite"
          >
            {persistenceStatus === 'saving'
              ? 'Сохраняем настройки…'
              : persistenceStatus === 'error'
                ? 'Настройки не сохранены'
                : 'Настройки сохранены автоматически'}
          </div>
        }
      />
      {preferencesError && (
        <p role="alert" className="inline-alert">
          {preferencesError}{' '}
          <button className="text-button" onClick={retryPreferences}>
            Повторить сохранение
          </button>
        </p>
      )}
      <p className="section-description">
        Изменения применяются сразу и сохраняются автоматически. Можно переходить между разделами.
      </p>
      <div className="settings-grid">
        <section className="surface settings-section">
          <h2>Профиль</h2>
          <div className="profile-summary">
            <span className="avatar large">{auth.user.name[0]}</span>
            <div>
              <h3>{auth.user.name}</h3>
              <p>{auth.user.email}</p>
              <span className="badge blue">
                {auth.user.role === 'admin'
                  ? 'Администратор сервиса'
                  : auth.user.role === 'bank'
                    ? 'Кредитный аналитик'
                    : 'Представитель бизнеса'}
              </span>
            </div>
          </div>
          {auth.organization && (
            <dl className="detail-data">
              <div>
                <dt>Компания</dt>
                <dd>{auth.organization.name}</dd>
              </div>
              <div>
                <dt>Деятельность</dt>
                <dd>{auth.organization.industry}</dd>
              </div>
              <div>
                <dt>Город</dt>
                <dd>{auth.organization.city}</dd>
              </div>
              <div>
                <dt>ИНН</dt>
                <dd>{auth.organization.inn}</dd>
              </div>
            </dl>
          )}
          {auth.user.role === 'client' && (
            <p className="small muted">Финансовые сведения уточняются в конкретной заявке.</p>
          )}
        </section>
        <section className="surface settings-section">
          <h2>Внешний вид</h2>
          <div className="theme-options">
            {(
              [
                ['light', 'Светлая', Sun],
                ['dark', 'Тёмная', Moon],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                className={`theme-option ${id} ${preferences.theme === id ? 'selected' : ''}`}
                aria-pressed={preferences.theme === id}
                onClick={() => updatePreferences({ theme: id })}
              >
                <span className="theme-preview">
                  <i />
                  <span>
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span>
                  <Icon size={17} />
                  {label}
                  {preferences.theme === id && <Check size={16} />}
                </span>
              </button>
            ))}
          </div>
          <label>Акцент</label>
          <div className="accent-options">
            {(
              [
                ['red', 'Красный'],
                ['violet', 'Ирисовый'],
                ['mint', 'Зелёный'],
                ['amber', 'Янтарный'],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                className={`accent-option ${id} ${preferences.accent === id ? 'selected' : ''}`}
                aria-pressed={preferences.accent === id}
                onClick={() => updatePreferences({ accent: id })}
              >
                <i />
                {text}
                {preferences.accent === id && <Check size={14} />}
              </button>
            ))}
          </div>
          <label>
            Плотность интерфейса
            <select
              aria-label="Плотность интерфейса"
              value={preferences.density}
              onChange={(e) =>
                updatePreferences({ density: e.target.value as typeof preferences.density })
              }
            >
              <option value="comfortable">Комфортная — больше пространства</option>
              <option value="compact">Компактная — больше информации</option>
            </select>
          </label>
          <label className="switch-row">
            <span>
              <b>Минимум анимации</b>
              <small>Уменьшить движение элементов</small>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={preferences.reducedMotion}
              onChange={(e) => updatePreferences({ reducedMotion: e.target.checked })}
            />
          </label>
        </section>
        {auth.user.role === 'client' && (
          <>
            <section className="surface settings-section">
              <h2>Состав обзора</h2>
              <p className="section-description">
                Дополнительные блоки можно скрыть. Заявки и необходимые действия всегда остаются
                доступны.
              </p>
              {[
                ['feed', 'Персональная лента', 'Подборка материалов для вашего бизнеса'],
                ['simulator', 'Подсказка о репетиции', 'Быстрый переход к расчёту нагрузки'],
              ].map(([key, text, desc]) => (
                <label className="switch-row" key={key}>
                  <span>
                    <b>{text}</b>
                    <small>{desc}</small>
                  </span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={preferences.widgets.includes(key)}
                    onChange={() => toggle('widgets', key)}
                  />
                </label>
              ))}
            </section>
            <section className="surface settings-section">
              <h2>Интересы бизнеса</h2>
              <p className="section-description">
                Выбор влияет на публикации в персональной ленте.
              </p>
              {[
                ['growth', 'Развитие и оборудование'],
                ['cashflow', 'Оборотные средства и денежный поток'],
                ['risk', 'Риски и финансовая устойчивость'],
              ].map(([key, label]) => (
                <label className="checkbox-label interest-option" key={key}>
                  <input
                    type="checkbox"
                    checked={preferences.interests.includes(key)}
                    onChange={() => toggle('interests', key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
              <Link className="text-link" to="/feed">
                Посмотреть ленту
                <ArrowUpRight size={16} />
              </Link>
            </section>
          </>
        )}
        {auth.user.role === 'bank' && (
          <section className="surface settings-section">
            <h2>Рабочее место банка</h2>
            <p>
              Очередь, проверки и решения доступны в банковском разделе. Настройки внешнего вида
              применяются к вашей учётной записи; клиентские виджеты и интересы здесь не
              используются.
            </p>
            <Link className="text-link" to="/bank">
              Перейти к очереди
              <ArrowRight size={16} />
            </Link>
          </section>
        )}
      </div>
    </>
  );
}

type TokenRow = {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};
export function Integrations() {
  const { auth, toast } = useAuth();
  const [tab, setTab] = useState('data');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [imported, setImported] = useState<Application[]>([]);
  const [token, setToken] = useState('');
  const [tokenName, setTokenName] = useState('Мой ИИ-агент');
  const [tokenList, setTokenList] = useState<TokenRow[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  async function loadTokens() {
    try {
      setTokenList((await api<{ tokens: TokenRow[] }>('/integrations/tokens')).tokens);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function chooseTab(next: string) {
    setTab(next);
    setError('');
    if (next === 'agents' && auth.user.role === 'client') await loadTokens();
    if (next === 'audit') {
      setAuditLoading(true);
      try {
        setAudit((await api<{ events: AuditRecord[] }>('/audit')).events);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setAuditLoading(false);
      }
    }
  }
  async function importFile(file: File) {
    setError('');
    setBusy(true);
    try {
      if (file.size > 512000) throw new Error('Файл должен быть меньше 500 КБ.');
      const content = await file.text();
      const parsed = file.name.toLowerCase().endsWith('.csv')
        ? parseImportCsv(content)
        : JSON.parse(content);
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        (!Array.isArray(parsed) && !Array.isArray(parsed.applications))
      )
        throw new Error(
          'Файл должен содержать массив заявок или объект с массивом applications. Скачайте шаблон для примера.',
        );
      setPreview(
        await api<ImportPreview>('/import/validate', {
          method: 'POST',
          body: JSON.stringify({
            applications: Array.isArray(parsed) ? parsed : parsed.applications,
          }),
        }),
      );
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? 'Файл должен содержать корректный JSON. Скачайте шаблон и попробуйте снова.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  const template: { applications: ApplicationInput[] } = {
    applications: [
      {
        productId: 'working_capital',
        amount: 1200000,
        termMonths: 24,
        purpose: 'Закупка материалов для нового заказа',
        financials: {
          monthlyRevenue: 2400000,
          monthlyExpenses: 1650000,
          monthlyDebtPayment: 120000,
        },
        consent: true,
      },
    ],
  };
  async function exportFile(format: 'json' | 'csv') {
    setBusy(true);
    setError('');
    try {
      await downloadExport(format);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        title="Данные и интеграции"
        subtitle="Ваши сведения остаются доступными вам — в кабинете, файле и через API."
      />
      <div className="tabs integration-tabs">
        {[
          ['data', 'Импорт и экспорт'],
          ['agents', 'API и ИИ-агенты'],
          ['audit', 'Журнал действий'],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? 'active' : ''}
            onClick={() => void chooseTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && !preview && (
        <p role="alert" className="inline-alert">
          {error}
        </p>
      )}
      {tab === 'data' && (
        <div className="integration-grid">
          {auth.user.role === 'client' && (
            <section className="surface integration-card">
              <span className="icon-tile blue">
                <ArrowDownToLine size={25} />
              </span>
              <h2>Забрать свои данные</h2>
              <p>
                Скачайте заявки в JSON для переноса или CSV для работы в таблице. Доступ ограничен
                вашей ролью.
              </p>
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void exportFile('json')}
                >
                  <FileJson size={17} />
                  Скачать JSON
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void exportFile('csv')}
                >
                  Скачать CSV
                </button>
              </div>
            </section>
          )}
          {auth.user.role === 'client' && (
            <section className="surface integration-card">
              <span className="icon-tile mint">
                <Upload size={25} />
              </span>
              <h2>Загрузить черновики</h2>
              <p>
                Сначала проверим JSON или CSV по шаблону и покажем до 20 новых черновиков. Отправка
                в банк происходит отдельно.
              </p>
              <label className={`button secondary file-button ${busy ? 'disabled' : ''}`}>
                <Upload size={17} />
                {busy ? 'Проверяем…' : 'Выбрать JSON или CSV'}
                <input
                  type="file"
                  accept="application/json,text/csv,.json,.csv"
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.files?.[0]) void importFile(e.target.files[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                className="text-button"
                onClick={() =>
                  download(
                    'debitus-import-template.csv',
                    importCsvTemplate(),
                    'text/csv;charset=utf-8',
                  )
                }
              >
                Скачать CSV-шаблон
                <ArrowDownToLine size={15} />
              </button>
              <button
                className="text-button"
                onClick={() =>
                  download('debitus-import-template.json', JSON.stringify(template, null, 2))
                }
              >
                Скачать шаблон
                <ArrowDownToLine size={15} />
              </button>
            </section>
          )}
          <div className="integration-tip">
            <ShieldCheck size={23} />
            <div>
              <h3>Проверка до сохранения</h3>
              <p>
                Импорт создаёт только черновики. Он не меняет существующие решения и не запускает
                выдачу.
              </p>
            </div>
          </div>
        </div>
      )}
      {tab === 'agents' && (
        <>
          <section className="api-hero">
            <span className="icon-tile white">
              <Plug size={27} />
            </span>
            <div>
              <h2>Кабинет открыт для ваших инструментов</h2>
              <p>
                API и MCP дают агентам доступ к вашим заявкам и расчётам. Подключение ограничено
                чтением и репетицией условий.
              </p>
            </div>
            <a className="button white" target="_blank" rel="noreferrer" href="/api/openapi.json">
              Описание API
              <ArrowUpRight size={17} />
            </a>
          </section>
          <div className="integration-grid">
            <section className="surface integration-card">
              <h2>Подключение по MCP</h2>
              <p>
                Выберите в клиенте транспорт Streamable HTTP и добавьте адрес ниже. Создайте личный
                токен и сохраните его в секретах клиента как заголовок Authorization.
              </p>
              <label>
                Адрес сервера<code className="code-block">{location.origin}/api/mcp</code>
              </label>
              <label>
                Авторизация
                <code className="code-block">Authorization: Bearer &lt;ваш токен&gt;</code>
              </label>
              <p className="small muted">
                Доступны профиль бизнеса, заявки, персональный подбор, разбор задачи, сохранённый
                анализ выписки, план действий, варианты кредита, сравнение версий для банка, график
                обслуживания, расчёт платежа и денежного потока. MCP 2025-11-25 и 2025-03-26, ответы
                JSON. Клиент должен поддерживать собственный Bearer токен; OAuth-вход и SSE не
                используются. Подключение не запускает модель.
              </p>
            </section>
            <section className="surface integration-card">
              <h2>Личный токен</h2>
              {auth.user.role === 'client' ? (
                <>
                  <p>Действует 7 дней. Показывается один раз, можно отозвать в любой момент.</p>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      setError('');
                      try {
                        const r = await api<{ token: string }>('/integrations/tokens', {
                          method: 'POST',
                          body: JSON.stringify({ name: tokenName }),
                        });
                        setToken(r.token);
                        await loadTokens();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <label>
                      Название подключения
                      <input
                        value={tokenName}
                        onChange={(e) => setTokenName(e.target.value)}
                        required
                        maxLength={80}
                      />
                    </label>
                    <button className="button primary" disabled={busy}>
                      <KeyRound size={17} />
                      Создать токен
                    </button>
                  </form>
                </>
              ) : (
                <p>
                  Токены доступны предпринимателям для подключения инструментов своей организации.
                  Банковские решения принимаются в рабочем месте банка.
                </p>
              )}
            </section>
          </div>
          {tokenList.length > 0 && (
            <section className="surface token-list">
              <h2>Подключения</h2>
              {tokenList.map((t) => (
                <div className="token-row" key={t.id}>
                  <KeyRound size={20} />
                  <div>
                    <b>{t.name}</b>
                    <span>
                      {t.revokedAt
                        ? 'Отозван'
                        : `До ${new Date(t.expiresAt).toLocaleString('ru-RU')}`}
                    </span>
                  </div>
                  {!t.revokedAt && (
                    <button
                      className="button small danger"
                      onClick={async () => {
                        try {
                          await api(`/integrations/tokens/${t.id}`, { method: 'DELETE' });
                          await loadTokens();
                          toast('Токен отозван');
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 size={15} />
                      Отозвать
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          <div className="help-strip">
            <Info size={21} />
            <p>
              Денежные расчёты и кредитные решения выполняются по проверяемым правилам. При
              локальном запуске можно подключить помощника с открытыми весами: он объясняет данные,
              а не принимает решения. В облачной версии локальная модель недоступна. Банковские API
              заменены симуляторами.
            </p>
            {auth.user.role === 'client' && (
              <Link className="text-link" to="/assistant">
                Локальный помощник
                <ArrowRight size={17} />
              </Link>
            )}
          </div>
        </>
      )}
      {tab === 'data' && imported.length > 0 && (
        <section className="surface integration-card">
          <h2>Черновики созданы</h2>
          <p>
            Импорт завершён. Откройте заявку, проверьте данные и добавьте документы перед отправкой.
          </p>
          {imported.map((application) => (
            <Link
              key={application.id}
              className="notification-item"
              to={`/applications/${application.id}`}
            >
              <span>
                <b>{application.number}</b>
                <small>
                  {application.purpose} · {money(application.amount)}
                </small>
              </span>
              <ArrowUpRight size={16} />
            </Link>
          ))}
        </section>
      )}
      {tab === 'audit' && (
        <section className="surface audit-list">
          <h2>История операций</h2>
          <p className="section-description">
            Последние 200 изменений заявок, подключений и данных в рамках вашей роли.
          </p>
          {auditLoading ? (
            <Loading />
          ) : audit?.length ? (
            audit.map((e) => (
              <article className="audit-row" key={e.id}>
                <span className="icon-tile blue">
                  <FileText size={18} />
                </span>
                <div>
                  <b>{e.actorName}</b>
                  <p>{e.detail}</p>
                  <span>{new Date(e.createdAt).toLocaleString('ru-RU')}</span>
                </div>
                {e.applicationId && (
                  <Link
                    to={`/applications/${e.applicationId}`}
                    className="icon-button"
                    aria-label="Открыть заявку"
                  >
                    <ArrowUpRight size={17} />
                  </Link>
                )}
              </article>
            ))
          ) : (
            <p className="muted">Записей пока нет.</p>
          )}
        </section>
      )}
      {token && (
        <Modal title="Токен подключения" close={() => setToken('')}>
          <p>Скопируйте сейчас. После закрытия токен больше не будет показан.</p>
          <code className="code-block token-value">{token}</code>
          <button
            className="button primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(token);
                toast('Токен скопирован');
              } catch {
                toast('Выделите токен и скопируйте вручную');
              }
            }}
          >
            <Copy size={17} />
            Скопировать
          </button>
          <p className="small muted">
            Не добавляйте токен в исходники и переписки. Он даёт доступ к данным вашей компании.
          </p>
        </Modal>
      )}
      {preview && (
        <Modal
          title="Проверка импорта"
          close={() => {
            if (!busy) setPreview(null);
          }}
        >
          {error && (
            <p role="alert" className="inline-alert">
              {error}
            </p>
          )}
          {preview.valid ? (
            <>
              <p>
                Будет создано черновиков: <b>{preview.count}</b>. Они не будут отправлены в банк
                автоматически.
              </p>
              <div className="import-preview">
                {preview.rows.map((r, i) => (
                  <div key={i}>
                    <b>{r.purpose}</b>
                    <span>
                      {money(r.amount)} · {r.termMonths} мес.
                    </span>
                    <span>
                      {(
                        {
                          working_capital: 'Оборотный капитал',
                          equipment: 'Оборудование',
                          credit_line: 'Кредитная линия',
                        } as Record<string, string>
                      )[r.productId] ?? r.productId}
                    </span>
                    <span>
                      Выручка {money(r.financials.monthlyRevenue)} / расходы{' '}
                      {money(r.financials.monthlyExpenses)} / текущие платежи{' '}
                      {money(r.financials.monthlyDebtPayment)}
                    </span>
                    <span>
                      {r.consent
                        ? 'Режим работы подтверждён'
                        : 'Режим работы потребуется подтвердить перед отправкой'}
                    </span>
                  </div>
                ))}
              </div>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const result = await api<{ applications: Application[] }>('/import/apply', {
                      method: 'POST',
                      body: JSON.stringify({ previewId: preview.previewId }),
                    });
                    setPreview(null);
                    setImported(result.applications);
                    toast(`Импортировано заявок: ${result.applications.length}`);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Создать черновики
                <ArrowRight size={17} />
              </button>
            </>
          ) : (
            <>
              <p>Исправьте ошибки в файле и загрузите его повторно.</p>
              {preview.errors.map((e, i) => (
                <p className="field-error" key={i}>
                  Строка {e.row}, {e.field}: {e.message}
                </p>
              ))}
            </>
          )}
        </Modal>
      )}
    </>
  );
}

const legalSections = [
  {
    id: 'about',
    title: 'Правила демонстрации',
    body: [
      'Debitus-Kreditus — учебный веб-прототип кредитного конвейера. Сервис не является банком, не оказывает финансовые услуги и не предлагает заключить реальный кредитный договор.',
      'Все компании, сотрудники, документы, заявки и финансовые показатели в демонстрационном наборе вымышлены. Проверки ФНС и БКИ выполняются локальными симуляторами. Подписание и выдача средств имитируются: действия не заключают реальный кредитный договор и не выполняют перевод денег.',
      'Используйте только синтетические данные. Не вводите сведения о реальных клиентах, не загружайте настоящие выписки и персональные документы. Учебные аккаунты имеют общедоступные пароли; не используйте их для конфиденциальных сведений.',
      'Авторизация, заявки, документы и история действий сохраняются в хранилище демонстрации. Сценарий полностью проходит внутри кабинета и не требует звонков, SMS, электронной почты или платежей.',
    ],
  },
  {
    id: 'privacy',
    title: 'Данные и конфиденциальность',
    body: [
      'Для работы демонстрации сохраняются выбранный учебный пользователь, сведения о синтетической компании, заявки, загруженные тестовые файлы, настройки интерфейса и журнал операций. Пароли хранятся в виде производных значений, токены — в виде хешей.',
      'Локальный запуск хранит данные в SQLite на вашем компьютере или в Docker volume. Облачная демонстрация использует отдельное хранилище провайдера. Это не инфраструктура для обработки реальных персональных данных российских клиентов.',
      'API проверяет роль и принадлежность организации при чтении заявок и файлов. Учебный аналитик видит банковскую очередь. Личные API-токены ограничены чтением и расчётами и могут быть отозваны.',
      'Распознавание PDF и снимков выполняется в браузере на CPU. Модуль и языковые файлы загружаются с этого сайта; исходник не отправляется внешним сервисам распознавания. После явной проверки сохраняются исправленный текст, имя и хеш источника, число страниц, автор и время подтверждения. Оригинал отдельно не сохраняется, пока пользователь не загрузит его обычным способом. Распознавание не подтверждает подлинность документа.',
      'Необязательный ИИ-помощник доступен только при локальном запуске с настроенной моделью с открытыми весами. Он использует локальное соединение и не отправляет сведения в облачный inference API. Ответ модели не заменяет детерминированный расчёт или решение кредитного конвейера.',
      'Это информационное описание демо-режима. Политика для реального сервиса должна указывать настоящего оператора, реквизиты, контакты, цели, основания, сроки хранения, порядок обращений, обработчиков и фактическую географию данных. Эти сведения ещё не определены.',
    ],
  },
  {
    id: 'cookies',
    title: 'Cookie и настройки',
    body: [
      'Для входа используется технический cookie dk_session со сроком 12 часов. Он позволяет серверу связать запросы с выбранным учебным пользователем. Cookie недоступен JavaScript страницы; при HTTPS передаётся только по защищённому соединению. При выходе сессия прекращается.',
      'Рекламные и аналитические cookies в прототипе не используются. Шрифты и интерфейсные ресурсы включены в сборку и не требуют загрузки с внешних рекламных или шрифтовых сервисов.',
      'Тема, плотность и интересы сохраняются в профиле пользователя. Языковые файлы OCR могут кэшироваться в IndexedDB браузера; распознанный текст там не сохраняется. Удаление cookies браузера может завершить сессию, но не удаляет заявки из серверного хранилища.',
      'В облаке провайдер размещения может обрабатывать технические данные соединения по своим условиям. Производственный перечень обработчиков и сроков хранения требует отдельного согласования.',
    ],
  },
  {
    id: 'consent',
    title: 'Подтверждения и запуск',
    body: [
      'Галочка при создании заявки подтверждает понимание учебного режима и использование вымышленных сведений. Она не подменяет согласие на обработку персональных данных реального клиента.',
      'Подтверждение демо-договора не является простой или усиленной электронной подписью. Кнопка условной выдачи не инициирует перевод денег.',
      'До реального запуска нужны реквизиты оператора и проверка применимости законодательства. Проекты политики, пользовательского соглашения, отдельных согласий, cookie-информации и карты хранения подготовлены в документации репозитория и требуют заполнения и юридической проверки.',
      'Рекламные размещения, платные функции, банковские интеграции и внешние LLM в этом прототипе не включены.',
    ],
  },
];
export function Legal() {
  const [section, setSection] = useState('about');
  const selected = legalSections.find((s) => s.id === section)!;
  return (
    <>
      <PageHead
        title="О сервисе и документах"
        subtitle="Как устроена демонстрация и что происходит с данными."
      />
      <div className="legal-layout">
        <nav className="legal-nav" aria-label="Юридическая информация">
          {legalSections.map((s) => (
            <button
              className={s.id === section ? 'active' : ''}
              onClick={() => setSection(s.id)}
              key={s.id}
            >
              {s.title}
              <ArrowUpRight size={16} />
            </button>
          ))}
        </nav>
        <article className="surface legal-content">
          <span className="badge amber">Демо-режим</span>
          <h2>{selected.title}</h2>
          {selected.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <p>
            <a
              className="text-link"
              href="/THIRD_PARTY_NOTICES.txt"
              target="_blank"
              rel="noreferrer"
            >
              Компоненты, лицензии и источники
              <ArrowUpRight size={16} />
            </a>
          </p>
          <div className="legal-version">
            <ShieldCheck size={18} />
            <span>Версия от 19 октября 2026 года. Для синтетической демонстрации.</span>
          </div>
        </article>
      </div>
    </>
  );
}
