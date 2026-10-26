import { num } from './api';
import './financial-value-source.css';

export function FinancialValueSource({
  label,
  value,
  applicationVersion,
  updatedAt,
}: {
  label: string;
  value: number;
  applicationVersion: number;
  updatedAt: string;
}) {
  const date = new Date(updatedAt);
  const updated = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow',
      }).format(date)
    : 'дата не сохранена';
  return (
    <details className="financial-value-source">
      <summary aria-label={`${label}: ${num(value)} рублей. Показать источник`}>
        {num(value)} ₽<span aria-hidden="true">?</span>
      </summary>
      <div>
        <b>Текущая анкета · версия {applicationVersion}</b>
        <p>Сохранение версии: {updated}.</p>
        <p>
          Сведения владельца, не подтверждённые внешним источником. Перенос из OCR или CSV отдельно
          не отслеживается; одинаковая сумма не доказывает происхождение.
        </p>
      </div>
    </details>
  );
}
