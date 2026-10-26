import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  FileCheck2,
  FilePlus2,
  FileText,
  Info,
  Landmark,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  Wallet,
} from '../icons';
import type {
  Application,
  ApplicationDetail,
  ApplicationInput,
  DocumentRecord,
  Product,
} from '../../shared/types';
import { api, date, money, rate, useApi } from '../api';
import { useAuth } from '../context';
import { FieldLabel } from '../FieldGuide';
import { LoanSummary } from '../LoanSummary';
import { AuditContext } from '../AuditContext';
import { Empty, ErrorState, Loading, Modal, PageHead, RouteTrack, Status, statuses } from '../ui';
import { BankDecision } from './Bank';
import { OfferComparison } from '../OfferComparison';
import { OcrWorkbench, saveReviewedOcr, type ReviewedOcr } from '../ocr/OcrWorkbench';
import { PersonalizedOffers } from '../PersonalizedOffers';
import { StatementWorkbench } from '../StatementWorkbench';
import { FinancingNavigator } from '../FinancingNavigator';
import { FinancingAlternatives } from '../FinancingAlternatives';
import { ApplicationActionPlan } from '../ApplicationActionPlan';
import { ApplicationChanges } from '../ApplicationChanges';
import { LoanServicing } from '../LoanServicing';
import { FinancialValueSource } from '../FinancialValueSource';
import { legalFormLabels, taxSystemLabels } from '../../shared/business-profile';
import { documentRequestStatus } from '../../shared/document-requests';
import '../document-requests.css';

const docLabel = (category: string) =>
  ({
    statement: 'Выписка по счёту',
    financials: 'Финансовая отчётность',
    invoice: 'Счёт на оборудование',
    other: 'Дополнительный документ',
    contract: 'Кредитный договор',
    receipt: 'Подтверждение выдачи',
  })[category] || category;

