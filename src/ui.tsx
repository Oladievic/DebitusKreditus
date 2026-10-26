import { ArrowUpRight, Check, ChevronRight, CircleHelp, LoaderCircle, RefreshCw, X } from './icons';
import { Link } from 'react-router-dom';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import type { ApplicationStatus } from '../shared/types';

export const statuses: Record<ApplicationStatus, { label: string; color: string; next: string }> = {
  draft: { label: 'Черновик', color: 'neutral', next: 'Проверьте данные и отправьте заявку' },
  submitted: { label: 'Заявка отправлена', color: 'blue', next: 'Сотрудник банка начнёт проверку' },
  in_review: { label: 'На рассмотрении', color: 'blue', next: 'Банк проверяет данные и условия' },
  needs_info: {
    label: 'Нужны сведения',
    color: 'amber',
    next: 'Дополните заявку по запросу банка',
  },
  approved: { label: 'Одобрено', color: 'green', next: 'Изучите условия и подтвердите согласие' },
  counter_offer: {
    label: 'Другие условия',
    color: 'violet',
    next: 'Банк предложил подходящие условия',
  },
  declined: { label: 'Не одобрено', color: 'red', next: 'Посмотрите причины решения' },
  accepted: { label: 'Условия приняты', color: 'blue', next: 'Ознакомьтесь с договором' },
  signed: { label: 'Документ подписан', color: 'green', next: 'Можно смоделировать выдачу' },
  funded: {
    label: 'Средства выданы',
    color: 'green',
    next: 'Документы и история доступны в заявке',
  },
};
export function Status({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`badge ${statuses[status].color}`}>
      <i />
      {statuses[status].label}
    </span>
  );
}
export function PageHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} />
      <span>Загружаем данные…</span>
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <CircleHelp size={26} />
      <h3>Не удалось загрузить данные</h3>
      <p>{message}</p>
      {retry && (
        <button className="button secondary" onClick={retry}>
          <RefreshCw size={16} />
          Повторить
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-orbit">
        <span />
        <span />
        <span />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function SectionHead({
  title,
  to,
  label = 'Все',
}: {
  title: string;
  to?: string;
  label?: string;
}) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {to && (
        <Link to={to} className="text-link">
          {label}
          <ChevronRight size={16} />
        </Link>
      )}
    </div>
  );
}
export function RouteTrack({
  status,
  large = false,
}: {
  status: ApplicationStatus;
  large?: boolean;
}) {
  const steps = ['Заявка', 'Проверка', 'Решение', 'Подписание', 'Выдача'];
  const current = ['draft'].includes(status)
    ? 0
    : ['submitted', 'in_review', 'needs_info'].includes(status)
      ? 1
      : ['approved', 'declined', 'counter_offer'].includes(status)
        ? 2
        : ['accepted', 'signed'].includes(status)
          ? 3
          : 4;
  return (
    <ol className={`route-track ${large ? 'large' : ''}`} aria-label="Этапы заявки">
      {steps.map((s, i) => (
        <li
          key={s}
          className={i < current ? 'done' : i === current ? 'current' : ''}
          aria-current={i === current ? 'step' : undefined}
        >
          <span className="route-dot">
            {i < current || (i === 4 && status === 'funded') ? <Check size={15} /> : i + 1}
          </span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}
export function Modal({
  title,
  children,
  close,
  initialFocusRef,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    initialFocusRef?.current?.focus({ preventScroll: true });
    return () => {
      element?.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={titleId}
      onCancel={close}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function CardLink({
  title,
  text,
  to,
  icon,
}: {
  title: string;
  text: string;
  to: string;
  icon: ReactNode;
}) {
  return (
    <Link to={to} className="card-link">
      {icon}
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <ArrowUpRight size={19} />
    </Link>
  );
}
