'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const TERMINAL_STATUSES = new Set(['READY', 'FAILED', 'SCRIPT_READY', 'DRAFT']);
const FALLBACK_POLL_MS = 10_000;

interface PodcastStatusEvent {
  status: string;
  [key: string]: unknown;
}

interface UsePodcastStatusOptions {
  /** Podcast ID to watch */
  podcastId: string | null;
  /** Initial status (avoids an extra fetch) */
  initialStatus?: string;
  /** Called on every status change */
  onStatusChange?: (event: PodcastStatusEvent) => void;
}

interface UsePodcastStatusReturn {
  status: string | null;
  isConnected: boolean;
}

export function usePodcastStatus({
  podcastId,
  initialStatus,
  onStatusChange,
}: UsePodcastStatusOptions): UsePodcastStatusReturn {
  const [status, setStatus] = useState<string | null>(initialStatus ?? null);
  const [isConnected, setIsConnected] = useState(false);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; });

  const pollFallback = useCallback(async (id: string, signal: AbortSignal) => {
    const interval = setInterval(async () => {
      if (signal.aborted) {
        clearInterval(interval);
        return;
      }
      // Pause polling when tab is hidden
      if (document.visibilityState === 'hidden') return;

      try {
        const res = await fetch(`/api/podcasts/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status) {
          setStatus(data.status);
          onStatusChangeRef.current?.({ status: data.status });
          if (TERMINAL_STATUSES.has(data.status)) {
            clearInterval(interval);
          }
        }
      } catch {
        // Silently retry next interval
      }
    }, FALLBACK_POLL_MS);

    signal.addEventListener('abort', () => clearInterval(interval));
  }, []);

  useEffect(() => {
    if (!podcastId) return;
    if (initialStatus && TERMINAL_STATUSES.has(initialStatus)) return;

    const abortController = new AbortController();
    const { signal } = abortController;

    if (typeof EventSource === 'undefined') {
      pollFallback(podcastId, signal);
      return () => abortController.abort();
    }

    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (signal.aborted) return;

      es = new EventSource(`/api/podcasts/${podcastId}/stream`);

      es.onopen = () => {
        setIsConnected(true);
      };

      es.onmessage = (event) => {
        try {
          const data: PodcastStatusEvent = JSON.parse(event.data);
          setStatus(data.status);
          onStatusChangeRef.current?.(data);

          if (TERMINAL_STATUSES.has(data.status)) {
            es?.close();
            setIsConnected(false);
          }
        } catch {
          // Ignore malformed SSE data
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        es?.close();
        es = null;

        if (!signal.aborted) {
          // Fall back to polling, then try SSE again after 10s
          pollFallback(podcastId!, signal);
          reconnectTimeout = setTimeout(connect, 10_000);
        }
      };
    }

    // Pause SSE when tab goes hidden, reconnect when visible
    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        es?.close();
        es = null;
        setIsConnected(false);
      } else if (!signal.aborted) {
        connect();
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    connect();

    return () => {
      abortController.abort();
      es?.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      document.removeEventListener('visibilitychange', handleVisibility);
      setIsConnected(false);
    };
  }, [podcastId, initialStatus, pollFallback]);

  return { status, isConnected };
}
