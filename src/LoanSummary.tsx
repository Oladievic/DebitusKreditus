import { useId } from 'react';
import type { Offer } from '../shared/types';
import { buildLoanSummary } from '../shared/loan-summary';
import './loan-summary.css';

export function LoanSummary({
  offer,
  title = 'Главное в условиях',
}: {
  offer: Offer;
  title?: string;
}) {
  const titleId = useId();
  return (
    <section className="loan-summary" aria-labelledby={titleId}>
      <div className="loan-summary-heading">
        <h3 id={titleId}>{title}</h3>
        <p>Проверьте эти условия перед подтверждением.</p>
      </div>
      <dl className="loan-summary-grid">
        {buildLoanSummary(offer).map((item) => (
          <div className={`loan-summary-item loan-summary-${item.id}`} key={item.id}>
            <dt>{item.title}</dt>
            <dd>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
