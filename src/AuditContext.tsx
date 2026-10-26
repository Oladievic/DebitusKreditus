import type { AuditContext as EventContext } from '../shared/types';
import { legalFormLabels, taxSystemLabels } from '../shared/business-profile';
import { money, rate } from './api';
import { Status } from './ui';
import './audit-context.css';

export function AuditContext({ context }: { context?: EventContext }) {
  if (!context) return null;
  const input = context.input;
  const assessment = context.assessment;
  const profile = input?.organizationSnapshot?.profile;
  const offer = assessment?.decision?.offer;
  return (
    <details className="audit-event-context">
      <summary>Контекст события</summary>
      <p className="audit-event-versions">
        Заявка v{context.applicationVersion}
        {context.profileVersion ? ` · профиль v${context.profileVersion}` : ''}
        {context.scoringVersion ? ` · ${context.scoringVersion}` : ''}
        {context.policyVersion ? ` · ${context.policyVersion}` : ''}
      </p>
      {input && (
        <>
          <p>
            {input.productSnapshot?.name ?? input.productId} · <Status status={input.status} />
          </p>
          <dl className="audit-event-values">
            <div>
              <dt>Запрошено</dt>
              <dd>
                {money(input.amount)} · {input.termMonths} мес.
              </dd>
            </div>
            <div>
              <dt>Выручка в месяц</dt>
              <dd>{money(input.financials.monthlyRevenue)}</dd>
            </div>
            <div>
              <dt>Расходы в месяц</dt>
              <dd>{money(input.financials.monthlyExpenses)}</dd>
            </div>
            <div>
              <dt>Действующие платежи</dt>
              <dd>{money(input.financials.monthlyDebtPayment)}</dd>
            </div>
          </dl>
          {profile && (
            <p>
              {legalFormLabels[profile.legalForm]} · {taxSystemLabels[profile.taxSystem]} ·
              финансовые данные на {profile.financialsAsOf}
            </p>
          )}
          {input.organizationSnapshotMeta?.source === 'legacy_recovery' && (
            <p>
              Снимок восстановлен из доступных данных при закреплении контекста; исходного
              исторического снимка не было.
            </p>
          )}
        </>
      )}
      {assessment?.score && (
        <div className="audit-event-score">
          <strong>Сохранённая оценка: {assessment.score.value} из 100</strong>
          <ul>
            {assessment.score.factors.map((factor) => (
              <li key={factor.code}>
                <span>
                  {factor.label}: {factor.points > 0 ? '+' : ''}
                  {factor.points}
                </span>
                <small>{factor.detail}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {assessment?.decision && (
        <div className="audit-event-decision">
          <p>
            Сохранённое решение: <Status status={assessment.decision.outcome} />
          </p>
          <ul>
            {assessment.decision.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
          {offer && (
            <p>
              {money(offer.amount)} на {offer.termMonths} мес. · {rate(offer.rateBps)} годовых ·
              платёж {money(offer.monthlyPayment)} · проценты {money(offer.totalInterest)}
            </p>
          )}
        </div>
      )}
      {assessment?.checks.length ? (
        <ul className="audit-event-checks">
          {assessment.checks.map((check, index) => (
            <li key={index}>
              {check.label}: {check.details}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="audit-event-note">
        Здесь сохранены данные на момент события. Текущий профиль может отличаться.
      </p>
    </details>
  );
}
