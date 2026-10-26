import { useState } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  FileText,
  Plus,
  SlidersHorizontal,
  Landmark,
  UserRound,
  CircleMinus,
  ChevronDown,
} from '../icons';
import { Link } from 'react-router-dom';
import type {
  Application,
  ApplicationDetail,
  Dashboard as DashboardData,
  FeedItem,
  Product,
} from '../../shared/types';
import { date, money, useApi } from '../api';
import { useAuth } from '../context';
import { ErrorState, Loading, Status, statuses } from '../ui';
import { JourneyGlyph } from '../JourneyGlyph';
import { CashflowLens } from '../CashflowLens';

export function FeedCard({ item }: { item: FeedItem }) {
  return (
    <article className="feed-card">
      <div className="feed-meta">
        <span>{item.category}</span>
        <time>{date(item.publishedAt)}</time>
      </div>
      <h3>{item.title}</h3>
      <p>{item.body}</p>
      <details className="why">
        <summary>Почему я это вижу</summary>
        <p>{item.reason}</p>
      </details>
      <Link to={item.href} className="text-link">
        {item.actionLabel}
        <ArrowUpRight size={15} />
      </Link>
    </article>
  );
}

const stages = ['Заявка', 'Проверка', 'Решение', 'Подписание', 'Выдача'];
const stageFor: Record<Application['status'], number> = {
  draft: 0,
  submitted: 1,
  in_review: 1,
  needs_info: 0,
  approved: 2,
  counter_offer: 2,
  declined: 2,
  accepted: 3,
  signed: 4,
  funded: 4,
};
const documentNames: Record<string, string> = {
  statement: 'Выписка по счёту',
  financials: 'Финансовая отчётность',
  invoice: 'Счёт на оборудование',
  other: 'Дополнительный документ',
  contract: 'Кредитный договор',
};

