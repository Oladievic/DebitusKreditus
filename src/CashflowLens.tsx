import { useState } from 'react';
import { money } from './api';

export function CashflowLens({
  revenue,
  expenses,
  debt,
}: {
  revenue: number;
  expenses: number;
  debt: number;
}) {
  const [selected, setSelected] = useState(2);
  const free = revenue - expenses - debt;
  const total = Math.max(revenue, expenses + debt, 1);
  const segments = [
    {
      title: 'Операционные расходы',
      value: expenses,
      className: 'expense',
      description: 'Расходы на работу бизнеса до платежей по кредитам.',
    },
    {
      title: 'Действующие платежи',
      value: debt,
      className: 'debt',
      description: 'Ежемесячные платежи по существующим обязательствам.',
    },
    {
      title: 'Свободный поток',
      value: free,
      className: 'free',
      description:
        free < 0
          ? 'Расходы и действующие платежи превышают выручку.'
          : 'Остаётся после расходов и действующих платежей, до нового кредита.',
    },
  ];
  return (
    <div className="cash-lens">
      <div className="cash-lens-bars" role="group" aria-label="Структура денежного потока">
        {segments.map((item, i) => (
          <button
            key={item.title}
            className={`cash-lens-bar ${item.className} ${selected === i ? 'is-selected' : ''}`}
            aria-label={`${item.title}: ${money(item.value)}`}
            aria-pressed={selected === i}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') setSelected(i);
            }}
            onFocus={() => setSelected(i)}
            onClick={() => setSelected(i)}
          >
            <span style={{ height: `${(Math.max(0, item.value) / total) * 100}%` }} />
            <i />
          </button>
        ))}
      </div>
      <div className={`cash-lens-readout ${segments[selected].className}`} aria-live="polite">
        <span>{segments[selected].title}</span>
        <strong>{money(segments[selected].value)}</strong>
        <p>{segments[selected].description}</p>
      </div>
    </div>
  );
}
