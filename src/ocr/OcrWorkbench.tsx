import { useEffect, useRef, useState } from 'react';
import type { Financials } from '../../shared/types';
import { api, download } from '../api';
import { ArrowDownToLine, FileSearch, Upload } from '../icons';
import { Modal } from '../ui';
import { financialLabels, OCR_LIMITS } from './fields';
import { recognizeDocument, type OcrProgress, type OcrResult } from './engine';
import { reconcileOcr, selectedOcrFinancials, valuesFromOcr } from './reconciliation';
import './ocr.css';

export interface ReviewedOcr extends OcrResult {
  reviewed: true;
}
export async function saveReviewedOcr(
  applicationId: string,
  version: number,
  category: string,
  result: ReviewedOcr,
) {
  const { preview: _preview, ...body } = result;
  return api(`/applications/${applicationId}/documents/ocr`, {
    method: 'POST',
    body: JSON.stringify({ ...body, version, category }),
  });
}

export function OcrWorkbench({
  applicationId,
  version,
  category = 'financials',
  onSaved,
  onApply,
  currentFinancials,
  label = 'Распознать документ',
}: {
  applicationId?: string;
  version?: number;
  category?: string;
  onSaved?: () => void | Promise<void>;
  onApply?: (values: Partial<Financials>, result: ReviewedOcr) => void;
  currentFinancials?: Financials;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [text, setText] = useState('');
  const [values, setValues] = useState<Partial<Record<keyof Financials, string>>>({});
  const [selected, setSelected] = useState<Partial<Record<keyof Financials, boolean>>>({});
  const [reviewed, setReviewed] = useState(false);
  const [destinationCategory, setDestinationCategory] = useState(category);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const job = useRef(0);
  useEffect(
    () => () => {
      job.current++;
      controller.current?.abort();
    },
    [],
  );
  const reconciliation = reconcileOcr(text, currentFinancials, values, result?.text ?? text);
  const formatAmount = (amount: number | null) =>
    amount === null ? '—' : `${new Intl.NumberFormat('ru-RU').format(amount)} ₽`;
  function stop() {
    job.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setProgress(null);
    setMessage('Распознавание остановлено. Результат не сохранён.');
  }
  function close() {
    if (saving) return;
    stop();
    setOpen(false);
  }
  async function recognize(file: File) {
    controller.current?.abort();
    const current = ++job.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setMessage('');
    setResult(null);
    setText('');
    setReviewed(false);
    setSelected({});
    setValues({});
    try {
      const output = await recognizeDocument(file, abort.signal, (value) => {
        if (job.current === current) setProgress(value);
      });
      if (job.current !== current) return;
      setResult(output);
      setText(output.text);
      setValues(valuesFromOcr(output.text));
    } catch (failure) {
      if (job.current === current && !abort.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Не удалось распознать файл. Проверьте соединение с кабинетом и попробуйте снова.',
        );
    } finally {
      if (job.current === current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }
  async function confirm() {
    if (!result || !reviewed || !text.trim()) return;
    setError('');
    let financials: Partial<Financials>;
    try {
      financials = onApply ? selectedOcrFinancials(values, selected) : {};
    } catch (failure) {
      setError((failure as Error).message);
      return;
    }
    const checked: ReviewedOcr = { ...result, text: text.trim(), reviewed: true };
    if (onApply) {
      onApply(financials, checked);
      close();
      return;
    }
    if (!applicationId || version === undefined) return;
    setSaving(true);
    try {
      await saveReviewedOcr(applicationId, version, destinationCategory, checked);
      await onSaved?.();
      setOpen(false);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          setOpen(true);
          setMessage('');
        }}
      >
        <FileSearch size={18} />
        {label}
      </button>
      {open && (
        <Modal title="Распознавание документа" close={close}>
          <div className="ocr-workbench">
            <ol className="ocr-steps">
              <li>Файл на устройстве</li>
              <li>Проверка текста и сумм</li>
              <li>Ваше подтверждение</li>
            </ol>
            <p className="ocr-intro">
              Русский и английский текст распознаются на CPU вашего устройства. Файл не отправляется
              внешним ИИ-сервисам. Сохранение в кабинет — только после проверки.
            </p>
            <div className="ocr-pick">
              <label className={`button secondary file-button ${busy || saving ? 'disabled' : ''}`}>
                <Upload size={18} />
                {result ? 'Выбрать другой файл' : 'Выбрать PDF или снимок'}
                <input
                  aria-label="Файл для распознавания"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  disabled={busy || saving}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void recognize(file);
                    event.target.value = '';
                  }}
                />
              </label>
              <span>До 10 МиБ · PDF до 5 страниц · PNG/JPEG до 24 Мп</span>
              <a href="/fixtures/financial-scan.png" download className="text-link">
                Скачать пример скана
                <ArrowDownToLine size={15} />
              </a>
            </div>
            {busy && (
              <div className="ocr-progress" role="status">
                <b>{progress?.label ?? 'Подготавливаем файл'}</b>
                <progress max="1" value={progress?.progress ?? 0} aria-label="Ход распознавания" />
                <p>
                  Первый запуск загружает языковые файлы с этого сайта. На больших страницах
                  обработка может занять больше времени.
                </p>
                <button type="button" className="button secondary" onClick={stop}>
                  Остановить распознавание
                </button>
              </div>
            )}
            {message && (
              <p role="status" className="ocr-note">
                {message}
              </p>
            )}
            {error && (
              <p role="alert" className="inline-alert">
                {error}
              </p>
            )}
            {result && !busy && (
              <>
                <div className="ocr-source">
                  <strong>{result.sourceName}</strong>
                  <span>Страниц: {result.pages} · сохранится проверенная текстовая копия</span>
                </div>
                <div className="ocr-review">
                  <figure>
                    <img
                      src={result.preview}
                      alt="Первая страница выбранного документа для сверки"
                    />
                    <figcaption>
                      Сверьте текст с оригиналом. Для PDF показана первая страница; текст содержит
                      все {result.pages}.
                    </figcaption>
                  </figure>
                  <label>
                    Распознанный текст
                    <textarea
                      aria-label="Распознанный текст"
                      value={text}
                      maxLength={OCR_LIMITS.text}
                      disabled={saving}
                      onChange={(event) => {
                        setText(event.target.value);
                        setValues(valuesFromOcr(event.target.value));
                        setSelected({});
                        setReviewed(false);
                        setError('');
                      }}
                      rows={12}
                    />
                    <small>
                      После изменения текста суммы извлекаются заново, выбор полей и подтверждение
                      сбрасываются. Проверьте результат ещё раз.
                    </small>
                  </label>
                </div>
                <fieldset className="ocr-fields">
                  <legend>
                    {onApply ? 'Сверка и перенос показателей' : 'Сверка с данными заявки'}
                  </legend>
                  <p>
                    Сравниваем три месячных показателя с анкетой. Пропуск не считается нулём.
                    Годовые суммы, тысячи и миллионы автоматически не пересчитываются.
                    {onApply
                      ? ' В заявку попадут только отмеченные вами суммы после подтверждения.'
                      : ' Сохранение текстовой копии не меняет финансовые данные заявки.'}
                  </p>
                  {reconciliation.map((row) => {
                    const field = row.field;
                    const statusLabel = {
                      matches: 'Совпадает',
                      differs: 'Отличается',
                      missing: 'Не найдено',
                      ambiguous: 'Нужно уточнить',
                      unavailable: 'Нет значения анкеты',
                    }[row.status];
                    return (
                      <div key={field} className="ocr-reconciliation-row" data-ocr-field={field}>
                        <div className="ocr-reconciliation-heading">
                          <strong>{financialLabels[field]}</strong>
                          <span className={`ocr-comparison-status ${row.status}`}>
                            {statusLabel}
                            {row.manuallyEdited ? ' · ручная правка' : ''}
                          </span>
                        </div>
                        <dl className="ocr-comparison-values">
                          <div>
                            <dt>В анкете</dt>
                            <dd>{formatAmount(row.current)}</dd>
                          </div>
                          <div>
                            <dt>Из проверяемого текста</dt>
                            <dd>{formatAmount(row.recognized)}</dd>
                          </div>
                          {row.manuallyEdited && (
                            <div>
                              <dt>Проверяемая сумма после правки</dt>
                              <dd>{formatAmount(row.effective)}</dd>
                            </div>
                          )}
                        </dl>
                        {onApply && (
                          <div className="ocr-field">
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={!!selected[field]}
                                disabled={saving}
                                onChange={(event) => {
                                  setSelected({ ...selected, [field]: event.target.checked });
                                  setReviewed(false);
                                }}
                              />
                              {financialLabels[field]}
                            </label>
                            <input
                              aria-label={`Распознанная сумма: ${financialLabels[field]}`}
                              type="text"
                              inputMode="numeric"
                              value={values[field] ?? ''}
                              placeholder="Введите после сверки"
                              disabled={saving}
                              onChange={(event) => {
                                setValues({ ...values, [field]: event.target.value });
                                setReviewed(false);
                                setError('');
                              }}
                            />
                          </div>
                        )}
                        {row.originalSource && (
                          <p className="ocr-evidence">
                            Исходная строка OCR: <q>{row.originalSource}</q>
                          </p>
                        )}
                        {row.source && row.source !== row.originalSource && (
                          <p className="ocr-evidence">
                            Строка после правки текста: <q>{row.source}</q>
                          </p>
                        )}
                        <p className="ocr-reconciliation-hint">{row.hint}</p>
                      </div>
                    );
                  })}
                  {!reconciliation.some((row) => row.recognized !== null) && (
                    <p className="ocr-note">
                      Однозначных месячных сумм нет. Если текст нечитаем, загрузите полный PDF или
                      чёткий снимок без обрезанных строк. Если документ читается, уточните период и
                      единицы вручную.
                    </p>
                  )}
                  <p className="ocr-reconciliation-hint">
                    Это сопоставление текста с вашей анкетой. Проверка по ФНС и другим реестрам
                    здесь не выполняется; процент достоверности не рассчитывается.
                  </p>
                </fieldset>
                <p className="ocr-note">
                  Распознавание не подтверждает подлинность документа. Оригинал можно отдельно
                  прикрепить обычной загрузкой, если он не превышает 1 МиБ.
                </p>
                {!onApply && (
                  <label>
                    Категория текстовой копии
                    <select
                      aria-label="Категория OCR-документа"
                      value={destinationCategory}
                      disabled={saving}
                      onChange={(event) => setDestinationCategory(event.target.value)}
                    >
                      <option value="financials">Финансовая отчётность</option>
                      <option value="statement">Выписка по счёту</option>
                      <option value="invoice">Счёт на оборудование</option>
                      <option value="other">Дополнительный документ</option>
                    </select>
                  </label>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(event) => setReviewed(event.target.checked)}
                    disabled={saving}
                  />
                  Я сверил(а) текст{onApply ? ' и выбранные суммы' : ''} с оригиналом
                </label>
                <div className="ocr-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={!reviewed || !text.trim() || saving}
                    onClick={() => void confirm()}
                  >
                    {saving
                      ? 'Сохраняем…'
                      : onApply
                        ? 'Применить к черновику'
                        : 'Сохранить текст в заявку'}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!reviewed || saving}
                    onClick={() =>
                      download(
                        `${result.sourceName.replace(/\.[^.]+$/, '')}-проверенный-текст.txt`,
                        text,
                        'text/plain;charset=utf-8',
                      )
                    }
                  >
                    Скачать TXT
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
