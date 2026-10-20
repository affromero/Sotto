'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PLAY_HOST_HEARTBEAT_MS, playPresenceViewSchema } from '@sotto/shared';
import { newPlayProof, playErrorMessage } from './api';
import { usePlayRequest } from './profile';

/** Every foreground entry owns a fresh nonce. Release fences delayed renewals on the server. */
export function useHostPresence(roomId: string, enabled: boolean) {
  const playFetch = usePlayRequest();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false,
      nonce: string | null = null;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const path = `/api/v1/play/rooms/${encodeURIComponent(roomId)}/presence`;
    const foreground = () => document.visibilityState === 'visible' && document.hasFocus();
    const renew = async () => {
      const viewNonce = nonce;
      if (!viewNonce || disposed || !foreground()) return;
      clearTimeout(timer);
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        await playFetch(path, playPresenceViewSchema, {
          body: { type: 'RENEW', viewNonce },
          signal: current.signal,
        });
        if (disposed || current.signal.aborted || nonce !== viewNonce) return;
        setReady(true);
        setError(null);
      } catch (caught) {
        if (disposed || current.signal.aborted || nonce !== viewNonce) return;
        setReady(false);
        setError(playErrorMessage(caught));
      }
      if (!disposed && !current.signal.aborted && nonce === viewNonce)
        timer = setTimeout(() => {
          void renew();
        }, PLAY_HOST_HEARTBEAT_MS);
    };
    const release = () => {
      clearTimeout(timer);
      controller?.abort();
      const viewNonce = nonce;
      nonce = null;
      if (!disposed) setReady(false);
      if (!viewNonce) return;
      void playFetch(path, playPresenceViewSchema, {
        body: { type: 'RELEASE', viewNonce },
        keepalive: true,
      }).catch((caught: unknown) => {
        if (!disposed && nonce === null) setError(playErrorMessage(caught));
      });
    };
    const enter = () => {
      if (!foreground()) {
        release();
        return;
      }
      if (nonce) return;
      nonce = newPlayProof();
      void renew();
    };
    refresh.current = renew;
    document.addEventListener('visibilitychange', enter);
    window.addEventListener('focus', enter);
    window.addEventListener('blur', release);
    window.addEventListener('pagehide', release);
    window.addEventListener('pageshow', enter);
    const initial = setTimeout(enter, 0);
    return () => {
      disposed = true;
      refresh.current = null;
      clearTimeout(initial);
      release();
      document.removeEventListener('visibilitychange', enter);
      window.removeEventListener('focus', enter);
      window.removeEventListener('blur', release);
      window.removeEventListener('pagehide', release);
      window.removeEventListener('pageshow', enter);
    };
  }, [roomId, enabled, playFetch]);
  const renewNow = useCallback(async () => {
    await refresh.current?.();
  }, []);
  return { ready: enabled && ready, error: enabled ? error : null, renewNow };
}
