import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavigatorAnalysis, NavigatorDraft } from '../shared/financing-intent';
import type { Product } from '../shared/types';
import { api, money } from './api';
import { ArrowRight, Check } from './icons';
import './financing-navigator.css';

export function FinancingNavigator({ products }: { products: Product[] }) {
  const navigate = useNavigate();
  const [request, setRequest] = useState('');
  const [analysis, setAnalysis] = useState<NavigatorAnalysis | null>(null);
  const [analysisText, setAnalysisText] = useState('');
  const [selection, setSelection] = useState({
    productId: '',
    amount: '',
    termMonths: '',
    purpose: '',
  });
  const [prepared, setPrepared] = useState<NavigatorDraft | null>(null);
  const [preparedKey, setPreparedKey] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const sequence = useRef(0);
  const selectionKey = JSON.stringify([request, selection, analysis?.profileVersion]);
  const current = !!analysis && analysisText === request;
  const ready = !!prepared && preparedKey === selectionKey && current && !busy && !failure;
  const product = products.find((item) => item.id === selection.productId);
  function change<K extends keyof typeof selection>(field: K, value: string) {
    setSelection((previous) => ({ ...previous, [field]: value }));
    setAgreed(false);
    setFailure('');
  }
  async function analyze() {
    const job = ++sequence.current;
    setBusy(true);
    setFailure('');
    setAgreed(false);
    setPrepared(null);
    try {
      const result = await api<NavigatorAnalysis>('/navigator/analyze', {
        method: 'POST',
        body: JSON.stringify({ request }),
      });
      if (job !== sequence.current) return;
      setAnalysis(result);
      setAnalysisText(request);
      setSelection({
        productId: result.intent.productId ?? '',
        amount: result.intent.amount === null ? '' : String(result.intent.amount),
        termMonths: String(result.intent.termMonths ?? result.suggestedTermMonths),
        purpose: result.intent.request,
      });
    } catch (error) {
      if (job === sequence.current) setFailure((error as Error).message);
    } finally {
      if (job === sequence.current) setBusy(false);
    }
  }
  async function prepare() {
    if (!analysis || !current) return;
    const job = ++sequence.current;
    setBusy(true);
    setFailure('');
    setAgreed(false);
    setPrepared(null);
    setPreparedKey('');
    try {
      const result = await api<NavigatorDraft>('/navigator/prepare', {
        method: 'POST',
        body: JSON.stringify({
          ...selection,
          amount: Number(selection.amount),
          termMonths: Number(selection.termMonths),
          expectedProfileVersion: analysis.profileVersion,
        }),
      });
      if (job === sequence.current) {
        setPrepared(result);
        setPreparedKey(selectionKey);
      }
    } catch (error) {
      if (job === sequence.current) setFailure((error as Error).message);
    } finally {
      if (job === sequence.current) setBusy(false);
    }
  }
  function openDraft() {
    if (!ready || !agreed || !prepared) return;
    const draft = prepared.draft;
    navigate(
      `/applications/new?product=${encodeURIComponent(draft.productId)}&amount=${draft.amount}&term=${draft.termMonths}`,
      { state: { scenarioFinancials: draft.financials, navigatorPurpose: draft.purpose } },
    );
  }
  return (
    <section
      className="surface financing-navigator"
      id="financing-navigator"
      aria-labelledby="financing-navigator-title"
    >
      <div className="navigator-heading">
        <div>
          <h2 id="financing-navigator-title">Начните с вашей задачи</h2>
          <p>
            Опишите, на что нужны деньги. Разберём сумму, срок и цель — вы проверите каждый параметр
            до создания заявки.
          </p>
        </div>
        <span className="navigator-sign" aria-hidden="true">
          ↗
        </span>
      </div>
      <label htmlFor="financing-request">Что планируете сделать</label>
      <textarea
        id="financing-request"
        aria-label="Задача для кредитного навигатора"
        placeholder="Нужно 3 миллиона на трактор на 3 года"
        maxLength={500}
        rows={3}
        value={request}
        disabled={busy}
        onChange={(e) => {
          setRequest(e.target.value);
          setAgreed(false);
          setFailure('');
        }}
      />
      <div className="navigator-request-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy || request.trim().length < 3}
          onClick={() => void analyze()}
        >
          {busy ? 'Проверяем…' : 'Разобрать задачу'}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            setRequest('Нужно 3 миллиона на покупку оборудования на 3 года');
            setAgreed(false);
          }}
        >
          Пример запроса
        </button>
        <small>Разбор по открытым правилам. Работает без модели.</small>
      </div>
      {failure && (
        <p className="form-error" role="alert">
          {failure}
        </p>
      )}
      {analysis && !current && (
        <p className="navigator-notice" role="status">
          Запрос изменился. Разберите его заново, чтобы параметры соответствовали тексту.
        </p>
      )}
      {analysis && current && (
        <div className="navigator-review">
          <h3>Проверьте, правильно ли поняли</h3>
          {analysis.intent.questions.length > 0 && (
            <ul className="navigator-questions">
              {analysis.intent.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          )}
          <div className="navigator-fields">
            <label>
              Продукт
              <select
                aria-label="Продукт навигатора"
                disabled={busy}
                value={selection.productId}
                onChange={(e) => change('productId', e.target.value)}
              >
                <option value="">Выберите главную цель</option>
                {products.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <small>
                {analysis.intent.evidence.goal.length
                  ? `В запросе: «${analysis.intent.evidence.goal.join(', ')}»`
                  : 'Цель требует вашего выбора'}
              </small>
            </label>
            <label>
              Сумма, ₽
              <input
                aria-label="Сумма навигатора"
                type="number"
                min={product?.minAmount ?? 1}
                max={product?.maxAmount ?? 30000000}
                step="1"
                inputMode="numeric"
                disabled={busy}
                value={selection.amount}
                onChange={(e) => change('amount', e.target.value)}
              />
              <small>
                {analysis.intent.evidence.amount
                  ? `В запросе: «${analysis.intent.evidence.amount}»`
                  : 'Введите одну сумму в целых рублях'}
              </small>
            </label>
            <label>
              Срок, месяцев
              <input
                aria-label="Срок навигатора"
                type="number"
                min={product?.minTerm ?? 1}
                max={product?.maxTerm ?? 60}
                step="1"
                disabled={busy}
                value={selection.termMonths}
                onChange={(e) => change('termMonths', e.target.value)}
              />
              <small>
                {analysis.intent.evidence.term
                  ? `В запросе: «${analysis.intent.evidence.term}»`
                  : 'Предзаполнено из вашего профиля, проверьте срок'}
              </small>
            </label>
          </div>
          <label>
            Цель для анкеты
            <textarea
              aria-label="Цель кредита из навигатора"
              rows={2}
              maxLength={500}
              disabled={busy}
              value={selection.purpose}
              onChange={(e) => change('purpose', e.target.value)}
            />
          </label>
          {product && (
            <p className="navigator-product-context">
              {product.description} Диапазон: {money(product.minAmount)} —{' '}
              {money(product.maxAmount)}, {product.minTerm}–{product.maxTerm} месяцев.
            </p>
          )}
          {analysis.recommendation &&
            selection.productId === analysis.recommendation.product.id &&
            Number(selection.amount) === analysis.recommendation.proposedAmount &&
            Number(selection.termMonths) === analysis.recommendation.proposedTermMonths && (
              <details className="navigator-reasons">
                <summary>Почему этот продукт подходит к задаче</summary>
                {analysis.recommendation.reasons.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
                {analysis.recommendation.blockers.map((reason) => (
                  <p key={reason}>Нужно учесть: {reason}</p>
                ))}
                {analysis.recommendation.cautions.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
                <p>
                  Подбор не является решением банка. Финансовые данные профиля — на{' '}
                  {analysis.financialsAsOf}.
                </p>
              </details>
            )}
          <button
            className="button secondary"
            type="button"
            disabled={
              busy ||
              !selection.productId ||
              !selection.amount ||
              !selection.termMonths ||
              selection.purpose.trim().length < 3
            }
            onClick={() => void prepare()}
          >
            Проверить параметры черновика
          </button>
          {prepared && !ready && (
            <p className="navigator-notice" role="status">
              Параметры изменились — проверьте расчёт ещё раз.
            </p>
          )}
          {ready && prepared && (
            <div className="navigator-prepared">
              <div className="navigator-ready-title">
                <Check size={20} />
                <b>Параметры проверены</b>
              </div>
              <dl>
                <div>
                  <dt>Сумма</dt>
                  <dd>{money(prepared.draft.amount)}</dd>
                </div>
                <div>
                  <dt>Платёж в месяц</dt>
                  <dd>{money(prepared.calculation.monthlyPayment)}</dd>
                </div>
                <div>
                  <dt>Проценты за весь срок</dt>
                  <dd>{money(prepared.calculation.totalInterest)}</dd>
                </div>
              </dl>
              {prepared.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={agreed}
                  disabled={busy}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                Проверил продукт, сумму, срок и назначение кредита
              </label>
              <button
                type="button"
                className="button primary"
                disabled={!agreed || busy}
                onClick={openDraft}
              >
                Открыть заполненную анкету
                <ArrowRight size={17} />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
