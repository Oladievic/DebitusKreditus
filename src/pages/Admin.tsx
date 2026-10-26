import { useState } from 'react';
import type {
  AdminOverview,
  AdminProduct,
  AdminRegistryRow,
  AdminUserStatus,
  AuditRecord,
} from '../../shared/types';
import { api, date, money, num, useApi } from '../api';
import { useAuth } from '../context';
import { ErrorState, Loading, PageHead, Status, statuses } from '../ui';
import '../admin-v5.css';

const sections = [
  ['intake', 'Приём заявок'],
  ['registry', 'Реестр'],
  ['users', 'Пользователи'],
  ['audit', 'Журнал'],
] as const;
type Section = (typeof sections)[number][0];
const roleNames = {
  client: 'Предприниматель',
  bank: 'Кредитный специалист',
  admin: 'Администратор',
};
const eventNames: Record<string, string> = {
  intake_paused: 'Приём приостановлен',
  intake_resumed: 'Приём возобновлён',
  platform_export: 'Выгрузка платформы',
};

export default function Admin() {
  const { toast } = useAuth();
  const overview = useApi<AdminOverview>('/admin/overview');
  const products = useApi<{ products: AdminProduct[] }>('/admin/products');
  const registry = useApi<{ applications: AdminRegistryRow[] }>('/admin/registry');
  const users = useApi<{ users: AdminUserStatus[] }>('/admin/users');
  const audit = useApi<{ events: AuditRecord[]; limit: number }>('/admin/audit');
  const [section, setSection] = useState<Section>('intake');
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');

  const refresh = () =>
    Promise.all([
      overview.refresh(),
      products.refresh(),
      registry.refresh(),
      users.refresh(),
      audit.refresh(),
    ]);
  async function changeIntake() {
    if (!editing || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/admin/products/${editing.id}/intake`, {
        method: 'PATCH',
        body: JSON.stringify({
          version: editing.intake.version,
          paused: !editing.intake.paused,
          reason,
        }),
      });
      toast(
        editing.intake.paused ? 'Приём заявок возобновлён' : 'Приём новых заявок приостановлен',
      );
      setEditing(null);
      setReason('');
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
      await products.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function exportData(kind: 'registry' | 'audit', format: 'json' | 'csv') {
    if (exporting) return;
    setExporting(`${kind}-${format}`);
    setError('');
    try {
      const response = await fetch(`/api/admin/export?kind=${kind}&format=${format}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Не удалось скачать файл.');
      }
      const url = URL.createObjectURL(await response.blob()),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `debitus-platform-${kind}.${format}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Выгрузка подготовлена');
      await audit.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setExporting('');
    }
  }

  return (
    <div className="admin-workspace">
      <PageHead
        title="Платформа под контролем"
        subtitle="Приём заявок, состояние доступов и история операций."
        action={
          <button className="button secondary" onClick={() => void refresh()}>
            Обновить данные
          </button>
        }
      />
      <div className="admin-boundary">
        <span>Ваша роль</span>
        <p>
          Вы управляете приёмом заявок. Проверку компании и кредитное решение выполняет сотрудник
          банка.
        </p>
      </div>
      {overview.loading ? (
        <Loading />
      ) : overview.error ? (
        <ErrorState message={overview.error} retry={overview.refresh} />
      ) : (
        overview.data && (
          <>
            <div className="admin-metrics">
              <article>
                <span>Организации</span>
                <strong>{num(overview.data.organizations)}</strong>
                <small>{num(overview.data.users)} пользователей платформы</small>
              </article>
              <article>
                <span>Активные сессии</span>
                <strong>{num(overview.data.activeSessions)}</strong>
                <small>Срок действия ещё не истёк</small>
              </article>
              <article>
                <span>Приём на паузе</span>
                <strong>
                  {num(overview.data.pausedProducts)}
                  <i> / {products.data?.products.length ?? '—'}</i>
                </strong>
                <small>Уже отправленные заявки обрабатываются</small>
              </article>
              <article>
                <span>Выдано по договорам</span>
                <strong className="admin-money">{money(overview.data.fundedAmount, true)}</strong>
                <small>Учётная сумма завершённых сценариев</small>
              </article>
            </div>
            <div className="admin-flow" aria-label="Распределение заявок по этапам">
              {overview.data.applicationCounts.map(({ status, count }) => (
                <div key={status}>
                  <span>{statuses[status].label}</span>
                  <b>{num(count)}</b>
                </div>
              ))}
            </div>
          </>
        )
      )}
      <nav className="admin-sections" aria-label="Разделы администратора">
        {sections.map(([value, label]) => (
          <button
            key={value}
            aria-pressed={section === value}
            onClick={() => {
              setSection(value);
              setError('');
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <div className="admin-operation-error" role="alert">
          <p>{error}</p>
          <button
            className="text-link"
            onClick={() => {
              setError('');
              void refresh();
            }}
          >
            Обновить состояние
          </button>
        </div>
      )}
      {section === 'intake' && (
        <section aria-label="Управление приёмом заявок">
          <div className="admin-section-title">
            <h2>Какие продукты принимают заявки</h2>
            <p>
              Пауза действует только на первую отправку. Черновики сохраняются, дополнения и решения
              по действующим заявкам доступны.
            </p>
          </div>
          {products.loading ? (
            <Loading />
          ) : products.error ? (
            <ErrorState message={products.error} retry={products.refresh} />
          ) : (
            <div className="admin-intake-list">
              {products.data?.products.map((product) => (
                <article className="admin-intake-card" key={product.id}>
                  <div className="admin-intake-main">
                    <span className={`badge ${product.intake.paused ? 'amber' : 'green'}`}>
                      {product.intake.paused ? 'Приём приостановлен' : 'Приём открыт'}
                    </span>
                    <h3>{product.name}</h3>
                    <p>{product.subtitle}</p>
                    <small>
                      {money(product.minAmount)} — {money(product.maxAmount)} · {product.minTerm}–
                      {product.maxTerm} мес.
                    </small>
                    {product.intake.reason && (
                      <p className="admin-intake-reason">
                        <b>Основание:</b> {product.intake.reason}
                      </p>
                    )}
                  </div>
                  <div className="admin-intake-control">
                    <small>Версия {product.intake.version}</small>
                    <button
                      className={`button ${product.intake.paused ? 'primary' : 'secondary'}`}
                      disabled={busy}
                      onClick={() => {
                        setEditing(product);
                        setReason('');
                        setError('');
                      }}
                    >
                      {product.intake.paused ? 'Возобновить приём' : 'Приостановить приём'}
                    </button>
                  </div>
                  {editing?.id === product.id && (
                    <form
                      className="admin-intake-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void changeIntake();
                      }}
                    >
                      <label htmlFor={`intake-reason-${product.id}`}>
                        Причина {editing.intake.paused ? 'возобновления' : 'приостановки'}
                      </label>
                      <textarea
                        id={`intake-reason-${product.id}`}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        minLength={5}
                        maxLength={300}
                        required
                        rows={3}
                        disabled={busy}
                        placeholder="Что изменилось и почему меняется приём"
                      />
                      <p>
                        Причина будет доступна пользователям продукта и сохранится в журнале. Не
                        указывайте персональные данные.
                      </p>
                      {editing.intake.version !== product.intake.version ? (
                        <div role="status">
                          <p>
                            Другой администратор уже изменил статус. Проверьте карточку и выберите
                            действие заново.
                          </p>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => setEditing(null)}
                          >
                            Закрыть изменение
                          </button>
                        </div>
                      ) : (
                        <div className="admin-form-actions">
                          <button
                            className="button primary"
                            disabled={busy || reason.trim().length < 5}
                          >
                            {busy
                              ? 'Сохраняем…'
                              : editing.intake.paused
                                ? 'Подтвердить возобновление'
                                : 'Подтвердить паузу'}
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            disabled={busy}
                            onClick={() => setEditing(null)}
                          >
                            Отмена
                          </button>
                        </div>
                      )}
                    </form>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {section === 'registry' && (
        <section>
          <div className="admin-section-title">
            <h2>Реестр отправленных заявок</h2>
            <p>
              Только этапы и параметры обращения. Досье, документы и содержимое черновиков
              недоступны администратору.
            </p>
          </div>
          <ExportButtons kind="registry" busy={exporting} onExport={exportData} />
          {registry.loading ? (
            <Loading />
          ) : registry.error ? (
            <ErrorState message={registry.error} retry={registry.refresh} />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Заявка</th>
                    <th>Компания</th>
                    <th>Сумма и срок</th>
                    <th>Этап</th>
                    <th>Обновление</th>
                  </tr>
                </thead>
                <tbody>
                  {registry.data?.applications.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <b>{row.number}</b>
                      </td>
                      <td>{row.organizationName}</td>
                      <td>
                        {money(row.amount)}
                        <small className="admin-cell-note">{row.termMonths} мес.</small>
                      </td>
                      <td>
                        <Status status={row.status} />
                      </td>
                      <td>{date(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!registry.data?.applications.length && (
                <p className="admin-empty">Отправленных заявок пока нет.</p>
              )}
            </div>
          )}
        </section>
      )}
      {section === 'users' && (
        <section>
          <div className="admin-section-title">
            <h2>Пользователи и сессии</h2>
            <p>
              Активная сессия означает действующий вход, а не присутствие пользователя онлайн.
              Секреты доступа здесь не отображаются.
            </p>
          </div>
          {users.loading ? (
            <Loading />
          ) : users.error ? (
            <ErrorState message={users.error} retry={users.refresh} />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Роль</th>
                    <th>Организация</th>
                    <th>Сессии</th>
                    <th>Последнее истечение</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data?.users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <b>{user.name}</b>
                        <small className="admin-cell-note">{user.email}</small>
                      </td>
                      <td>{roleNames[user.role]}</td>
                      <td>{user.organizationName ?? 'Платформа'}</td>
                      <td>
                        {user.activeSessions} активных
                        <small className="admin-cell-note">{user.expiredSessions} истёкших</small>
                      </td>
                      <td>
                        {user.latestSessionExpiresAt
                          ? new Date(user.latestSessionExpiresAt).toLocaleString('ru-RU')
                          : 'Входов нет'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {section === 'audit' && (
        <section>
          <div className="admin-section-title">
            <h2>История платформы</h2>
            <p>
              Последние 200 событий. Выгрузка содержит весь доступный журнал; содержание кредитных
              проверок и частные комментарии скрыты.
            </p>
          </div>
          <ExportButtons kind="audit" busy={exporting} onExport={exportData} />
          {audit.loading ? (
            <Loading />
          ) : audit.error ? (
            <ErrorState message={audit.error} retry={audit.refresh} />
          ) : (
            <ol className="admin-audit-list">
              {audit.data?.events.map((event) => (
                <li key={event.id}>
                  <time dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString('ru-RU')}
                  </time>
                  <div>
                    <h3>{eventNames[event.action] ?? event.detail}</h3>
                    {!event.applicationId && <p>{event.detail}</p>}
                    <small>
                      {event.actorName}
                      {event.applicationId ? ' · Операция по отправленной заявке' : ''}
                    </small>
                  </div>
                </li>
              ))}
              {!audit.data?.events.length && <li>Операций пока нет.</li>}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

function ExportButtons({
  kind,
  busy,
  onExport,
}: {
  kind: 'registry' | 'audit';
  busy: string;
  onExport: (kind: 'registry' | 'audit', format: 'json' | 'csv') => Promise<void>;
}) {
  return (
    <div className="admin-export-actions">
      {(['json', 'csv'] as const).map((format) => (
        <button
          className="button secondary"
          key={format}
          disabled={Boolean(busy)}
          onClick={() => void onExport(kind, format)}
        >
          {busy === `${kind}-${format}` ? 'Готовим файл…' : `Скачать ${format.toUpperCase()}`}
        </button>
      ))}
    </div>
  );
}
