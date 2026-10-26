import type { Hono } from 'hono';
import type { ApplicationDetail } from '../shared/types.js';
import type {
  LocalAIExplanation,
  LocalAIState,
  LocalAIStatus,
  LocalAITopic,
} from '../shared/local-ai.js';
import type { AppEnv } from './http-types.js';
import type { Database } from './db.js';
import { DomainError } from './domain.js';
import { detail } from './repository.js';
import { assistantBrief, materializeBrief, selectionSchema } from './assistant-brief.js';

const DEFAULT_MODEL = 'qwen3:0.6b';
const MODELS = new Set([DEFAULT_MODEL, 'qwen3:1.7b']);
const TOPICS: Record<LocalAITopic, string> = {
  overview: 'Объясни текущий этап заявки и причины уже рассчитанной оценки.',
  payment: 'Объясни нагрузку платежа по готовым цифрам и существующим условиям.',
  documents: 'Объясни, какие виды документов уже есть и какие запрошены.',
};
const LIMITS = {
  contextTokens: 2048,
  outputTokens: 128,
  timeoutSeconds: 90,
  concurrency: 1 as const,
};
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 4096;
const encoder = new TextEncoder();
type JsonObject = Record<string, unknown>;

export interface LocalAIService {
  status(): Promise<LocalAIStatus>;
  explain(
    facts: ApplicationDetail,
    topic: LocalAITopic,
    signal?: AbortSignal,
  ): Promise<LocalAIExplanation>;
}

interface RuntimeDependencies {
  fetch?: typeof fetch;
  freeMemory?: () => number;
  timeoutMs?: number;
  metadataTimeoutMs?: number;
}

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function status(
  state: LocalAIState,
  model: string | null,
  message: string,
  timeoutMs = 90000,
): LocalAIStatus {
  return {
    state,
    model,
    message,
    available: state === 'ready',
    runtime: state === 'cloud' ? 'cloud' : 'local',
    limits: { ...LIMITS, timeoutSeconds: Math.ceil(timeoutMs / 1000) },
  };
}

export const cloudLocalAIStatus = () =>
  status(
    'cloud',
    null,
    'Локальная модель доступна в кабинете, запущенном на вашем компьютере. В облачной версии расчёты и заявки работают без ИИ.',
  );

function unavailable(state: LocalAIState, model: string | null, message: string): LocalAIService {
  return {
    status: async () => status(state, model, message),
    explain: async () => {
      throw new DomainError('LOCAL_AI_UNAVAILABLE', message, 503);
    },
  };
}

export function localAIEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Некорректный LOCAL_AI_URL.');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost', 'host.docker.internal'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'LOCAL_AI_URL должен указывать на HTTP Ollama через loopback или host.docker.internal, без пути и авторизации.',
    );
  return url.origin;
}

async function readJson(response: Response, maximum: number): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new DomainError(
      'LOCAL_AI_HTTP',
      'Ollama не смогла выполнить запрос. Проверьте локальный сервис и модель.',
      503,
    );
  }
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel().catch(() => {});
    throw new DomainError(
      'LOCAL_AI_RESPONSE_LIMIT',
      'Ответ локальной модели превышает допустимый размер.',
      502,
    );
  }
  if (!response.body)
    throw new DomainError('LOCAL_AI_EMPTY', 'Локальная модель вернула пустой ответ.', 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum)
        throw new DomainError(
          'LOCAL_AI_RESPONSE_LIMIT',
          'Ответ локальной модели превышает допустимый размер.',
          502,
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DomainError(
      'LOCAL_AI_INVALID_RESPONSE',
      'Ollama вернула неожиданный ответ. Обновите локальный сервис и повторите запрос.',
      502,
    );
  }
}

export function explanationFacts(facts: ApplicationDetail) {
  const { application: a, assessment, documents, product } = facts;
  const decision = a.decision ?? assessment.decision;
  return {
    state: a.status,
    profileVersion: facts.organization.profile?.version ?? 1,
    product: product.name,
    requested: { amountRUB: a.amount, termMonths: a.termMonths },
    financesRUB: a.financials,
    score: {
      value: assessment.score.value,
      band: assessment.score.band,
      factors: assessment.score.factors
        .slice(0, 8)
        .map(({ label, points, detail: description }) => ({ label, points, description })),
    },
    decision: {
      outcome: decision.outcome,
      reasons: decision.reasons.slice(0, 6),
      requestedDocuments: decision.requestedDocuments.slice(0, 8),
      offer: decision.offer,
    },
    documentCategories: [...new Set(documents.map((d) => d.category))].slice(0, 12),
    scope:
      'Синтетические данные прототипа. Предварительная оценка не является решением реального банка. Подпись и выдача имитируются.',
  };
}

