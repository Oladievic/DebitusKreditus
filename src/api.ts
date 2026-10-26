import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'include', ...options, headers });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError('Нет соединения с сервисом. Проверьте сеть и повторите попытку.', 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      body?.error?.message || 'Не удалось выполнить запрос. Повторите попытку.',
      response.status,
      body?.error?.details,
    );
  if (body === null && response.status !== 204)
    throw new ApiError(
      'Сервис вернул неожиданный ответ. Обновите страницу и повторите попытку.',
      502,
    );
  return body as T;
}

export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useRef<{ sequence: number; controller: AbortController | null }>({
    sequence: 0,
    controller: null,
  });
  const lastRefresh = useRef(0);
  const refresh = useCallback(async () => {
    request.current.controller?.abort();
    const controller = new AbortController(),
      sequence = ++request.current.sequence;
    request.current.controller = controller;
    lastRefresh.current = Date.now();
    setError('');
    try {
      const result = await api<T>(path, { signal: controller.signal });
      if (sequence === request.current.sequence) setData(result);
    } catch (e) {
      if (sequence === request.current.sequence && (e as Error).name !== 'AbortError')
        setError((e as Error).message);
    } finally {
      if (sequence === request.current.sequence) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    setLoading(true);
    void refresh();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > 30000)
        void refresh();
    };
    const refreshPreferences = () => {
      if (path === '/feed' || path === '/dashboard') void refresh();
    };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('preferences-saved', refreshPreferences);
    return () => {
      request.current.sequence++;
      request.current.controller?.abort();
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('preferences-saved', refreshPreferences);
    };
  }, [refresh]);
  return { data, setData, error, loading, refresh };
}

export const money = (value: number, compact = false) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
    ...(compact ? { notation: 'compact' as const } : {}),
  }).format(value);
export const num = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
export const date = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(value));
export const rate = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value / 100) + '%';
export function download(name: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadExport(format: 'json' | 'csv') {
  let response: Response;
  try {
    response = await fetch(`/api/export?format=${format}`, { credentials: 'include' });
  } catch {
    throw new Error('Нет соединения с сервисом. Повторите скачивание после восстановления сети.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      body?.error?.message ?? 'Не удалось скачать файл. Повторите попытку.',
      response.status,
    );
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `debitus-export.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