export function Products() {
  const { data, loading, error, refresh } = useApi<{ products: Product[] }>('/products');
  const { auth } = useAuth();
  const [query] = useSearchParams();
  const selected = query.get('product');
  const selectedExists = !!data?.products.some((p) => p.id === selected);
  useEffect(() => {
    if (!selected || !selectedExists) return;
    const target = document.getElementById(`product-${selected}`);
    target?.scrollIntoView({ block: 'center', behavior: 'instant' });
    target?.focus({ preventScroll: true });
  }, [selected, selectedExists]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} retry={refresh} />;
  const icons = [Wallet, Building2, Landmark];
  return (
    <>
      <PageHead
        title="Кредит под вашу задачу"
        subtitle="Сначала цель бизнеса, затем подходящие условия."
      />
      {auth.user.role === 'client' && <FinancingNavigator products={data.products} />}
      {auth.user.role === 'client' && <PersonalizedOffers />}
      {auth.user.role !== 'client' && (
        <div className="product-intro">
          <div className="product-intro-copy">
            <span className="icon-tile blue">
              <ShieldCheck size={22} />
            </span>
            <h2>
              Понятные условия.
              <br />
              До первого шага.
            </h2>
            <p>
              Сравните продукты и примерную нагрузку. Окончательное решение появится после проверки
              заявки.
            </p>
          </div>
          <div className="product-intro-steps">
            <span>
              <Check size={17} />
              Платёж и график до подачи заявки
            </span>
            <span>
              <Check size={17} />
              Весь процесс в кабинете
            </span>
            <span>
              <Check size={17} />
              Причины решения открыты
            </span>
          </div>
        </div>
      )}
      <h2 className="catalog-heading">Все продукты и условия</h2>
      <div className="products-grid">
        {data.products.map((p, i) => {
          const Icon = icons[i % icons.length];
          return (
            <article
              key={p.id}
              id={`product-${p.id}`}
              tabIndex={selected === p.id ? -1 : undefined}
              aria-label={p.name}
              className={`product-card product-${i} ${selected === p.id ? 'is-search-match' : ''}`}
            >
              {selected === p.id && <span className="product-match-label">Продукт из поиска</span>}
              <div className="product-card-top">
                <span className="product-symbol">
                  <Icon size={29} strokeWidth={1.5} />
                </span>
                <span className="badge neutral">{p.subtitle}</span>
              </div>
              <h2>{p.name}</h2>
              <p>{p.description}</p>
              <dl className="product-terms">
                <div>
                  <dt>Сумма</dt>
                  <dd>до {money(p.maxAmount, true)}</dd>
                </div>
                <div>
                  <dt>Ставка</dt>
                  <dd>{rate(p.rateBps)} годовых</dd>
                </div>
                <div>
                  <dt>Срок</dt>
                  <dd>
                    {p.minTerm}–{p.maxTerm} мес.
                  </dd>
                </div>
              </dl>
              <div className="product-purposes">
                {p.purposes.slice(0, 3).map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
              {auth.user.role === 'client' && (
                <Link
                  to={`/applications/new?product=${p.id}`}
                  className={`button ${i === 0 ? 'primary' : 'secondary'}`}
                >
                  Выбрать продукт
                  <ArrowUpRight size={17} />
                </Link>
              )}
            </article>
          );
        })}
      </div>
      <div className="help-strip">
        <Info size={20} />
        <p>
          Условия не являются предложением банка. В репетиции можно сравнить платёж и общую
          переплату.
        </p>
        <Link className="text-link" to={auth.user.role === 'client' ? '/simulator' : '/bank'}>
          {auth.user.role === 'client' ? 'Посчитать платёж' : 'К заявкам'}
          <ArrowRight size={17} />
        </Link>
      </div>
    </>
  );
}

export function Applications() {
  const { data, loading, error, refresh } = useApi<{ applications: Application[] }>(
    '/applications',
  );
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} retry={refresh} />;
  const filtered = data.applications.filter(
    (a) =>
      (filter === 'all' ||
        (filter === 'active'
          ? !['declined', 'funded', 'draft'].includes(a.status)
          : filter === 'draft'
            ? a.status === 'draft'
            : ['declined', 'funded'].includes(a.status))) &&
      `${a.number} ${a.purpose} ${statuses[a.status].label}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHead
        title="Мои заявки"
        subtitle="Каждый шаг и результат — в одном месте."
        action={
          <Link to="/applications/new" className="button primary">
            <Plus size={18} />
            Новая заявка
          </Link>
        }
      />
      <div className="list-toolbar">
        <div className="tabs">
          {[
            ['all', 'Все заявки'],
            ['active', 'В работе'],
            ['draft', 'Черновики'],
            ['done', 'Завершены'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={filter === id ? 'active' : ''}
            >
              {label}
              {id === 'all' && <span>{data.applications.length}</span>}
            </button>
          ))}
        </div>
        <div className="small-search">
          <Search size={17} />
          <input
            placeholder="Номер или цель"
            aria-label="Найти заявку"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {filtered.length ? (
        <div className="application-cards">
          {filtered.map((a) => (
            <Link to={`/applications/${a.id}`} className="application-card" key={a.id}>
              <div className="application-card-head">
                <span className="icon-tile blue">
                  <FileText size={21} />
                </span>
                <span>{a.number}</span>
                <Status status={a.status} />
                <ChevronRight size={18} />
              </div>
              <h2>{a.purpose}</h2>
              <div className="application-figures">
                <div>
                  <span>Запрашиваемая сумма</span>
                  <strong>{money(a.amount)}</strong>
                </div>
                <div>
                  <span>Срок</span>
                  <strong>{a.termMonths} мес.</strong>
                </div>
                <div>
                  <span>Обновлено</span>
                  <strong className="small-figure">{date(a.updatedAt)}</strong>
                </div>
              </div>
              <RouteTrack status={a.status} />
              <div className="application-next">
                <span>{statuses[a.status].next}</span>
                <ArrowUpRight size={18} />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title={query ? 'Заявки не найдены' : 'Здесь пока нет заявок'}
          text="Выберите другой фильтр или создайте заявку на финансирование."
          action={
            <Link className="button primary" to="/products">
              Подобрать кредит
            </Link>
          }
        />
      )}
    </>
  );
}

const applicationDrafts = new Map<
  string,
  { form: ApplicationInput; step: number; pendingOcr: ReviewedOcr | null }
>();
export const clearApplicationDrafts = () => applicationDrafts.clear();

export function NewApplication() {
  const { data, loading, error, refresh } = useApi<{ products: Product[] }>('/products');
  const { auth, toast } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const location = useLocation();
  const locationState = location.state;
  const draftKey = `${auth.user.id}:${auth.organization?.id}:${location.key}`;
  const savedDraft = applicationDrafts.get(draftKey);
  const scenarioFinancials = locationState?.scenarioFinancials;
  const navigatorPurpose =
    typeof locationState?.navigatorPurpose === 'string' &&
    locationState.navigatorPurpose.length >= 3 &&
    locationState.navigatorPurpose.length <= 500
      ? locationState.navigatorPurpose
      : '';
  const transferredFinancials =
    scenarioFinancials &&
    typeof scenarioFinancials === 'object' &&
    ['monthlyRevenue', 'monthlyExpenses', 'monthlyDebtPayment'].every(
      (key) =>
        Number.isSafeInteger(scenarioFinancials[key]) &&
        scenarioFinancials[key] >= 0 &&
        scenarioFinancials[key] <= 1000000000,
    )
      ? {
          monthlyRevenue: scenarioFinancials.monthlyRevenue as number,
          monthlyExpenses: scenarioFinancials.monthlyExpenses as number,
          monthlyDebtPayment: scenarioFinancials.monthlyDebtPayment as number,
        }
      : null;
  const [step, setStep] = useState(savedDraft?.step ?? 0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [pendingOcr, setPendingOcr] = useState<ReviewedOcr | null>(savedDraft?.pendingOcr ?? null);
  const [form, setForm] = useState<ApplicationInput>(
    savedDraft?.form ?? {
      productId: params.get('product') || 'working_capital',
      amount: Number(params.get('amount')) || 1500000,
      termMonths: Number(params.get('term')) || 24,
      purpose: navigatorPurpose,
      consent: false,
      financials: transferredFinancials ?? {
        monthlyRevenue: auth.organization?.monthlyRevenue || 0,
        monthlyExpenses: auth.organization?.monthlyExpenses || 0,
        monthlyDebtPayment: auth.organization?.monthlyDebtPayment || 0,
      },
    },
  );
  useEffect(() => {
    applicationDrafts.set(draftKey, { form, step, pendingOcr });
    if (applicationDrafts.size > 20)
      applicationDrafts.delete(applicationDrafts.keys().next().value!);
  }, [draftKey, form, step, pendingOcr]);
  useEffect(() => {
    const p = data?.products.find((p) => p.id === form.productId);
    if (p && !form.purpose)
      setForm((f) => ({
        ...f,
        purpose: p.purposes[0],
        amount: Math.max(p.minAmount, Math.min(p.maxAmount, f.amount)),
        termMonths: Math.max(p.minTerm, Math.min(p.maxTerm, f.termMonths)),
      }));
  }, [data, form.productId]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} retry={refresh} />;
  const product = data.products.find((p) => p.id === form.productId) || data.products[0];
  async function save() {
    setBusy(true);
    setFailure('');
    try {
      const r = await api<{ application: Application }>('/applications', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      applicationDrafts.delete(draftKey);
      if (pendingOcr) {
        try {
          await saveReviewedOcr(r.application.id, r.application.version, 'financials', pendingOcr);
        } catch (error) {
          toast(`Черновик сохранён, но текст документа не прикреплён: ${(error as Error).message}`);
          navigate(`/applications/${r.application.id}`);
          return;
        }
      }
      toast('Черновик сохранён. Добавьте документы и отправьте заявку.');
      navigate(`/applications/${r.application.id}`);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link to="/applications" className="back-link">
        <ArrowLeft size={16} />
        Мои заявки
      </Link>
      <PageHead
        title="Новая заявка"
        subtitle="Расскажите о планах. Данные можно проверить перед отправкой."
      />
      <div className="wizard-layout">
        <section className="surface wizard">
          <ol className="wizard-steps">
            {['Задача бизнеса', 'Финансы', 'Проверка'].map((s, i) => (
              <li key={s} className={step === i ? 'active' : step > i ? 'done' : ''}>
                <span>{step > i ? <Check size={15} /> : i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (step < 2) setStep(step + 1);
              else void save();
            }}
          >
            {step === 0 && (
              <div className="form-section">
                <h2>На что нужны средства?</h2>
                <p>Выберите продукт и параметры финансирования.</p>
                <div className="guided-field">
                  <FieldLabel id="new-product" label="Кредитный продукт" field="productId" />
                  <select
                    id="new-product"
                    value={form.productId}
                    onChange={(e) => {
                      const p = data.products.find((p) => p.id === e.target.value)!;
                      setForm({
                        ...form,
                        productId: p.id,
                        purpose: p.purposes[0],
                        amount: Math.min(p.maxAmount, Math.max(p.minAmount, form.amount)),
                        termMonths: Math.min(p.maxTerm, Math.max(p.minTerm, form.termMonths)),
                      });
                    }}
                  >
                    {data.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-grid">
                  <div className="guided-field">
                    <FieldLabel id="new-amount" label="Сумма, ₽" field="requestedAmount" />
                    <input
                      id="new-amount"
                      type="number"
                      min={product.minAmount}
                      max={product.maxAmount}
                      step={1}
                      required
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                    />
                    <small>
                      От {money(product.minAmount)} до {money(product.maxAmount)}
                    </small>
                  </div>
                  <div className="guided-field">
                    <FieldLabel id="new-term" label="Срок, месяцев" field="preferredTermMonths" />
                    <input
                      id="new-term"
                      type="number"
                      min={product.minTerm}
                      max={product.maxTerm}
                      required
                      value={form.termMonths}
                      onChange={(e) => setForm({ ...form, termMonths: Number(e.target.value) })}
                    />
                    <small>
                      От {product.minTerm} до {product.maxTerm} месяцев
                    </small>
                  </div>
                </div>
                <div className="guided-field">
                  <FieldLabel id="new-purpose" label="Цель финансирования" field="purpose" />
                  <input
                    id="new-purpose"
                    list="financing-purposes"
                    required
                    minLength={3}
                    maxLength={500}
                    value={form.purpose}
                    onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                  />
                  <datalist id="financing-purposes">
                    {product.purposes.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                  <small>
                    Выберите подсказку или опишите свою задачу — например, закупку материалов под
                    новый контракт.
                  </small>
                </div>
              </div>
            )}
            {step === 1 && (
              <div className="form-section">
                <h2>Финансовая картина</h2>
                <p>Средние показатели за месяц. Уточните значения перед отправкой.</p>
                <div className="company-summary">
                  <Building2 size={22} />
                  <div>
                    <b>{auth.organization?.name}</b>
                    <span>
                      ИНН {auth.organization?.inn} · {auth.organization?.city}
                    </span>
                  </div>
                  <span className="badge green">Показатели компании</span>
                </div>
                <div className="ocr-launch">
                  <div>
                    <b>Заполнить из документа</b>
                    <p>
                      Распознайте снимок или PDF, сверьте текст и выберите месячные суммы. Ничего не
                      заменится без вашего подтверждения.
                    </p>
                  </div>
                  <OcrWorkbench
                    currentFinancials={form.financials}
                    onApply={(values, result) => {
                      setForm((current) => ({
                        ...current,
                        financials: { ...current.financials, ...values },
                      }));
                      setPendingOcr(result);
                      toast(
                        'Выбранные суммы перенесены. Текст прикрепится при сохранении черновика.',
                      );
                    }}
                  />
                  {pendingOcr && (
                    <p role="status">
                      Проверен: {pendingOcr.sourceName}. Текст прикрепится к черновику.{' '}
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setPendingOcr(null)}
                      >
                        Не прикреплять текст
                      </button>
                    </p>
                  )}
                </div>
                {(
                  [
                    [
                      'monthlyRevenue',
                      'Выручка в месяц, ₽',
                      'Все поступления от деятельности компании',
                    ],
                    [
                      'monthlyExpenses',
                      'Операционные расходы, ₽',
                      'Аренда, зарплаты, закупки — без кредитных платежей',
                    ],
                    [
                      'monthlyDebtPayment',
                      'Текущие кредитные платежи, ₽',
                      'Обязательства до оформления нового кредита',
                    ],
                  ] as const
                ).map(([key, label, hint]) => (
                  <div className="guided-field" key={key}>
                    <FieldLabel id={`new-${key}`} label={label} field={key} />
                    <input
                      id={`new-${key}`}
                      type="number"
                      required
                      min={key === 'monthlyRevenue' ? 1 : 0}
                      max={1000000000}
                      value={form.financials[key]}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          financials: { ...form.financials, [key]: Number(e.target.value) },
                        })
                      }
                    />
                    <small>{hint}</small>
                  </div>
                ))}
              </div>
            )}
            {step === 2 && (
              <div className="form-section">
                <h2>Всё верно?</h2>
                <p>
                  Сейчас сохраним черновик. На следующем экране вы добавите документы и отправите
                  заявку.
                </p>
                <dl className="review-grid">
                  <div>
                    <dt>Продукт</dt>
                    <dd>{product.name}</dd>
                  </div>
                  <div>
                    <dt>Цель</dt>
                    <dd>{form.purpose}</dd>
                  </div>
                  <div>
                    <dt>Сумма</dt>
                    <dd>{money(form.amount)}</dd>
                  </div>
                  <div>
                    <dt>Срок</dt>
                    <dd>{form.termMonths} месяцев</dd>
                  </div>
                  <div>
                    <dt>Выручка в месяц</dt>
                    <dd>{money(form.financials.monthlyRevenue)}</dd>
                  </div>
                  <div>
                    <dt>Свободно до нового кредита</dt>
                    <dd>
                      {money(
                        form.financials.monthlyRevenue -
                          form.financials.monthlyExpenses -
                          form.financials.monthlyDebtPayment,
                      )}
                    </dd>
                  </div>
                </dl>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    required
                    checked={form.consent}
                    onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                  />
                  <span>
                    Подтверждаю использование вымышленных данных и ознакомление с{' '}
                    <Link to="/legal" target="_blank">
                      условиями сервиса
                    </Link>
                    .
                  </span>
                </label>
              </div>
            )}
            {failure && (
              <p role="alert" className="field-error">
                {failure}
              </p>
            )}
            <div className="form-actions">
              {step > 0 && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft size={16} />
                  Назад
                </button>
              )}
              <button className="button primary" disabled={busy}>
                {busy
                  ? 'Сохраняем…'
                  : step === 2
                    ? 'Сохранить и перейти к документам'
                    : 'Продолжить'}
                <ArrowRight size={17} />
              </button>
            </div>
          </form>
        </section>
        <aside className="wizard-aside">
          <div className="icon-tile mint">
            <ShieldCheck size={23} />
          </div>
          <h3>Вы управляете каждым шагом</h3>
          <p>До отправки заявки данные доступны только вашей компании. После — сотруднику банка.</p>
          <ul>
            <li>
              <Check size={16} />
              Можно вернуться к черновику
            </li>
            <li>
              <Check size={16} />
              Решение с объяснением причин
            </li>
            <li>
              <Check size={16} />
              Без звонков и SMS
            </li>
          </ul>
          <div className="aside-tip">
            <b>Хотите проверить нагрузку?</b>
            <p>Посмотрите несколько вариантов суммы и срока.</p>
            <Link
              to="/simulator"
              state={{
                applicationDraft: {
                  userId: auth.user.id,
                  organizationId: auth.organization?.id,
                  productId: form.productId,
                  amount: form.amount,
                  termMonths: form.termMonths,
                  purpose: form.purpose,
                  financials: form.financials,
                },
              }}
              className="text-link"
            >
              Открыть репетицию
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}

export function ApplicationPage() {
  const { id } = useParams();
  const location = useLocation();
  const { data, error, loading, refresh } = useApi<ApplicationDetail>(`/applications/${id}`);
  const { auth, toast } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [edit, setEdit] = useState(false);
  const [editForm, setEditForm] = useState<ApplicationInput | null>(null);
  useEffect(() => {
    if (loading || !data || !location.hash) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(location.hash.slice(1));
      if (!target) return;
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, data?.application.id, location.hash, location.key]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} retry={refresh} />;
  const a = data.application;
  const bank = auth.user.role === 'bank';
  const editable = !bank && ['draft', 'needs_info'].includes(a.status);
  const offer = a.decision?.offer;
  async function saveConsent(consent: boolean) {
    setBusy(true);
    setFailure('');
    try {
      await api(`/applications/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: a.version, consent }),
      });
      await refresh();
      toast(consent ? 'Согласие сохранено' : 'Согласие снято');
    } catch (e) {
      setFailure((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function action(name: string) {
    setBusy(true);
    setFailure('');
    try {
      await api(`/applications/${id}/actions/${name}`, {
        method: 'POST',
        body: JSON.stringify({ version: a.version, confirmed: true }),
      });
      setConfirm('');
      setAgreed(false);
      toast('Состояние заявки обновлено');
      await refresh();
    } catch (e) {
      setFailure((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function sample(category: string) {
    setBusy(true);
    setFailure('');
    try {
      await api(`/applications/${id}/documents/sample`, {
        method: 'POST',
        body: JSON.stringify({ category }),
      });
      toast('Образец документа добавлен');
      await refresh();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File, category: string) {
    setBusy(true);
    setFailure('');
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('category', category);
      await api(`/applications/${id}/documents`, { method: 'POST', body });
      toast('Документ загружен');
      await refresh();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const requested = [
    ...new Set([
      ...data.product.requiredDocuments,
      ...(a.decision?.requestedDocuments || []),
      ...data.documents
        .filter((document) =>
          ['statement', 'financials', 'invoice', 'other'].includes(document.category),
        )
        .map((document) => document.category),
    ]),
  ];
  const documentRequest = documentRequestStatus(a.decision, data.documents);
  return (
    <>
      <Link className="back-link" to={bank ? '/bank' : '/applications'}>
        <ArrowLeft size={16} />
        {bank ? 'Очередь банка' : 'Мои заявки'}
      </Link>
      <PageHead
        title={data.product.name}
        subtitle={`${a.number} · Создана ${date(a.createdAt)} · ${data.organization.name}`}
        action={<Status status={a.status} />}
      />
      <div className="surface detail-route">
        <RouteTrack status={a.status} />
        <div className="detail-next">
          <span className="icon-tile blue">
            <Clock3 size={20} />
          </span>
          <div>
            <b>{statuses[a.status].next}</b>
            <p>
              {a.status === 'needs_info'
                ? a.decision?.reasons.join(' ') || 'Посмотрите список документов ниже.'
                : bank
                  ? 'Все действия фиксируются в истории заявки.'
                  : 'Изменения сохраняются в истории. Мы покажем, когда потребуется ваше действие.'}
            </p>
          </div>
        </div>
      </div>
      {failure && (
        <div className="inline-alert" role="alert">
          {failure}
        </div>
      )}
      <ApplicationActionPlan
        key={`plan-${a.id}-${data.timeline.length}`}
        applicationId={a.id}
        version={a.version}
        bank={bank}
      />
      {bank && (
        <ApplicationChanges key={`changes-${a.id}`} applicationId={a.id} version={a.version} />
      )}
      <div className="detail-layout">
        <div className="detail-primary">
          <section className="surface detail-section" id="application-financials" tabIndex={-1}>
            <div className="section-head">
              <h2>Параметры заявки</h2>
              {editable && (
                <button
                  className="text-button"
                  onClick={() => {
                    setEditForm(a);
                    setEdit(true);
                  }}
                >
                  <Pencil size={15} />
                  Изменить
                </button>
              )}
            </div>
            <div className="detail-amounts">
              <div>
                <span>Сумма</span>
                <strong>{money(a.amount)}</strong>
              </div>
              <div>
                <span>Срок</span>
                <strong>
                  {a.termMonths}
                  <small> мес.</small>
                </strong>
              </div>
              <div>
                <span>Ставка продукта</span>
                <strong>{rate(data.product.rateBps)}</strong>
              </div>
            </div>
            <dl className="detail-data">
              <div>
                <dt>На что нужны средства</dt>
                <dd>{a.purpose}</dd>
              </div>
              <div>
                <dt>Выручка за месяц</dt>
                <dd>
                  <FinancialValueSource
                    label="Выручка за месяц"
                    value={a.financials.monthlyRevenue}
                    applicationVersion={a.version}
                    updatedAt={a.updatedAt}
                  />
                </dd>
              </div>
              <div>
                <dt>Операционные расходы</dt>
                <dd>
                  <FinancialValueSource
                    label="Операционные расходы"
                    value={a.financials.monthlyExpenses}
                    applicationVersion={a.version}
                    updatedAt={a.updatedAt}
                  />
                </dd>
              </div>
              <div>
                <dt>Платежи по обязательствам</dt>
                <dd>
                  <FinancialValueSource
                    label="Платежи по обязательствам"
                    value={a.financials.monthlyDebtPayment}
                    applicationVersion={a.version}
                    updatedAt={a.updatedAt}
                  />
                </dd>
              </div>
            </dl>
            {data.organization.profile && (
              <details className="small muted">
                <summary>
                  Профиль бизнеса · {legalFormLabels[data.organization.profile.legalForm]} ·{' '}
                  {taxSystemLabels[data.organization.profile.taxSystem]} · версия{' '}
                  {data.organization.profile.version}
                </summary>
                <p>
                  Финансовые данные на{' '}
                  {new Date(
                    `${data.organization.profile.financialsAsOf}T12:00:00Z`,
                  ).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  .
                  {a.organizationSnapshotMeta
                    ? ` Контекст закреплён ${new Date(a.organizationSnapshotMeta.capturedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}.`
                    : a.organizationSnapshot
                      ? ' Используется сохранённый снимок.'
                      : a.status === 'draft'
                        ? ' Пока используется текущий профиль; снимок будет закреплён при отправке.'
                        : ' В прежней заявке исходный снимок не сохранён; показан доступный текущий контекст.'}
                </p>
                {a.organizationSnapshotMeta?.source === 'legacy_recovery' && (
                  <p>
                    У прежней заявки не было исходного снимка. Контекст восстановлен из данных,
                    доступных перед изменением профиля. Это не подтверждение исторических сведений;
                    сохранённое решение и финансовые значения заявки не изменены.
                  </p>
                )}
              </details>
            )}
          </section>
          {a.decision && (
            <section
              className={`surface decision-card outcome-${a.decision.outcome}`}
              id="application-decision"
              tabIndex={-1}
            >
              <div className="section-head">
                <h2>Решение банка</h2>
                <Status status={a.decision.outcome} />
              </div>
              <ul className="reason-list">
                {a.decision.reasons.map((r) => (
                  <li key={r}>
                    <Info size={17} />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
              {offer && (
                <div className="offer-grid">
                  <div>
                    <span>Предложенная сумма</span>
                    <b>{money(offer.amount)}</b>
                  </div>
                  <div>
                    <span>Платёж в месяц</span>
                    <b>{money(offer.monthlyPayment)}</b>
                  </div>
                  <div>
                    <span>Срок</span>
                    <b>{offer.termMonths} месяцев</b>
                  </div>
                  <div>
                    <span>Ставка</span>
                    <b>{rate(offer.rateBps)} годовых</b>
                  </div>
                </div>
              )}
              {offer && a.decision.outcome === 'counter_offer' && (
                <OfferComparison application={a} offer={offer} />
              )}
              <p className="small muted">
                Правила {a.decision.ruleVersion} · {date(a.decision.decidedAt)}. Скоринг — один из
                факторов, а не итоговое решение.
              </p>
              {!bank && ['approved', 'counter_offer'].includes(a.status) && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setConfirm('accept-offer');
                    setAgreed(false);
                  }}
                  className="button primary"
                >
                  Принять условия
                  <ArrowRight size={17} />
                </button>
              )}
            </section>
          )}
          {!['accepted', 'signed', 'funded'].includes(a.status) && (
            <FinancingAlternatives
              key={`alternatives-${a.id}`}
              applicationId={a.id}
              applicationVersion={a.version}
              canCreateDraft={!bank}
              onApplicationChanged={refresh}
            />
          )}
          <div id="application-statement" tabIndex={-1}>
            <StatementWorkbench
              applicationId={a.id}
              version={a.version}
              financials={a.financials}
              editable={editable}
              canPlan={!bank}
              onSaved={refresh}
            />
          </div>
          <section className="surface detail-section" id="application-documents" tabIndex={-1}>
            <div className="section-head">
              <h2>Документы</h2>
              <span className="count-chip">{data.documents.length}</span>
            </div>
            <p className="section-description">
              Добавьте файл или готовый образец в нужную категорию. Комплектность обновится
              автоматически. Прежние вложения сохраняются; новый файл не заменяет их.
            </p>
            {a.status === 'needs_info' && (
              <div className="document-request-summary" role="status">
                <strong>Запрос банка</strong>
                <p>{a.decision?.reasons.join(' ')}</p>
                <p>{documentRequest.note}</p>
                <span>
                  Новые вложения:{' '}
                  {documentRequest.categories.filter((category) => category.satisfied).length} из{' '}
                  {documentRequest.categories.length} запрошенных категорий.
                </span>
              </div>
            )}
            {editable && (
              <div className="ocr-launch">
                <div>
                  <b>Снимок → проверенный текст</b>
                  <p>
                    Распознавание на устройстве. После проверки текст сохранится отдельным
                    документом; финансовые поля заявки не изменятся.
                  </p>
                </div>
                <OcrWorkbench
                  applicationId={a.id}
                  version={a.version}
                  currentFinancials={a.financials}
                  onSaved={refresh}
                />
              </div>
            )}
            <div className="document-checklist">
              {requested.map((category) => {
                const categoryDocuments = data.documents.filter(
                  (document) => document.category === category,
                );
                const requestCategory = documentRequest.categories.find(
                  (item) => item.category === category,
                );
                const complete = requestCategory
                  ? requestCategory.satisfied
                  : categoryDocuments.length > 0;
                return (
                  <div
                    className={`document-request document-request-category ${complete ? 'complete' : ''}`}
                    key={category}
                    data-category={category}
                  >
                    <span className="document-status">
                      {complete ? <FileCheck2 size={22} /> : <FilePlus2 size={22} />}
                    </span>
                    <div>
                      <b>{docLabel(category)}</b>
                      <span>
                        {requestCategory
                          ? requestCategory.satisfied
                            ? 'Новый файл добавлен для повторной проверки'
                            : 'Банк ждёт новый файл в этой категории'
                          : categoryDocuments.length
                            ? `Файлов в деле: ${categoryDocuments.length}`
                            : 'Ещё не добавлен'}
                      </span>
                      <div className="document-file-list">
                        {categoryDocuments.map((document) => (
                          <div className="document-category-file" key={document.id}>
                            <a href={document.downloadUrl} aria-label={`Скачать ${document.name}`}>
                              <ArrowDownToLine size={17} />
                              <span>{document.name}</span>
                            </a>
                            <small>
                              {Math.max(1, Math.round(document.size / 1024))} КБ ·{' '}
                              {date(document.createdAt)}
                              {requestCategory
                                ? requestCategory.matchingDocumentIds.includes(document.id)
                                  ? ' · Новое вложение к запросу'
                                  : ' · Прежнее вложение'
                                : ''}
                            </small>
                            {document.ocr && (
                              <small>OCR-копия · оригинал: {document.ocr.sourceName}</small>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    {editable ? (
                      <div className="document-add">
                        <button
                          className="button small secondary"
                          disabled={busy}
                          onClick={() => void sample(category)}
                        >
                          {categoryDocuments.length ? 'Добавить ещё образец' : 'Добавить образец'}
                        </button>
                        <label className="upload-button" title="Загрузить документ">
                          <Upload size={17} />
                          <input
                            type="file"
                            aria-label={`Загрузить ${docLabel(category)}`}
                            accept=".pdf,.txt,.csv,.png,.jpg,.jpeg"
                            disabled={busy}
                            onChange={(e) => {
                              if (e.target.files?.[0]) void upload(e.target.files[0], category);
                              e.target.value = '';
                            }}
                          />
                          <span>Загрузить файл</span>
                        </label>
                      </div>
                    ) : (
                      <span className={`badge ${complete ? 'mint' : 'amber'}`}>
                        {complete ? 'Добавлено' : 'Ожидается'}
                      </span>
                    )}
                  </div>
                );
              })}
              {data.documents
                .filter((d) => !requested.includes(d.category))
                .map((d) => (
                  <DocumentRow key={d.id} doc={d} />
                ))}
            </div>
            {editable && (
              <div id="application-actions" tabIndex={-1}>
                <div id="application-consent" tabIndex={-1}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={a.consent}
                      disabled={busy}
                      onChange={(event) => void saveConsent(event.target.checked)}
                    />
                    <span>
                      Согласен на имитацию проверки данных этой заявки. Реальные банковские запросы
                      не выполняются.
                    </span>
                  </label>
                  <Link to="/legal" className="text-link">
                    Условия и обработка данных
                  </Link>
                </div>
                <div className="form-actions">
                  <button
                    className="button primary"
                    disabled={
                      busy || !a.consent || (a.status === 'needs_info' && !documentRequest.complete)
                    }
                    onClick={() => void action(a.status === 'draft' ? 'submit' : 'supplement')}
                  >
                    {a.status === 'draft' ? 'Отправить заявку' : 'Передать дополнения банку'}
                    <ArrowRight size={17} />
                  </button>
                </div>
              </div>
            )}
          </section>
          {!bank && ['accepted', 'signed', 'funded'].includes(a.status) && (
            <section className="surface signing-card" id="application-terms" tabIndex={-1}>
              <span className="icon-tile mint">
                <FileCheck2 size={23} />
              </span>
              <h2>
                {a.status === 'funded'
                  ? 'Финансовый маршрут пройден'
                  : a.status === 'signed'
                    ? 'Документ подтверждён'
                    : 'Осталось подтвердить документ'}
              </h2>
              <p>
                {a.status === 'funded'
                  ? `Выдача ${money(offer?.amount || a.amount)} зафиксирована в истории заявки.`
                  : a.status === 'signed'
                    ? 'Следующий шаг — подтверждение выдачи.'
                    : 'Ознакомьтесь с договором и проверьте сумму, срок и ежемесячный платёж.'}
              </p>
              {a.status === 'accepted' && (
                <button
                  className="button primary"
                  onClick={() => {
                    setConfirm('sign');
                    setAgreed(false);
                  }}
                >
                  Ознакомиться и подписать
                  <ArrowRight size={17} />
                </button>
              )}
              {a.status === 'signed' && (
                <button
                  className="button primary"
                  onClick={() => {
                    setConfirm('fund');
                    setAgreed(false);
                  }}
                >
                  Смоделировать выдачу
                  <ArrowRight size={17} />
                </button>
              )}
              {a.status === 'funded' && (
                <Link className="text-link" to="/">
                  Вернуться к обзору
                  <ArrowUpRight size={16} />
                </Link>
              )}
            </section>
          )}
          {a.status === 'funded' && (
            <LoanServicing
              key={`servicing-${a.id}`}
              applicationId={a.id}
              readOnly={bank}
              onSaved={() => void refresh()}
            />
          )}
          {bank && <BankDecision detail={data} refresh={refresh} />}
          <section className="surface detail-section">
            <h2>История заявки</h2>
            <ol className="timeline">
              {data.timeline.map((t, i) => (
                <li key={t.id}>
                  <span className={`timeline-dot ${i === 0 ? 'latest' : ''}`} />
                  <div>
                    <b>{t.title}</b>
                    <p>{t.detail}</p>
                    <small>
                      {t.actor} · {new Date(t.createdAt).toLocaleString('ru-RU')}
                    </small>
                    <AuditContext context={t.context} />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="detail-aside">
          <section className="surface passport" id="application-assessment" tabIndex={-1}>
            <span className="icon-tile mint">
              <ShieldCheck size={22} />
            </span>
            <h2>Паспорт решения</h2>
            <p>Что известно о заявке и на чём основана оценка.</p>
            {a.score ? (
              <>
                <div className="score-number">
                  <strong>{a.score.value}</strong>
                  <span>
                    баллов
                    <br />
                    из 100
                  </span>
                </div>
                <div className="score-meter">
                  <span style={{ width: `${a.score.value}%` }} />
                </div>
                <p className="score-explainer">
                  {a.score.band === 'low'
                    ? 'Низкий'
                    : a.score.band === 'medium'
                      ? 'Средний'
                      : 'Высокий'}{' '}
                  риск по расчётной модели
                </p>
                <div className="score-factors">
                  <div>
                    <div>
                      <b>Базовая оценка модели</b>
                      <span>40</span>
                    </div>
                    <p>Начальная точка до учёта факторов</p>
                  </div>
                  {a.score.factors.map((f) => (
                    <div key={f.code}>
                      <div>
                        <b>{f.label}</b>
                        <span>
                          {f.points > 0 ? '+' : ''}
                          {f.points}
                        </span>
                      </div>
                      <p>{f.detail}</p>
                    </div>
                  ))}
                </div>
                <small className="muted">
                  Модель {a.score.modelVersion}. Балл не гарантирует одобрение.
                </small>
              </>
            ) : (
              <div className="passport-pending">
                <Clock3 size={23} />
                <p>Оценка появится после банковской проверки.</p>
              </div>
            )}
          </section>
          {a.checks.length > 0 && (
            <section className="surface checks-panel" id="application-checks" tabIndex={-1}>
              <h3>Источники данных</h3>
              {a.checks.map((c, i) => (
                <details key={i}>
                  <summary>
                    <span className={`check-indicator ${c.status}`} />
                    {c.label}
                    <ChevronRight size={15} />
                  </summary>
                  <p>{c.details}</p>
                  <small>{c.source} · локальная имитация</small>
                </details>
              ))}
              <p className="small muted">
                ФНС и БКИ не запрашиваются. Проверки воспроизводятся локально.
              </p>
            </section>
          )}
          <div className="context-help">
            <CircleCheck size={20} />
            <p>
              Клиент и банк работают с одной заявкой. Статусы и история сохраняются между входами.
            </p>
          </div>
        </aside>
      </div>
      {confirm && (
        <Modal
          title={
            confirm === 'accept-offer'
              ? 'Подтверждение условий'
              : confirm === 'sign'
                ? 'Кредитный договор'
                : 'Подтверждение выдачи'
          }
          close={() => setConfirm('')}
        >
          <div className="confirmation-body">
            <h3>{data.organization.name}</h3>
            {offer && confirm !== 'fund' ? (
              <LoanSummary offer={offer} />
            ) : (
              <dl className="review-grid">
                <div>
                  <dt>Сумма</dt>
                  <dd>{money(offer?.amount || a.amount)}</dd>
                </div>
                <div>
                  <dt>Срок</dt>
                  <dd>{offer?.termMonths || a.termMonths} мес.</dd>
                </div>
                <div>
                  <dt>Платёж</dt>
                  <dd>{money(offer?.monthlyPayment || 0)}</dd>
                </div>
                <div>
                  <dt>Ставка</dt>
                  <dd>{rate(offer?.rateBps || data.product.rateBps)}</dd>
                </div>
              </dl>
            )}
            <p>
              {confirm === 'sign'
                ? 'Демо-документ фиксирует условия учебной заявки. Подтверждение кнопкой имитирует подпись, не является электронной подписью и не имеет юридических последствий.'
                : confirm === 'fund'
                  ? 'Система запишет факт условной выдачи. Реального перевода средств, обращения в банк и списания денег не произойдёт.'
                  : 'После подтверждения условий перейдём к ознакомлению с учебным договором. Реальных финансовых обязательств не возникает.'}
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>Я ознакомился с условиями и понимаю демонстрационный характер действия.</span>
            </label>
            {failure && (
              <p role="alert" className="field-error">
                {failure}
              </p>
            )}
            <button
              disabled={!agreed || busy}
              className="button primary full"
              onClick={() => void action(confirm)}
            >
              {busy
                ? 'Сохраняем…'
                : confirm === 'sign'
                  ? 'Подтвердить документ'
                  : confirm === 'fund'
                    ? 'Подтвердить условную выдачу'
                    : 'Принять условия'}
            </button>
          </div>
        </Modal>
      )}
      {edit && editForm && (
        <Modal title="Уточнить сведения" close={() => setEdit(false)}>
          <form
            className="form-section"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setFailure('');
              try {
                await api(`/applications/${id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ ...editForm, version: a.version }),
                });
                await refresh();
                setEdit(false);
                toast('Изменения сохранены');
              } catch (e) {
                setFailure((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <div className="guided-field">
                <FieldLabel id="edit-amount" label="Сумма, ₽" field="requestedAmount" />
                <input
                  id="edit-amount"
                  type="number"
                  min={data.product.minAmount}
                  max={data.product.maxAmount}
                  required
                  value={editForm.amount}
                  onChange={(e) => setEditForm({ ...editForm, amount: +e.target.value })}
                />
              </div>
              <div className="guided-field">
                <FieldLabel id="edit-term" label="Срок, месяцев" field="preferredTermMonths" />
                <input
                  id="edit-term"
                  type="number"
                  min={data.product.minTerm}
                  max={data.product.maxTerm}
                  required
                  value={editForm.termMonths}
                  onChange={(e) => setEditForm({ ...editForm, termMonths: +e.target.value })}
                />
              </div>
            </div>
            {(
              [
                ['monthlyRevenue', 'Выручка'],
                ['monthlyExpenses', 'Расходы'],
                ['monthlyDebtPayment', 'Кредитные платежи'],
              ] as const
            ).map(([key, text]) => (
              <div className="guided-field" key={key}>
                <FieldLabel id={`edit-${key}`} label={`${text}, ₽/мес.`} field={key} />
                <input
                  id={`edit-${key}`}
                  type="number"
                  min={key === 'monthlyRevenue' ? 1 : 0}
                  max={1000000000}
                  required
                  value={editForm.financials[key]}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      financials: { ...editForm.financials, [key]: +e.target.value },
                    })
                  }
                />
              </div>
            ))}
            {failure && <p className="field-error">{failure}</p>}
            <button className="button primary" disabled={busy}>
              Сохранить сведения
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function DocumentRow({ doc }: { doc: DocumentRecord }) {
  return (
    <div className="document-row">
      <span className="icon-tile blue">
        <FileText size={20} />
      </span>
      <div>
        <b>{doc.name}</b>
        <span>
          {docLabel(doc.category)} · {Math.max(1, Math.round(doc.size / 1024))} КБ ·{' '}
          {date(doc.createdAt)}
        </span>
        {doc.ocr && (
          <small className="ocr-document-meta">
            OCR-копия · {doc.ocr.pages} стр. · проверена {date(doc.ocr.reviewedAt)} · оригинал:{' '}
            {doc.ocr.sourceName}
          </small>
        )}
      </div>
      <a className="icon-button" href={doc.downloadUrl} aria-label={`Скачать ${doc.name}`}>
        <ArrowDownToLine size={18} />
      </a>
    </div>
  );
}
