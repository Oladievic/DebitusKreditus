import { useEffect, useState } from 'react';
import { ArrowRight, Check, FileText, Building2, Scale } from './icons';
import { useSurfacePointer } from './useSurfacePointer';

export function CapitalScene({
  phase = 0,
  motion = true,
  compact = false,
}: {
  phase?: number;
  motion?: boolean;
  compact?: boolean;
}) {
  const root = useSurfacePointer<HTMLDivElement>(motion, compact ? 9 : 15);
  const [visible, setVisible] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const update = () => setTabVisible(!document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
            rootMargin: '120px 0px',
            threshold: 0,
          });
    if (root.current) observer?.observe(root.current);
    if (!observer) setVisible(true);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [root]);

  return (
    <div
      ref={root}
      className={`v3-capital-scene capital-v4 ${compact ? 'is-compact' : ''} ${motion && visible && tabVisible ? 'is-moving' : ''}`}
      data-phase={phase}
      aria-hidden="true"
    >
      <div className="capital-light-field" />
      <div className="capital-ground">
        <span />
        <span />
        <span />
      </div>
      <div className="capital-object v3-file-object">
        <div className="capital-plane capital-request">
          <div className="capital-plane-edge" />
          <div className="capital-plane-surface">
            <div className="capital-plane-heading">
              <FileText />
              <span>Заявка</span>
              <b>01</b>
            </div>
            <div className="capital-request-body">
              <span className="capital-micro">Оборотные средства</span>
              <strong>
                1 200 000<span>₽</span>
              </strong>
              <div className="capital-amount-line" />
              <p>
                Материалы
                <br />
                для нового заказа
              </p>
              <div className="capital-request-term">
                <span>Срок</span>
                <b>24 месяца</b>
              </div>
            </div>
            <div className="capital-plane-footer">
              <span>Сумма. Срок. Цель.</span>
              <ArrowRight />
            </div>
            <div className="capital-glint" />
          </div>
        </div>
        <div className="capital-plane capital-profile">
          <div className="capital-plane-edge" />
          <div className="capital-plane-surface">
            <div className="capital-plane-heading">
              <Building2 />
              <span>Данные бизнеса</span>
              <b>02</b>
            </div>
            <div className="capital-profile-body v3-paper-details">
              <p>
                Видеть
                <br />
                полную картину.
              </p>
              <div className="capital-columns">
                <span style={{ height: '100%' }} />
                <span style={{ height: '68.75%' }} />
                <span style={{ height: '5%' }} />
              </div>
              <div className="capital-column-labels">
                <span>Доходы</span>
                <span>Расходы</span>
                <span>Долг</span>
              </div>
              <div className="capital-documents">
                <span>
                  <Check />
                  Выписка по счёту
                </span>
                <span>
                  <Check />
                  Отчётность
                </span>
              </div>
            </div>
            <div className="capital-plane-footer">
              <span>Финансовый профиль</span>
              <ArrowRight />
            </div>
            <div className="capital-glint" />
          </div>
        </div>
        <div className="capital-plane capital-decision">
          <div className="capital-plane-edge" />
          <div className="capital-plane-surface">
            <div className="capital-plane-heading">
              <Scale />
              <span>Решение</span>
              <b>03</b>
            </div>
            <div className="capital-decision-body v3-outcome-map">
              <p>
                Причина.
                <br />
                Условия.
                <br />
                Следующий шаг.
              </p>
              <div className="capital-outcomes">
                {['Одобрение', 'Другие условия', 'Нужны сведения', 'Отказ с причиной'].map(
                  (label, index) => (
                    <div key={label}>
                      <i data-outcome={index} />
                      <span>{label}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
            <div className="capital-plane-footer">
              <span>Четыре возможных исхода</span>
              <ArrowRight />
            </div>
            <div className="capital-glint" />
          </div>
        </div>
        <div className="capital-connection capital-connection-one" />
        <div className="capital-connection capital-connection-two" />
      </div>
      <div className="capital-axis">
        <span>
          <i />
          Заявка
        </span>
        <b />
        <span>
          <i />
          Данные
        </span>
        <b />
        <span>
          <i />
          Решение
        </span>
      </div>
      <div className="v3-flow-trace capital-light-pass" />
    </div>
  );
}
