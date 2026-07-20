'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const TERMINAL_STATUSES = new Set(['READY', 'FAILED', 'SCRIPT_READY', 'DRAFT']);
const FALLBACK_POLL_MS = 10_000;

interface EpisodeStatusEvent {
  status: string;
  [key: string]: unknown;
}

interface UseEpisodeStatusOptions {
  /** Episode ID to watch */
  episodeId: string | null;
  /** Initial status (avoids an extra fetch) */
  initialStatus?: string;
  /** Called on every status change */
  onStatusChange?: (event: EpisodeStatusEvent) => void;
}

interface UseEpisodeStatusReturn {
  status: string | null;
  isConnected: boolean;
}

/**
 * Reconcile current status with a GET fetch.
 * SSE only carries { status } — clients that need failureReason, verificationProgress,
 * etc. get the full object from the cached GET endpoint.
 */
async function fetchCurrentStatus(
  episodeId: string,
  setStatus: (s: string) => void,
  onStatusChangeRef: React.RefObject<((event: EpisodeStatusEvent) => void) | undefined>
): Promise<string | null> {
  try {
    const res = await fetch(`/api/v1/episodes/${episodeId}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status) {
      setStatus(data.status);
      onStatusChangeRef.current?.(data);
      return data.status;
    }
  } catch {
    // Silently fail
  }
  return null;
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

  // Ref to track the single fallback interval so reconnects don't stack them
  const fallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearFallbackPolling = useCallback(() => {
    if (fallbackIntervalRef.current) {
      clearInterval(fallbackIntervalRef.current);
      fallbackIntervalRef.current = null;
    }
  }, []);

  const startFallbackPolling = useCallback(
    (id: string, signal: AbortSignal) => {
      // Clear any existing interval first — prevents stacking
      clearFallbackPolling();

      fallbackIntervalRef.current = setInterval(async () => {
        if (signal.aborted) {
          clearFallbackPolling();
          return;
        }
        if (document.visibilityState === 'hidden') return;

        const currentStatus = await fetchCurrentStatus(id, setStatus, onStatusChangeRef);
        if (currentStatus && TERMINAL_STATUSES.has(currentStatus)) {
          clearFallbackPolling();
        }
      }, FALLBACK_POLL_MS);

      signal.addEventListener('abort', clearFallbackPolling);
    },
    [clearFallbackPolling]
  );

  useEffect(() => {
    if (!episodeId) return;
    if (initialStatus && TERMINAL_STATUSES.has(initialStatus)) return;

    const abortController = new AbortController();
    const { signal } = abortController;

    if (typeof EventSource === 'undefined') {
      startFallbackPolling(episodeId, signal);
      return () => abortController.abort();
    }

    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (signal.aborted) return;

      // Clear stale reconnect timeout
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }

      es = new EventSource(`/api/v1/episodes/${episodeId}/stream`);

      es.onopen = () => {
        setIsConnected(true);
        // Stop fallback polling now that SSE is connected
        clearFallbackPolling();

        // Reconciliation fetch — catches any status change that happened
        // between the last known status and the subscription becoming active
        fetchCurrentStatus(episodeId!, setStatus, onStatusChangeRef).then((s) => {
          if (s && TERMINAL_STATUSES.has(s)) {
            es?.close();
            setIsConnected(false);
          }
        });
      };

      es.onmessage = (event) => {
        try {
          const data: EpisodeStatusEvent = JSON.parse(event.data);
          setStatus(data.status);

          // SSE only carries { status } — do a full GET to get failureReason etc.
          fetchCurrentStatus(episodeId!, setStatus, onStatusChangeRef).then((s) => {
            if (s && TERMINAL_STATUSES.has(s)) {
              es?.close();
              setIsConnected(false);
            }
          });
        } catch {
          // Ignore malformed SSE data
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        es?.close();
        es = null;

        if (!signal.aborted) {
          startFallbackPolling(episodeId!, signal);
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
        clearFallbackPolling();
      } else if (!signal.aborted) {
        connect();
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    connect();

    return () => {
      abortController.abort();
      es?.close();
      clearFallbackPolling();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      document.removeEventListener('visibilitychange', handleVisibility);
      setIsConnected(false);
    };
  }, [episodeId, initialStatus, startFallbackPolling, clearFallbackPolling]);

  return { status, isConnected };
}
