import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type {
  BusinessProfile as Profile,
  BusinessProfileResponse,
  Financials,
} from '../../shared/types';
import { legalFormLabels, taxSystemLabels } from '../../shared/business-profile';
import { api, money, useApi } from '../api';
import { useAuth } from '../context';
import { ArrowRight, FileText, ShieldCheck } from '../icons';
import { ErrorState, Loading, PageHead } from '../ui';
import { FieldLabel } from '../FieldGuide';
import '../profile-v6.css';

const goals: Record<Profile['financingGoal'], string> = {
  working_capital: 'Закупки и текущие расходы',
  equipment: 'Оборудование и развитие',
  credit_line: 'Резерв на кассовые разрывы',
};
const influence = [
  [
    'Денежный поток',
    'Выручка за вычетом расходов и действующих платежей определяет запас для нового кредита.',
  ],
  ['Сезонность', 'Проверяем, останутся ли деньги после платежа в слабый месяц.'],
  [
    'Покупатели и расчёты',
    'Зависимость от одного клиента и отсрочка оплаты помогают оценить устойчивость поступлений.',
  ],
  ['Резерв', 'Показывает, на сколько месяцев хватит денег для покрытия дефицита в слабый сезон.'],
];
const drafts = new Map<
  string,
  { baseline: BusinessProfileResponse; profile: Profile; financials: Financials }
>();
export const clearBusinessDrafts = () => drafts.clear();
const financialValues = (data: BusinessProfileResponse): Financials => ({
  monthlyRevenue: data.organization.monthlyRevenue,
  monthlyExpenses: data.organization.monthlyExpenses,
  monthlyDebtPayment: data.organization.monthlyDebtPayment,
});

