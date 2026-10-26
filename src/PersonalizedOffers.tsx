import { Link } from 'react-router-dom';
import type { RecommendationsResponse } from '../shared/types';
import { legalFormLabels } from '../shared/business-profile';
import { money, rate, useApi } from './api';
import { ArrowRight, Check, SlidersHorizontal } from './icons';
import { ErrorState, Loading } from './ui';
import './profile-v6.css';
const date = (value: string) =>
  new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export function PersonalizedOffers() {
  const result = useApi<RecommendationsResponse>('/recommendations');
  if (result.loading) return <Loading />;
  if (result.error || !result.data)
    return <ErrorState message={result.error} retry={result.refresh} />;
  const data = result.data;
  return (
    <section className="personalized-offers" aria-labelledby="personalized-title">
      <div className="personalized-heading">
        <div>
          <span>
            {legalFormLabels[data.inputs.profile.legalForm]} · профиль {data.profileVersion}
          </span>
          <h2 id="personalized-title">
            {data.recommendations.some((item) => item.eligible)
              ? 'Подходит вашему бизнесу'
              : 'Пока нет подходящих условий'}
          </h2>
          <p>
            Запрос {money(data.inputs.profile.requestedAmount)} на{' '}
            {data.inputs.profile.preferredTermMonths} мес. Данные на {date(data.financialsAsOf)}
          </p>
        </div>
        <Link className="button secondary" to="/business">
          <SlidersHorizontal size={18} />
          Уточнить профиль
        </Link>
      </div>
      {data.staleFinancials && (
        <p className="recommendation-warning" role="status">
          Финансовые сведения устарели. Обновите профиль перед новой заявкой.
        </p>
      )}
      <div className="recommendation-list">
        {data.recommendations.map((item) => (
          <article
            key={item.product.id}
            className={`recommendation-row ${item.rank === 1 && item.eligible ? 'recommendation-leading' : ''}`}
            aria-label={`Подбор: ${item.product.name}`}
          >
            <div className="recommendation-product">
              <span className="recommendation-position">
                {!item.eligible
                  ? 'Ограничения по продукту'
                  : item.rank === 1
                    ? 'Первым стоит рассмотреть'
                    : `Альтернатива ${item.rank - 1}`}
              </span>
              <h3>{item.product.name}</h3>
              <p>{item.product.description}</p>
              <span className={`badge ${item.eligible ? 'green' : 'amber'}`}>
                {item.eligible ? 'Соответствует условиям подбора' : 'Есть ограничения'}
              </span>
            </div>
            <div className="recommendation-reasons">
              <h4>Почему в подборе</h4>
              <ul>
                {item.reasons.slice(0, 3).map((reason) => (
                  <li key={reason}>
                    <Check size={16} />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
              {item.cautions.length > 0 && (
                <details>
                  <summary>Что учесть ({item.cautions.length})</summary>
                  {item.cautions.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                </details>
              )}
              {item.blockers.length > 0 && (
                <div className="recommendation-blockers">
                  {item.blockers.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                </div>
              )}
            </div>
            <div className="recommendation-numbers">
              <span>Платёж в месяц</span>
              <strong>
                {item.calculation ? money(item.calculation.monthlyPayment) : 'Нет расчёта'}
              </strong>
              <p>
                {money(item.proposedAmount)} · {item.proposedTermMonths} мес. ·{' '}
                {rate(item.product.rateBps)}
              </p>
              <dl>
                <div>
                  <dt>Проценты за весь срок</dt>
                  <dd>{item.calculation ? money(item.calculation.totalInterest) : '—'}</dd>
                </div>
                <div>
                  <dt>После платежа в слабый месяц</dt>
                  <dd
                    className={
                      item.stressRemainingCash !== null && item.stressRemainingCash < 0
                        ? 'negative'
                        : ''
                    }
                  >
                    {item.stressRemainingCash === null ? '—' : money(item.stressRemainingCash)}
                  </dd>
                </div>
                <div>
                  <dt>Резерв покроет дефицит</dt>
                  <dd>
                    {item.reserveCoverageMonths === null
                      ? item.calculation
                        ? 'Дефицита нет'
                        : 'Нет расчёта'
                      : `${item.reserveCoverageMonths.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} мес.`}
                  </dd>
                </div>
              </dl>
              {item.eligible ? (
                <Link
                  className={`button ${item.rank === 1 ? 'primary' : 'secondary'}`}
                  to={`/applications/new?product=${item.product.id}&amount=${item.proposedAmount}&term=${item.proposedTermMonths}`}
                  state={{ scenarioFinancials: data.inputs.financials }}
                >
                  Продолжить с этими условиями <ArrowRight size={17} />
                </Link>
              ) : (
                <Link className="button secondary" to="/business">
                  Проверить исходные данные
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
      <details className="recommendation-method">
        <summary>Как получен подбор и какие допущения использованы</summary>
        <p>
          Вначале проверяются ограничения продукта, затем цель, платёжная нагрузка и устойчивость
          поступлений. Место в списке — соответствие задаче, а не вероятность одобрения. Подбор
          предполагает полный комплект документов. Финальное решение появляется после рассмотрения
          заявки.
        </p>
        <p>
          Стресс-сценарий: выручка ниже на {data.inputs.profile.lowSeasonRevenueDropPct}%, расходы и
          текущие платежи сохраняются. Срок работы — {data.inputs.monthsActive} мес.; текущая
          просрочка — {data.inputs.overdueDays} дней.
        </p>
        <p>{data.market.note}</p>
        <p>
          Рыночный ориентир: ключевая ставка {rate(data.market.keyRateBps)} на{' '}
          {date(data.market.keyRateAsOf)}; средние ставки МСП за {data.market.smePeriod}:{' '}
          {rate(data.market.smeShortTermRateBps)} для коротких и{' '}
          {rate(data.market.smeLongTermRateBps)} для длинных кредитов.
        </p>
        <ul>
          {data.market.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.title}
              </a>{' '}
              —{' '}
              {source.publishedAt
                ? date(source.publishedAt)
                : `проверено ${date(source.checkedAt ?? data.market.reviewedAt)}`}
            </li>
          ))}
        </ul>
        <p>
          Правила {data.methodVersion}. Подбор рассчитан {date(data.generatedAt)}. Сведения
          зафиксированы в продукте, автоматически из банка не обновляются.
        </p>
      </details>
    </section>
  );
}
