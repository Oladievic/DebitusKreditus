import { useRef, useState } from 'react';
import { creditTerms, fieldGuide, type GuidedField } from '../shared/field-guide';
import './field-guide.css';

export function FieldLabel({
  id,
  label,
  field,
}: {
  id: string;
  label: string;
  field: GuidedField;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const guide = fieldGuide[field];
  return (
    <div
      className="field-guide"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <div className="field-guide-title">
        <label htmlFor={id}>{label}</label>
        <button
          ref={button}
          className="field-guide-toggle"
          type="button"
          aria-label={`Зачем: ${label}`}
          aria-expanded={open}
          aria-controls={`${id}-guide`}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true">?</span>
        </button>
      </div>
      <dl id={`${id}-guide`} className="field-guide-content" hidden={!open}>
        <div>
          <dt>Откуда берётся</dt>
          <dd>{guide.source}</dd>
        </div>
        <div>
          <dt>Зачем нужно</dt>
          <dd>{guide.purpose}</dd>
        </div>
        <div>
          <dt>Где используется</dt>
          <dd>{guide.stage}</dd>
        </div>
      </dl>
    </div>
  );
}

export function CreditTerms() {
  return (
    <details className="credit-terms">
      <summary>Как читать расчёт: платёж, проценты и денежный поток</summary>
      <dl>
        {creditTerms.map(([name, meaning]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
