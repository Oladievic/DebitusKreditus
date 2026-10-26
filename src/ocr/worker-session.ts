type Progress = { status: string; progress: number };
type Packet = { jobId: string; status: 'resolve' | 'reject' | 'progress'; data: unknown };
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class OcrWorkerSession {
  private readonly worker: Worker;
  private readonly jobs = new Map<string, Pending>();
  private closed = false;
  private sequence = 0;

  // Pinned Tesseract 7 worker protocol keeps the native handle available before initialization.
  constructor(private readonly report: (progress: Progress) => void) {
    this.worker = new Worker('/ocr/worker.min.js', { name: 'debitus-local-ocr' });
    this.worker.onmessage = (event: MessageEvent<Packet>) => {
      const packet = event.data;
      const job = this.jobs.get(packet.jobId);
      if (!job || this.closed) return;
      if (packet.status === 'progress') {
        this.report(packet.data as Progress);
        return;
      }
      if (packet.status === 'reject') {
        this.terminate(
          new Error(
            'Модуль распознавания не смог загрузить или обработать данные. Проверьте доступность файлов сайта и повторите попытку.',
          ),
        );
        return;
      }
      clearTimeout(job.timer);
      this.jobs.delete(packet.jobId);
      job.resolve(packet.data);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.terminate(
        new Error(
          'Модуль распознавания завершился с ошибкой. Проверьте соединение с кабинетом и повторите попытку.',
        ),
      );
    };
    this.worker.onmessageerror = () =>
      this.terminate(
        new Error('Не удалось получить ответ модуля распознавания. Повторите попытку.'),
      );
  }

  private request(
    action: string,
    payload: unknown,
    timeout: number,
    transfer: Transferable[] = [],
  ) {
    if (this.closed)
      return Promise.reject(new DOMException('Распознавание остановлено.', 'AbortError'));
    const jobId = `ocr-${++this.sequence}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.terminate(
            new Error(
              'Превышено время ожидания распознавания. Попробуйте меньший файл или проверьте соединение с кабинетом.',
            ),
          ),
        timeout,
      );
      this.jobs.set(jobId, { resolve, reject, timer });
      try {
        this.worker.postMessage({ workerId: 'debitus-ocr', jobId, action, payload }, transfer);
      } catch {
        this.terminate(new Error('Не удалось передать страницу модулю распознавания.'));
      }
    });
  }

  async initialize() {
    const deadline = setTimeout(
      () =>
        this.terminate(
          new Error(
            'Модуль распознавания не загрузился за 60 секунд. Проверьте соединение с кабинетом и повторите попытку.',
          ),
        ),
      60_000,
    );
    try {
      await this.request(
        'load',
        {
          options: {
            lstmOnly: true,
            corePath: new URL('/ocr/core', location.origin).href,
            logging: false,
          },
        },
        60_000,
      );
      await this.request(
        'loadLanguage',
        {
          langs: ['rus', 'eng'],
          options: {
            langPath: new URL('/ocr/lang', location.origin).href,
            cacheMethod: 'write',
            gzip: true,
            lstmOnly: true,
          },
        },
        60_000,
      );
      await this.request('initialize', { langs: ['rus', 'eng'], oem: 1, config: {} }, 60_000);
      await this.request(
        'setParameters',
        { params: { tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' } },
        60_000,
      );
    } finally {
      clearTimeout(deadline);
    }
  }

  async recognize(canvas: HTMLCanvasElement): Promise<string> {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error('Не удалось подготовить изображение страницы.')),
        'image/png',
      ),
    );
    const buffer = await blob.arrayBuffer();
    const result = (await this.request(
      'recognize',
      { image: new Uint8Array(buffer), options: {}, output: { text: true } },
      120_000,
      [buffer],
    )) as { text?: string };
    return result.text ?? '';
  }

  terminate(error: Error = new DOMException('Распознавание остановлено.', 'AbortError')) {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    this.jobs.clear();
  }
}
