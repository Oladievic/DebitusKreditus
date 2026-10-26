import { useCallback, useEffect, useRef, useState } from 'react';
import type { Preferences } from '../shared/types';
import { api } from './api';

export type PreferencesPersistenceStatus = 'loading' | 'saving' | 'saved' | 'error';
export const defaultPreferences: Preferences = {
  theme: 'light',
  accent: 'red',
  density: 'comfortable',
  reducedMotion: false,
  widgets: ['feed', 'applications', 'actions', 'simulator'],
  interests: ['growth', 'cashflow'],
};

interface Queue {
  userId: string;
  desired: Preferences;
  revision: number;
  savedRevision: number;
  ready: boolean;
  writing: boolean;
  pending: Promise<void> | null;
  cancelled: boolean;
  controller: AbortController | null;
}

export function usePreferences(userId: string | undefined) {
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [loadedUser, setLoadedUser] = useState<string | null>(null);
  const [persistenceStatus, setStatus] = useState<PreferencesPersistenceStatus>('loading');
  const [preferencesError, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const queue = useRef<Queue | null>(null);

  const drain = useCallback((state: Queue): Promise<void> => {
    if (state.writing) return state.pending ?? Promise.resolve();
    if (state.cancelled || !state.ready || state.savedRevision >= state.revision)
      return Promise.resolve();
    state.writing = true;
    const pending = (async () => {
      try {
        while (!state.cancelled && state.savedRevision < state.revision) {
          const revision = state.revision,
            snapshot = state.desired;
          const controller = new AbortController();
          state.controller = controller;
          setStatus('saving');
          setError('');
          const saved = await api<Preferences>('/preferences', {
            method: 'PATCH',
            body: JSON.stringify({ ...snapshot, expectedUserId: state.userId }),
            signal: controller.signal,
          });
          if (state.cancelled || queue.current !== state) return;
          state.savedRevision = revision;
          if (state.revision === revision) {
            state.desired = saved;
            setPreferences(saved);
            setStatus('saved');
            window.dispatchEvent(new Event('preferences-saved'));
          }
        }
      } catch (error) {
        if (!state.cancelled && queue.current === state) {
          setStatus('error');
          setError(`Изменения применены в этом окне, но не сохранены. ${(error as Error).message}`);
        }
      } finally {
        state.writing = false;
        state.pending = null;
      }
    })();
    state.pending = pending;
    return pending;
  }, []);

  useEffect(() => {
    setPreferences(defaultPreferences);
    setLoadedUser(null);
    setError('');
    setStatus('loading');
    if (!userId) {
      queue.current = null;
      return;
    }
    const controller = new AbortController();
    const state: Queue = {
      userId,
      desired: defaultPreferences,
      revision: 0,
      savedRevision: 0,
      ready: false,
      writing: false,
      pending: null,
      cancelled: false,
      controller,
    };
    queue.current = state;
    void api<Preferences>('/preferences', { signal: controller.signal })
      .then((saved) => {
        if (state.cancelled || queue.current !== state) return;
        state.desired = saved;
        state.ready = true;
        setPreferences(saved);
        setLoadedUser(userId);
        setStatus('saved');
      })
      .catch((error) => {
        if (!state.cancelled) {
          setError((error as Error).message);
          setStatus('error');
        }
      });
    return () => {
      state.cancelled = true;
      state.controller?.abort();
    };
  }, [userId, loadAttempt]);

  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) => {
      const state = queue.current;
      if (!state?.ready || state.cancelled) return;
      state.desired = { ...state.desired, ...patch };
      state.revision++;
      setPreferences(state.desired);
      setStatus('saving');
      setError('');
      void drain(state);
    },
    [drain],
  );

  const retryPreferences = useCallback(() => {
    const state = queue.current;
    if (state?.ready) void drain(state);
    else setLoadAttempt((value) => value + 1);
  }, [drain]);

  const flushPreferences = useCallback(async () => {
    const state = queue.current;
    if (!state?.ready || state.cancelled) return true;
    await drain(state);
    return queue.current === state && state.savedRevision === state.revision;
  }, [drain]);

  useEffect(() => {
    if (persistenceStatus !== 'saving' && persistenceStatus !== 'error') return;
    if (!queue.current?.ready || queue.current.revision <= queue.current.savedRevision) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [persistenceStatus]);

  return {
    preferences,
    preferencesReady: loadedUser === userId,
    updatePreferences,
    persistenceStatus,
    preferencesError,
    retryPreferences,
    flushPreferences,
  };
}