function FundingRoute({ application, product }: { application: Application; product?: Product }) {
  const [selectedStage, setInspected] = useState<number | null>(null);
  const { data, loading, error, refresh } = useApi<ApplicationDetail>(
    `/applications/${application.id}`,
  );
  const a = data?.application || application;
  const current = stageFor[a.status];
  const inspected = selectedStage ?? current;
  const terminal = ['funded', 'declined'].includes(a.status);
  const bankTurn = ['submitted', 'in_review'].includes(a.status);
  const needed = [
    ...new Set([...(product?.requiredDocuments || []), ...(a.decision?.requestedDocuments || [])]),
  ];
  const present = (category: string) => data?.documents.some((d) => d.category === category);
  const explanations = [
    'Сумма, срок и документы задают контекст рассмотрения. В черновике или при уточнении сведения можно дополнить.',
    'Проверка регистрации, кредитной истории и комплекта документов. Балл риска и кредитное решение показаны отдельно.',
    'Результат учитывает документы, ограничения продукта и доступный денежный поток. Новые условия принимаются отдельно.',
    'Сначала примите условия предложения, затем ознакомьтесь с документом. Все подтверждения сохраняются в истории заявки.',
    'Финальный этап после подписания. Здесь появятся сумма и дата выдачи, а в документах — подтверждение.',
  ];
  return (
    <section className="funding-route" aria-label="Маршрут выбранной заявки">
      <div className="funding-route-heading">
        <div>
          <span>Маршрут финансирования</span>
          <h2>{a.purpose}</h2>
        </div>
        <Status status={a.status} />
      </div>
      <div className="funding-route-figures">
        <div>
          <span>Запрошено</span>
          <b>{money(a.amount)}</b>
        </div>
        <div>
          <span>Срок</span>
          <b>{a.termMonths} мес.</b>
        </div>
        <div className="funding-product">
          <span>Продукт</span>
          <b>{product?.name || a.productId}</b>
        </div>
      </div>
      <div className="journey-caption">
        <span>Путь заявки</span>
        <span>Выберите этап, чтобы узнать подробности</span>
      </div>
      <ol className="funding-stages">
        {stages.map((title, i) => {
          const complete = i < current || a.status === 'funded';
          const blocked = a.status === 'declined' && i > 2;
          return (
            <li
              key={title}
              className={`${complete ? 'is-complete' : ''} ${i === current ? 'is-current' : ''} ${inspected === i ? 'is-inspected' : ''} ${blocked ? 'is-blocked' : ''}`}
            >
              <button
                onClick={() => setInspected(i)}
                aria-pressed={inspected === i}
                aria-label={`${title}: ${blocked ? 'не применяется после отказа' : complete ? 'пройдено' : i === current ? 'текущий этап' : 'предстоящий этап'}`}
              >
                <span className="funding-stage-marker">
                  <JourneyGlyph stage={i} />
                  <span className="stage-order">
                    {complete ? <Check size={11} /> : blocked ? '—' : `0${i + 1}`}
                  </span>
                </span>
                <b>{title}</b>
                <small>
                  {blocked
                    ? 'Не применяется'
                    : complete
                      ? 'Пройдено'
                      : i === current
                        ? 'Сейчас'
                        : 'Впереди'}
                </small>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="funding-inspection" aria-live="polite">
        <div className="funding-inspection-title">
          <h3>{stages[inspected]}</h3>
          <span>
            {inspected > current
              ? 'Условия перехода'
              : inspected === current
                ? 'Текущий этап'
                : 'Пройденный этап'}
          </span>
        </div>
        <p>{explanations[inspected]}</p>
        {inspected === 0 && (
          <div className="funding-document-checks">
            {loading ? (
              <span>Проверяем состав документов…</span>
            ) : error ? (
              <button className="text-button" onClick={() => void refresh()}>
                Не удалось загрузить документы. Повторить
              </button>
            ) : (
              needed.map((category) => (
                <span className={present(category) ? 'is-ready' : 'is-needed'} key={category}>
                  {present(category) ? <Check size={15} /> : <CircleMinus size={15} />}
                  {documentNames[category] || category}
                  <small>{present(category) ? 'Добавлен' : 'Нужен'}</small>
                </span>
              ))
            )}
          </div>
        )}
        {inspected === 1 && a.checks.length > 0 && (
          <div className="funding-check-results">
            {a.checks.map((check) => (
              <div key={check.source}>
                <span>{check.source}</span>
                <b>{check.label}</b>
              </div>
            ))}
          </div>
        )}
        {inspected === 2 && a.decision && (
          <div className="funding-decision">
            <Status status={a.decision.outcome} />
            <p>{a.decision.reasons.join(' ')}</p>
            {a.decision.offer && (
              <span>
                Предложено <b>{money(a.decision.offer.amount)}</b> на {a.decision.offer.termMonths}{' '}
                мес.
              </span>
            )}
          </div>
        )}
        {inspected === 3 && a.signedAt && (
          <p className="funding-recorded">
            <Check size={15} /> Подписание {date(a.signedAt)}
          </p>
        )}
        {inspected === 4 && a.fundedAt && (
          <p className="funding-recorded">
            <Check size={15} /> Выдача {money(a.decision?.offer?.amount || a.amount)} от{' '}
            {date(a.fundedAt)}
          </p>
        )}
      </div>
      <div className={`funding-next ${bankTurn ? 'is-bank-turn' : ''}`}>
        <span className="funding-owner-icon">
          {bankTurn ? (
            <Landmark size={22} />
          ) : terminal ? (
            <Check size={22} />
          ) : (
            <UserRound size={22} />
          )}
        </span>
        <div>
          <span>{terminal ? 'Путь завершён' : bankTurn ? 'Ход банка' : 'Ваш ход'}</span>
          <b>{statuses[a.status].next}</b>
        </div>
        <Link to={`/applications/${a.id}`} className="button primary">
          {terminal ? 'Посмотреть результат' : bankTurn ? 'Открыть заявку' : 'Продолжить'}
          <ArrowUpRight size={16} />
        </Link>
      </div>
    </section>
  );
}

export function Dashboard() {
  const { data, loading, error, refresh } = useApi<DashboardData>('/dashboard');
  const { auth, preferences } = useAuth();
  const [selectedId, setSelectedId] = useState('');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} retry={refresh} />;
  const active =
    data.applications.find((a) => a.id === selectedId) ||
    data.applications.find((a) => !['funded', 'declined'].includes(a.status)) ||
    data.applications[0];
  const org = data.organization || auth.organization;
  const free = org ? org.monthlyRevenue - org.monthlyExpenses - org.monthlyDebtPayment : 0;
  const shown = (key: string) => preferences.widgets.includes(key);
  return (
    <div className="dashboard-v2">
      <header className="dashboard-heading">
        <div>
          <span>{org?.industry || 'Кредитный кабинет'}</span>
          <h1>{org?.name || 'Обзор заявок'}</h1>
          <p>
            {org?.city} {org?.city ? '•' : ''} Финансирование и денежный поток
          </p>
        </div>
        <Link to="/applications/new" className="button primary">
          <Plus size={18} />
          Новая заявка
        </Link>
      </header>
      <div className="dashboard-workbench">
        <div className="dashboard-route-column">
          {data.applications.length > 1 && (
            <label className="dashboard-route-picker">
              <span>Показать маршрут</span>
              <div>
                <select
                  aria-label="Заявка для маршрута"
                  value={active?.id || ''}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  {data.applications.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.number} — {a.purpose}
                    </option>
                  ))}
                </select>
                <ChevronDown size={17} />
              </div>
            </label>
          )}
          {active ? (
            <FundingRoute
              key={active.id + active.version}
              application={active}
              product={data.products.find((p) => p.id === active.productId)}
            />
          ) : (
            <section className="funding-empty">
              <FileText size={31} />
              <h2>Первый маршрут начинается с задачи</h2>
              <p>
                Выберите продукт, сумму и срок. Сначала сохраним черновик — его можно спокойно
                проверить до отправки.
              </p>
              <Link className="button primary" to="/products">
                Выбрать продукт
                <ArrowRight size={17} />
              </Link>
            </section>
          )}
        </div>
        <aside className="dashboard-cashflow">
          <div className="dashboard-side-heading">
            <h2>Деньги бизнеса</h2>
            <span>За месяц</span>
          </div>
          <p>
            Исходные показатели компании.
            <br />В конкретной заявке их можно уточнить.
          </p>
          <div className="cashflow-revenue">
            <span>Выручка</span>
            <strong>{money(org?.monthlyRevenue || 0)}</strong>
          </div>
          <CashflowLens
            revenue={org?.monthlyRevenue || 0}
            expenses={org?.monthlyExpenses || 0}
            debt={org?.monthlyDebtPayment || 0}
          />
          <dl className="cashflow-ledger">
            <div>
              <dt>
                <i className="cashflow-expense" />
                Операционные расходы
              </dt>
              <dd>− {money(org?.monthlyExpenses || 0)}</dd>
            </div>
            <div>
              <dt>
                <i className="cashflow-debt" />
                Действующие платежи
              </dt>
              <dd>− {money(org?.monthlyDebtPayment || 0)}</dd>
            </div>
            <div className="cashflow-total">
              <dt>
                <i className="cashflow-free" />
                Свободный поток
              </dt>
              <dd>{money(free)}</dd>
            </div>
          </dl>
          {shown('simulator') && (
            <div className="cashflow-rehearsal">
              <SlidersHorizontal size={20} />
              <h3>Поместится ли новый платёж?</h3>
              <p>Измените сумму и срок. Посмотрите нагрузку до отправки заявки.</p>
              <Link to="/simulator">
                Посчитать сценарий
                <ArrowUpRight size={17} />
              </Link>
            </div>
          )}
          <div className="dashboard-portfolio">
            <h3>В кабинете</h3>
            <dl>
              <div>
                <dt>Активных заявок</dt>
                <dd>{data.stats.activeApplications}</dd>
              </div>
              <div>
                <dt>Запрошено</dt>
                <dd>{money(data.stats.requestedAmount)}</dd>
              </div>
              <div>
                <dt>Выдано</dt>
                <dd>{money(data.stats.fundedAmount)}</dd>
              </div>
              <div>
                <dt>Платежи по кредитам</dt>
                <dd>{data.stats.nextPayment ? money(data.stats.nextPayment) : 'Нет'}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
      {data.actions.filter((action) => action.href !== `/applications/${active?.id}`).length >
        0 && (
        <section className="dashboard-attention">
          <h2>Ещё требует вашего участия</h2>
          {data.actions
            .filter((action) => action.href !== `/applications/${active?.id}`)
            .slice(0, 3)
            .map((action) => (
              <Link to={action.href} key={action.href}>
                <span className={action.priority === 'high' ? 'is-urgent' : ''} />
                <div>
                  <b>{action.title}</b>
                  <p>{action.description}</p>
                </div>
                <ArrowUpRight size={18} />
              </Link>
            ))}
        </section>
      )}
      <section className="dashboard-register">
        <div className="dashboard-section-heading">
          <h2>Реестр заявок</h2>
          <Link to="/applications">
            Все заявки
            <ArrowUpRight size={16} />
          </Link>
        </div>
        {data.applications.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Задача бизнеса</th>
                  <th>Сумма / срок</th>
                  <th>Состояние</th>
                  <th>Обновлена</th>
                  <th>
                    <span className="sr-only">Открыть заявку</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.applications.slice(0, 5).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/applications/${a.id}`}>
                        <b>{a.purpose}</b>
                        <span>{a.number}</span>
                      </Link>
                    </td>
                    <td>
                      <b>{money(a.amount)}</b>
                      <span>{a.termMonths} мес.</span>
                    </td>
                    <td>
                      <Status status={a.status} />
                    </td>
                    <td>{date(a.updatedAt)}</td>
                    <td>
                      <Link
                        className="icon-button"
                        aria-label={`Открыть ${a.number}`}
                        to={`/applications/${a.id}`}
                      >
                        <ArrowUpRight size={17} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Сохранённые заявки появятся здесь.</p>
        )}
      </section>
      {shown('feed') && (
        <section className="dashboard-reading">
          <div className="dashboard-section-heading">
            <h2>К вашему контексту</h2>
            <Link to="/feed">
              Вся лента
              <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="dashboard-reading-list">
            {data.feed.slice(0, 3).map((item) => (
              <FeedCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