export function BusinessProfile() {
  const result = useApi<BusinessProfileResponse>('/business-profile');
  const location = useLocation();
  useEffect(() => {
    if (result.loading || !result.data || !location.hash) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(location.hash.slice(1));
      target?.scrollIntoView({ block: 'center', behavior: 'instant' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [result.loading, result.data?.organization.id, location.hash, location.key]);
  if (result.loading) return <Loading />;
  if (!result.data) return <ErrorState message={result.error} retry={result.refresh} />;
  return (
    <>
      {result.error && (
        <p role="alert" className="form-error">
          Не удалось обновить данные: {result.error} Введённые значения сохранены в этой вкладке.
        </p>
      )}
      <ProfileEditor key={result.data.organization.id} data={result.data} reload={result.refresh} />
    </>
  );
}

function ProfileEditor({
  data,
  reload,
}: {
  data: BusinessProfileResponse;
  reload: () => Promise<void>;
}) {
  const { auth, refreshAuth, toast } = useAuth();
  const draftKey = `${auth.user.id}:${data.organization.id}`;
  const [baseline, setBaseline] = useState(() => drafts.get(draftKey)?.baseline ?? data);
  const [profile, setProfile] = useState(() => drafts.get(draftKey)?.profile ?? data.profile);
  const [financials, setFinancials] = useState<Financials>(
    () => drafts.get(draftKey)?.financials ?? financialValues(data),
  );
  const [dirty, setDirty] = useState(() => drafts.has(draftKey));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const reset = (saved: BusinessProfileResponse) => {
    setBaseline(saved);
    setProfile(saved.profile);
    setFinancials(financialValues(saved));
    setDirty(false);
    setError('');
    drafts.delete(draftKey);
  };
  useEffect(() => {
    if (!dirty) reset(data);
  }, [data]);
  useEffect(() => {
    if (dirty) drafts.set(draftKey, { baseline, profile, financials });
    else drafts.delete(draftKey);
  }, [draftKey, baseline, profile, financials, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty]);
  const change = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setProfile((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };
  const numberField = (
    key:
      | 'requestedAmount'
      | 'preferredTermMonths'
      | 'lowSeasonRevenueDropPct'
      | 'largestCustomerSharePct'
      | 'cashReserve'
      | 'receivablesDays',
    label: string,
    maximum: number,
    hint: string,
    minimum = 0,
  ) => (
    <div className="profile-field">
      <FieldLabel id={`profile-${key}`} label={label} field={key} />
      <input
        id={`profile-${key}`}
        type="number"
        inputMode="numeric"
        min={minimum}
        max={maximum}
        step="1"
        required
        value={Number.isNaN(profile[key]) ? '' : profile[key]}
        onChange={(event) => change(key, event.target.valueAsNumber)}
      />
      <small>{hint}</small>
    </div>
  );
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const saved = await api<BusinessProfileResponse>('/business-profile', {
        method: 'PUT',
        body: JSON.stringify({ version: baseline.profile.version, profile, financials }),
      });
      reset(saved);
      toast('Профиль сохранён. Подбор пересчитан по новым данным.');
      const refreshed = await Promise.allSettled([refreshAuth(), reload()]);
      if (refreshed.some((item) => item.status === 'rejected'))
        toast('Профиль сохранён. Сводка кабинета обновится после восстановления связи.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="business-profile-page">
      <PageHead
        title="Как устроен ваш бизнес"
        subtitle="Условия подбираются по данным компании. Здесь видно, что именно влияет на результат."
      />
      <div className="profile-identity">
        <div>
          <span>
            {legalFormLabels[data.profile.legalForm]} · {data.organization.city}
          </span>
          <h2>{data.organization.name}</h2>
          <p>{data.organization.industry}</p>
        </div>
        <div>
          <strong>{data.organization.monthsActive}</strong>
          <span>месяцев работы</span>
        </div>
      </div>
      <div className="profile-workspace">
        <form onSubmit={(event) => void save(event)} className="profile-editor">
          <fieldset disabled={saving}>
            <legend>Форма и задача</legend>
            <div className="profile-fields">
              <div className="profile-field">
                <FieldLabel
                  id="profile-legalForm"
                  label="Организационная форма"
                  field="legalForm"
                />
                <select
                  id="profile-legalForm"
                  value={profile.legalForm}
                  onChange={(event) => {
                    const legalForm = event.target.value as Profile['legalForm'];
                    setProfile((current) => ({
                      ...current,
                      legalForm,
                      taxSystem:
                        legalForm !== 'ip' && ['patent', 'npd'].includes(current.taxSystem)
                          ? 'usn'
                          : current.taxSystem,
                    }));
                    setDirty(true);
                  }}
                >
                  {Object.entries(legalFormLabels).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <small>Определяет подходящие документы, а не штраф к оценке.</small>
              </div>
              <div className="profile-field">
                <FieldLabel id="profile-taxSystem" label="Налоговый режим" field="taxSystem" />
                <select
                  id="profile-taxSystem"
                  value={profile.taxSystem}
                  onChange={(event) =>
                    change('taxSystem', event.target.value as Profile['taxSystem'])
                  }
                >
                  {Object.entries(taxSystemLabels)
                    .filter(([id]) => profile.legalForm === 'ip' || !['patent', 'npd'].includes(id))
                    .map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                </select>
                <small>Для ИП не требуется бухгалтерский баланс юрлица.</small>
              </div>
              <div className="profile-field profile-field-wide">
                <FieldLabel
                  id="profile-financingGoal"
                  label="На что нужны деньги"
                  field="financingGoal"
                />
                <select
                  id="profile-financingGoal"
                  value={profile.financingGoal}
                  onChange={(event) =>
                    change('financingGoal', event.target.value as Profile['financingGoal'])
                  }
                >
                  {Object.entries(goals).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {numberField(
                'requestedAmount',
                'Нужная сумма, ₽',
                30000000,
                'Подбор учитывает ограничения каждого продукта.',
                100000,
              )}
              {numberField(
                'preferredTermMonths',
                'Желаемый срок, мес.',
                60,
                'Срок влияет на размер платежа и переплату.',
                6,
              )}
            </div>
          </fieldset>
          <fieldset disabled={saving}>
            <legend>Деньги за обычный месяц</legend>
            <p>
              Средние значения за последние 6 месяцев. Расходы укажите с налогами, без кредитных
              платежей.
            </p>
            <div className="profile-fields">
              {(
                [
                  ['monthlyRevenue', 'Выручка, ₽'],
                  ['monthlyExpenses', 'Расходы, ₽'],
                  ['monthlyDebtPayment', 'Действующие платежи, ₽'],
                ] as const
              ).map(([key, label]) => (
                <div className="profile-field" key={key}>
                  <FieldLabel id={`profile-${key}`} label={label} field={key} />
                  <input
                    id={`profile-${key}`}
                    type="number"
                    inputMode="numeric"
                    required
                    min="0"
                    max="1000000000"
                    step="1"
                    value={Number.isNaN(financials[key]) ? '' : financials[key]}
                    onChange={(event) => {
                      setFinancials({ ...financials, [key]: event.target.valueAsNumber });
                      setDirty(true);
                    }}
                  />
                </div>
              ))}
              <div className="profile-field">
                <FieldLabel
                  id="profile-financialsAsOf"
                  label="Данные актуальны на"
                  field="financialsAsOf"
                />
                <input
                  id="profile-financialsAsOf"
                  type="date"
                  required
                  value={profile.financialsAsOf}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(event) => change('financialsAsOf', event.target.value)}
                />
                <small>Устаревшие сведения отмечаются в подборе.</small>
              </div>
            </div>
            <div className="profile-cash-result">
              <span>Остаётся до нового кредита</span>
              <strong>
                {money(
                  financials.monthlyRevenue -
                    financials.monthlyExpenses -
                    financials.monthlyDebtPayment,
                )}
              </strong>
              <span>в месяц</span>
            </div>
          </fieldset>
          <fieldset disabled={saving}>
            <legend>Устойчивость поступлений</legend>
            <div className="profile-fields">
              {numberField(
                'lowSeasonRevenueDropPct',
                'Снижение выручки в слабый месяц, %',
                80,
                'Расходы в стресс-расчёте сохраняются.',
              )}
              {numberField(
                'largestCustomerSharePct',
                'Доля крупнейшего покупателя, %',
                100,
                'Укажите долю в общей выручке.',
              )}
              {numberField(
                'cashReserve',
                'Доступный денежный резерв, ₽',
                1000000000,
                'Средства, которые можно направить на обязательства.',
              )}
              {numberField(
                'receivablesDays',
                'Средняя отсрочка оплаты, дней',
                365,
                '0 — покупатели оплачивают сразу.',
              )}
            </div>
          </fieldset>
          {(error || (dirty && data.profile.version !== baseline.profile.version)) && (
            <div role="alert" className="form-error">
              <p>
                {error ||
                  'Профиль изменился в другом окне. Ваш ввод сохранён здесь; загрузите актуальные данные перед повторным сохранением.'}
              </p>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm(
                      'Загрузить сохранённый профиль? Несохранённые изменения будут заменены.',
                    )
                  )
                    void api<BusinessProfileResponse>('/business-profile')
                      .then((saved) => {
                        reset(saved);
                        void reload();
                      })
                      .catch((reason) => setError((reason as Error).message));
                }}
              >
                Загрузить сохранённые данные
              </button>
            </div>
          )}
          <div className="profile-save">
            <button className="button primary" disabled={saving || !dirty}>
              {saving ? 'Сохраняем…' : 'Сохранить профиль'}
            </button>
            <span role="status">
              {dirty
                ? 'Есть несохранённые изменения'
                : `Сохранена версия ${baseline.profile.version}`}
            </span>
          </div>
        </form>
        <aside className="profile-method">
          <ShieldCheck size={28} />
          <h2>Почему именно эти данные</h2>
          {influence.map(([title, text]) => (
            <div key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
          <p className="profile-history-note">
            Изменения влияют на новый подбор. Уже отправленная заявка сохраняет снимок данных, по
            которым её рассмотрели.
          </p>
          <Link className="button secondary" to="/products">
            Посмотреть подбор <ArrowRight size={17} />
          </Link>
          <section className="profile-documents">
            <FileText size={23} />
            <h3>Документы по сохранённому профилю</h3>
            {data.documentGuidance.map((item) => (
              <div key={item.category}>
                <strong>{item.title}</strong>
                <p>{item.explanation}</p>
              </div>
            ))}
            <Link className="text-link" to="/documents">
              Загрузить или распознать
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
