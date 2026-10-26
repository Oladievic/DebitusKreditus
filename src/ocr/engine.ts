import { boundedCanvas, imageDimensions, OCR_LIMITS } from './fields';
import { OcrWorkerSession } from './worker-session';

export interface OcrResult {
  text: string;
  pages: number;
  sourceName: string;
  sourceSha256: string;
  sourceSize: number;
  sourceMimeType: string;
  engine: 'tesseract.js@7.0.0';
  preview: string;
}
export interface OcrProgress {
  label: string;
  progress: number;
  page: number;
  pages: number;
}
const aborted = () => new DOMException('Распознавание остановлено.', 'AbortError');

export async function recognizeDocument(
  file: File,
  signal: AbortSignal,
  report: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  if (!file.size || file.size > OCR_LIMITS.bytes)
    throw new Error('Выберите непустой файл размером до 10 МиБ.');
  if (signal.aborted) throw aborted();
  let worker: OcrWorkerSession | undefined;
  let terminatePdf: (() => Promise<void>) | undefined;
  let renderCancel: (() => void) | undefined;
  let pageNumber = 0;
  let pageCount = 1;
  let rejectAbort: (error: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    renderCancel?.();
    void worker?.terminate();
    void terminatePdf?.();
    rejectAbort(aborted());
  };
  signal.addEventListener('abort', cancel, { once: true });
  const check = () => {
    if (signal.aborted) throw aborted();
  };
  const run = async (): Promise<OcrResult> => {
    report({ label: 'Проверяем файл', progress: 0, page: 0, pages: 1 });
    const buffer = await file.arrayBuffer();
    check();
    const bytes = new Uint8Array(buffer);
    const isPdf = new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
    const sourceSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
    let mime = 'application/pdf';
    let getCanvas: (page: number) => Promise<HTMLCanvasElement>;
    if (isPdf) {
      const pdfjs = await import('pdfjs-dist');
      check();
      pdfjs.GlobalWorkerOptions.workerSrc = '/ocr/pdf/pdf.worker.min.mjs';
      const loading = pdfjs.getDocument({
        data: bytes,
        maxImageSize: OCR_LIMITS.sourcePixels,
        canvasMaxAreaInBytes: OCR_LIMITS.canvasPixels * 4,
        cMapUrl: '/ocr/pdf/cmaps/',
        standardFontDataUrl: '/ocr/pdf/standard_fonts/',
        wasmUrl: '/ocr/pdf/wasm/',
        iccUrl: '/ocr/pdf/iccs/',
        stopAtErrors: true,
      });
      terminatePdf = () => loading.destroy();
      const pdf = await loading.promise;
      check();
      pageCount = pdf.numPages;
      if (pageCount > OCR_LIMITS.pages)
        throw new Error('В PDF больше 5 страниц. Сохраните нужные страницы отдельным файлом.');
      getCanvas = async (number) => {
        const page = await pdf.getPage(number);
        check();
        const base = page.getViewport({ scale: 2.5 });
        const bounds = boundedCanvas(base.width, base.height);
        const viewport = page.getViewport({ scale: (2.5 * bounds.width) / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = bounds.width;
        canvas.height = bounds.height;
        const task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport });
        renderCancel = () => task.cancel();
        await task.promise;
        renderCancel = undefined;
        page.cleanup();
        return canvas;
      };
    } else {
      const dimensions = imageDimensions(bytes);
      mime = dimensions.mime;
      if (
        dimensions.width * dimensions.height > OCR_LIMITS.sourcePixels ||
        Math.max(dimensions.width, dimensions.height) > 12000
      )
        throw new Error(
          'Изображение слишком большое: максимум 24 мегапикселя и 12 000 пикселей по стороне. Уменьшите его перед распознаванием.',
        );
      getCanvas = async () => {
        const bitmap = await createImageBitmap(file);
        try {
          check();
          const bounds = boundedCanvas(bitmap.width, bitmap.height);
          const canvas = document.createElement('canvas');
          Object.assign(canvas, bounds);
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          return canvas;
        } finally {
          bitmap.close();
        }
      };
    }
    report({
      label: 'Загружаем локальный модуль распознавания',
      progress: 0.03,
      page: 0,
      pages: pageCount,
    });
    check();
    worker = new OcrWorkerSession(({ status, progress }) => {
      if (signal.aborted) return;
      const recognizing = status === 'recognizing text';
      report({
        label: recognizing
          ? `Распознаём страницу ${pageNumber} из ${pageCount}`
          : 'Подготавливаем русский и английский языки',
        progress: recognizing ? 0.15 + 0.8 * ((pageNumber - 1 + progress) / pageCount) : 0.07,
        page: pageNumber,
        pages: pageCount,
      });
    });
    await worker.initialize();
    check();
    const parts: string[] = [];
    let preview = '';
    for (pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      check();
      const canvas = await getCanvas(pageNumber);
      try {
        check();
        if (pageNumber === 1) preview = canvas.toDataURL('image/jpeg', 0.65);
        const recognized = await worker.recognize(canvas);
        check();
        parts.push(
          pageCount > 1 ? `Страница ${pageNumber}\n${recognized.trim()}` : recognized.trim(),
        );
        if (parts.join('\n\n').length > OCR_LIMITS.text)
          throw new Error(
            'Результат превышает 100 000 символов. Разделите документ на меньшие части.',
          );
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    const text = parts.join('\n\n').trim();
    if (text.replace(/Страница \d+/g, '').trim().length < 3)
      throw new Error(
        'Текст не найден. Попробуйте более чёткий снимок без бликов или загрузите оригинал обычным способом.',
      );
    report({ label: 'Распознавание завершено', progress: 1, page: pageCount, pages: pageCount });
    return {
      text,
      pages: pageCount,
      sourceName: file.name,
      sourceSha256,
      sourceSize: file.size,
      sourceMimeType: mime,
      engine: 'tesseract.js@7.0.0',
      preview,
    };
  };
  try {
    return await Promise.race([run(), cancelled]);
  } catch (error) {
    if (signal.aborted) throw aborted();
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('PDF защищён паролем. Сохраните доступную копию без пароля.');
    if (error instanceof Error && /^[А-ЯЁ]/.test(error.message)) throw error;
    throw new Error(
      'Не удалось обработать документ. Проверьте, что файл открывается, и соединение с кабинетом доступно для загрузки локального модуля. Попробуйте другой PDF или чёткий снимок.',
    );
  } finally {
    signal.removeEventListener('abort', cancel);
    await worker?.terminate();
    await terminatePdf?.();
  }
}
