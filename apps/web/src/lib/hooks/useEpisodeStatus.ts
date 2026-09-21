'use client';

import { useState, useEffect, useRef } from 'react';

const TERMINAL_STATUSES = new Set(['READY', 'FAILED', 'SCRIPT_READY', 'DRAFT']);
const FALLBACK_POLL_MS = 10_000;

interface EpisodeStatusEvent {
  status: string;
  [key: string]: unknown;
}

interface UseEpisodeStatusOptions {
  episodeId: string | null;
  initialStatus?: string;
  onStatusChange?: (event: EpisodeStatusEvent) => void;
}

interface UseEpisodeStatusReturn {
  status: string | null;
  isConnected: boolean;
}

export function useEpisodeStatus({
  episodeId,
  initialStatus,
  onStatusChange,
}: UseEpisodeStatusOptions): UseEpisodeStatusReturn {
  const [status, setStatus] = useState<string | null>(initialStatus ?? null);
  const [isConnected, setIsConnected] = useState(false);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  });

  useEffect(() => {
    setStatus(episodeId ? (initialStatus ?? null) : null);
    setIsConnected(false);
    if (!episodeId || (initialStatus && TERMINAL_STATUSES.has(initialStatus))) return;
    const id = episodeId;
    const controller = new AbortController();
    const { signal } = controller;
    let sequence = 0;
    let terminal = false;
    let pollingRequest = false;
    let connection: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    const invalidations = new Set<string>();

    function clearPolling() {
      if (poll) clearInterval(poll);
      poll = null;
    }

    function clearReconnect() {
      if (reconnect) clearTimeout(reconnect);
      reconnect = null;
    }

    function stopConnection() {
      connection?.close();
      connection = null;
      setIsConnected(false);
    }

    async function reconcile(source?: EventSource): Promise<boolean> {
      const request = ++sequence;
      let applied = false;
      const current = () =>
        !signal.aborted && !terminal && request === sequence && (!source || source === connection);
      try {
        const response = await fetch(`/api/v1/episodes/${id}`, { signal });
        if (!response.ok || !current()) return false;
        const data: unknown = await response.json();
        if (
          !current() ||
          !data ||
          typeof data !== 'object' ||
          !('status' in data) ||
          typeof data.status !== 'string'
        )
          return false;
        setStatus(data.status);
        applied = true;
        if (TERMINAL_STATUSES.has(data.status)) {
          terminal = true;
          clearPolling();
          clearReconnect();
          stopConnection();
        }
        onStatusChangeRef.current?.(data as EpisodeStatusEvent);
        return true;
      } catch {
        return applied;
      }
    }

    function startPolling() {
      clearPolling();
      if (signal.aborted || terminal) return;
      poll = setInterval(() => {
        if (document.visibilityState === 'hidden' || pollingRequest) return;
        pollingRequest = true;
        void reconcile().finally(() => {
          pollingRequest = false;
        });
      }, FALLBACK_POLL_MS);
    }

    function connect() {
      clearReconnect();
      if (signal.aborted || terminal || connection || document.visibilityState === 'hidden') return;
      if (typeof EventSource === 'undefined') {
        startPolling();
        return;
      }
      const source = new EventSource(`/api/v1/episodes/${id}/stream`);
      connection = source;
      const active = () => !signal.aborted && !terminal && source === connection;
      source.onopen = () => {
        if (!active()) return;
        setIsConnected(true);
        clearPolling();
        void reconcile(source);
      };
      source.onmessage = (event) => {
        if (!active()) return;
        try {
          const data: unknown = JSON.parse(event.data);
          if (!data || typeof data !== 'object') return;
          let operationId: string | undefined;
          if ('kind' in data && data.kind === 'episode-invalidated') {
            if (
              !('episodeId' in data) ||
              data.episodeId !== id ||
              !('operationId' in data) ||
              typeof data.operationId !== 'string' ||
              !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
                data.operationId
              )
            )
              return;
            operationId = data.operationId;
            if (invalidations.has(operationId)) return;
            invalidations.add(operationId);
            if (invalidations.size > 100)
              invalidations.delete(invalidations.values().next().value!);
          } else {
            if (!('status' in data) || typeof data.status !== 'string') return;
            setStatus(data.status);
          }
          void reconcile(source).then((applied) => {
            if (!applied && operationId) invalidations.delete(operationId);
          });
        } catch {
          // Ignore malformed SSE data.
        }
      };
      source.onerror = () => {
        if (!active()) return;
        ++sequence;
        stopConnection();
        startPolling();
        clearReconnect();
        reconnect = setTimeout(connect, FALLBACK_POLL_MS);
      };
    }

    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        ++sequence;
        stopConnection();
        clearPolling();
        clearReconnect();
      } else connect();
    }

    document.addEventListener('visibilitychange', handleVisibility);
    connect();
    return () => {
      controller.abort();
      connection?.close();
      clearPolling();
      clearReconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [episodeId, initialStatus]);

  return { status, isConnected };
}
