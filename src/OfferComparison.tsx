import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowRight, Scale } from './icons';
import type { Application, Offer, ScenarioResult } from '../shared/types';
import { api, money } from './api';

export function OfferComparison({
  application,
  offer,
}: {
  application: Application;
  offer: Offer;
}) {
  const [requested, setRequested] = useState<ScenarioResult | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<ScenarioResult>('/scenario', { method: 'POST', body: JSON.stringify(application) })
      .then((value) => {
        if (active) setRequested(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [application.id, application.version]);
  return (
    <div className="offer-comparison">
      <div className="comparison-title">
        <Scale size={19} />
        <h3>Что изменилось для бизнеса</h3>
      </div>
      <div className="comparison-columns">
        <div>
          <span>Вы запросили</span>
          <strong>{money(application.amount)}</strong>
          <small>{application.termMonths} месяцев</small>
        </div>
        <span className="comparison-arrow">
          <ArrowRight size={20} />
        </span>
        <div>
          <span>Банк предлагает</span>
          <strong>{money(offer.amount)}</strong>
          <small>{offer.termMonths} месяцев</small>
        </div>
      </div>
      {requested ? (
        <>
          <dl className="comparison-table">
            <div>
              <dt>Платёж в месяц</dt>
              <dd>
                <s>{money(requested.monthlyPayment)}</s>
                <b>{money(offer.monthlyPayment)}</b>
              </dd>
            </div>
            <div>
              <dt>Останется после платежа</dt>
              <dd>
                <s>{money(requested.availableCash - requested.monthlyPayment)}</s>
                <b>{money(requested.availableCash - offer.monthlyPayment)}</b>
              </dd>
            </div>
            <div>
              <dt>Проценты за весь срок</dt>
              <dd>
                <s>{money(requested.totalInterest)}</s>
                <b>{money(offer.totalInterest)}</b>
              </dd>
            </div>
          </dl>
          <p className="comparison-tradeoff">
            <ArrowDownRight size={17} />
            <span>
              {application.amount > offer.amount ? (
                <>
                  Сумма на задачу уменьшится на <b>{money(application.amount - offer.amount)}</b>
                  .{' '}
                </>
              ) : null}
              Платёж {offer.monthlyPayment <= requested.monthlyPayment ? 'снизится' : 'увеличится'}{' '}
              на <b>{money(Math.abs(requested.monthlyPayment - offer.monthlyPayment))}</b> в месяц.
              Проверьте, хватит ли нового бюджета на вашу цель.
            </span>
          </p>
        </>
      ) : (
        <p className="small muted">{error || 'Сравниваем условия…'}</p>
      )}
      <p className="small muted">
        Сравнение учебное, по одинаковой модели расчёта. Решение принимать вам.
      </p>
    </div>
  );
}