export function configureLocalAI(
  env: Record<string, string | undefined>,
  dependencies: RuntimeDependencies = {},
): LocalAIService {
  if (env.LOCAL_AI_ENABLED !== '1')
    return unavailable(
      'disabled',
      DEFAULT_MODEL,
      'Локальный помощник выключен. Включите его в настройках запуска компьютера; кабинет продолжает работать без модели.',
    );
  const model = env.LOCAL_AI_MODEL || DEFAULT_MODEL;
  let endpoint: string;
  try {
    endpoint = localAIEndpoint(env.LOCAL_AI_URL || 'http://127.0.0.1:11434');
    if (!MODELS.has(model))
      throw new Error('Поддерживаются только локальные qwen3:1.7b и qwen3:0.6b в Q4_K_M.');
  } catch (error) {
    return unavailable('config_error', null, (error as Error).message);
  }
  const transport = dependencies.fetch ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? 90000;
  const metadataTimeoutMs = dependencies.metadataTimeoutMs ?? 4000;
  let generating = false;
  let inspecting: Promise<LocalAIStatus> | null = null;
  const makeStatus = (state: LocalAIState, message: string) =>
    status(state, model, message, timeoutMs);

  const request = async (path: string, signal: AbortSignal, body?: unknown) => {
    const response = await transport(`${endpoint}/api/${path}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return object(await readJson(response, MAX_RESPONSE_BYTES));
  };
  const inspect = async (): Promise<LocalAIStatus> => {
    const signal = AbortSignal.timeout(metadataTimeoutMs);
    try {
      const tags = await request('tags', signal);
      const entry = (Array.isArray(tags.models) ? tags.models : [])
        .map(object)
        .find((m) => m.name === model || m.model === model);
      if (!entry)
        return makeStatus(
          'no_model',
          `Модель ${model} не установлена. Подготовьте её отдельно в Ollama и повторите проверку.`,
        );
      const shown = await request('show', signal, { model, verbose: false });
      const details = object(shown.details),
        info = object(shown.model_info),
        listedDetails = object(entry.details);
      const digest = typeof entry.digest === 'string' ? entry.digest : '';
      const size = typeof entry.size === 'number' ? entry.size : 0;
      const parameters = Number(info['general.parameter_count']);
      const smallerModel = model === 'qwen3:0.6b';
      if (
        !/^[a-f0-9]{64}$/.test(digest) ||
        size <= 0 ||
        size > (smallerModel ? 800_000_000 : 2_000_000_000) ||
        details.format !== 'gguf' ||
        details.family !== 'qwen3' ||
        listedDetails.family !== 'qwen3' ||
        details.quantization_level !== 'Q4_K_M' ||
        listedDetails.quantization_level !== 'Q4_K_M' ||
        !Number.isFinite(parameters) ||
        parameters <= 0 ||
        parameters > (smallerModel ? 900_000_000 : 2_100_000_000) ||
        !Array.isArray(shown.capabilities) ||
        !shown.capabilities.includes('completion') ||
        typeof shown.license !== 'string' ||
        !/Apache License[\s\S]*Version 2\.0/.test(shown.license) ||
        shown.remote_model ||
        shown.remote_host ||
        entry.remote_model ||
        entry.remote_host
      )
        return makeStatus(
          'unsupported_model',
          'Нужна локальная Qwen3 0.6B или 1.7B в формате GGUF Q4_K_M. Метаданные установленной модели не прошли проверку.',
        );
      const minimumFree = (model === 'qwen3:0.6b' ? 2 : 4) * 1024 ** 3;
      if (dependencies.freeMemory && dependencies.freeMemory() < minimumFree)
        return makeStatus(
          'low_memory',
          `Для этого профиля нужно не менее ${model === 'qwen3:0.6b' ? '2' : '4'} ГиБ свободной памяти перед запросом. Закройте лишние приложения и повторите проверку.`,
        );
      return {
        ...makeStatus(
          'ready',
          'Модель установлена на этом компьютере. Объяснение создаётся локально, по запросу.',
        ),
        modelInfo: { digest, sizeBytes: size, quantization: 'Q4_K_M', license: 'Apache-2.0' },
      };
    } catch {
      return makeStatus(
        'offline',
        'Ollama недоступна или не ответила вовремя. Запустите локальный сервис и повторите проверку.',
      );
    }
  };
  return {
    async status() {
      if (generating)
        return makeStatus(
          'busy',
          'Локальная модель уже готовит объяснение. Дождитесь завершения запроса.',
        );
      if (!inspecting)
        inspecting = inspect().finally(() => {
          inspecting = null;
        });
      return inspecting;
    },
    async explain(facts, topic, callerSignal) {
      if (generating)
        throw new DomainError(
          'LOCAL_AI_BUSY',
          'Локальная модель занята. Повторите запрос после завершения текущего.',
          429,
        );
      if (!Object.hasOwn(TOPICS, topic))
        throw new DomainError('INVALID_TOPIC', 'Выберите тему объяснения.', 400);
      if (callerSignal?.aborted)
        throw new DomainError('LOCAL_AI_CANCELLED', 'Запрос объяснения отменён.', 499);
      generating = true;
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
      try {
        const current = await inspect();
        if (!current.available)
          throw new DomainError('LOCAL_AI_UNAVAILABLE', current.message, 503, {
            state: current.state,
          });
        signal.throwIfAborted();
        const brief = assistantBrief(facts, topic);
        const schema = selectionSchema(brief);
        const source = JSON.stringify(brief);
        if (encoder.encode(source).byteLength > 6 * 1024)
          throw new DomainError(
            'LOCAL_AI_INPUT_LIMIT',
            'Слишком много данных для локального объяснения. Откройте заявку для просмотра полной оценки.',
            413,
          );
        const result = await request('generate', signal, {
          model,
          stream: false,
          think: false,
          keep_alive: 0,
          format: schema,
          system:
            'Выбери 1–3 самых полезных факта для предпринимателя по выбранной теме. Верни только JSON с полем selected: массив уникальных id из candidates. Сначала существенные ограничения, затем полезные цифры и следующий шаг. Не повторяй header и required: их покажут автоматически. Не сочиняй текст, числа или новые id. /no_think',
          prompt: `${TOPICS[topic]}\nПроверенные данные:\n${source}\nСхема ответа:\n${JSON.stringify(schema)}\nВерни JSON. /no_think`,
          options: {
            num_ctx: LIMITS.contextTokens,
            num_predict: LIMITS.outputTokens,
            num_gpu: 0,
            num_thread: 4,
            temperature: 0,
            top_p: 0.8,
            top_k: 20,
            seed: 42,
          },
        });
        const raw = typeof result.response === 'string' ? result.response.trim() : '';
        if (result.done !== true || result.done_reason === 'length' || !raw || raw.length > 2000)
          throw new DomainError(
            'LOCAL_AI_INVALID_RESPONSE',
            'Модель не вернула законченное объяснение. Попробуйте другую тему или повторите запрос.',
            502,
          );
        return {
          ...materializeBrief(brief, raw),
          method: 'verified-fact-selection-v1',
          model,
          modelDigest: current.modelInfo!.digest,
          topic,
          applicationId: facts.application.id,
          applicationVersion: facts.application.version,
          profileVersion: facts.organization.profile?.version ?? 1,
          assessmentVersion: facts.assessment.decision.ruleVersion,
          generatedAt: new Date().toISOString(),
          truncated: false,
        };
      } catch (error) {
        if (callerSignal?.aborted)
          throw new DomainError('LOCAL_AI_CANCELLED', 'Запрос объяснения отменён.', 499);
        if (timeout.aborted)
          throw new DomainError(
            'LOCAL_AI_TIMEOUT',
            'Модель не успела ответить за 90 секунд. Освободите память или выберите меньшую модель при следующем запуске.',
            504,
          );
        if (error instanceof DomainError) throw error;
        throw new DomainError(
          'LOCAL_AI_OFFLINE',
          'Соединение с локальной моделью прервалось. Проверьте Ollama и повторите запрос.',
          503,
        );
      } finally {
        generating = false;
      }
    },
  };
}

export function registerLocalAIRoutes(app: Hono<AppEnv>, db: Database, service?: LocalAIService) {
  app.get('/api/local-ai/status', async (c) =>
    c.json(service ? await service.status() : cloudLocalAIStatus()),
  );
  app.post('/api/local-ai/explain', async (c) => {
    const user = c.get('user');
    if (user.role !== 'client' && user.role !== 'bank')
      throw new DomainError('FORBIDDEN', 'Объяснение заявки доступно только её участникам.', 403);
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength > MAX_INPUT_BYTES)
      throw new DomainError('BODY_TOO_LARGE', 'Запрос объяснения слишком большой.', 413);
    const input = object(JSON.parse(new TextDecoder().decode(bytes)));
    if (
      Object.keys(input).some(
        (key) => !['applicationId', 'version', 'profileVersion', 'topic'].includes(key),
      ) ||
      typeof input.applicationId !== 'string' ||
      input.applicationId.length > 100 ||
      !Number.isSafeInteger(input.version) ||
      (input.profileVersion !== undefined &&
        (!Number.isSafeInteger(input.profileVersion) || Number(input.profileVersion) < 1)) ||
      typeof input.topic !== 'string' ||
      !Object.hasOwn(TOPICS, input.topic)
    )
      throw new DomainError(
        'INVALID_INPUT',
        'Нужны идентификатор, текущая версия заявки и тема объяснения.',
        400,
      );
    const facts = await detail(db, input.applicationId, user);
    if (
      facts.application.version !== input.version ||
      (input.profileVersion !== undefined &&
        input.profileVersion !== (facts.organization.profile?.version ?? 1))
    )
      throw new DomainError(
        'VERSION_CONFLICT',
        'Заявка изменилась. Обновите данные перед объяснением.',
        409,
      );
    if (!service) throw new DomainError('LOCAL_AI_UNAVAILABLE', cloudLocalAIStatus().message, 503);
    const result = await service.explain(facts, input.topic as LocalAITopic, c.req.raw.signal);
    const current = await detail(db, input.applicationId, user);
    if (
      current.application.version !== facts.application.version ||
      JSON.stringify(explanationFacts(current)) !== JSON.stringify(explanationFacts(facts))
    )
      throw new DomainError(
        'VERSION_CONFLICT',
        'Заявка или профиль бизнеса изменились во время объяснения. Обновите данные и повторите запрос.',
        409,
      );
    return c.json(result);
  });
}
