'use client';

import { useEffect, useState } from 'react';
import { playErrorMessage } from './api';

export function usePlayPoll(load: (signal: AbortSignal) => Promise<unknown>, interval = 2000) {
  const [connection, setConnection] = useState<
    'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'PAUSED'
  >('CONNECTING');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false,
      failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    const stop = () => {
      clearTimeout(timer);
      controller?.abort();
      controller = null;
    };
    const run = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      controller = new AbortController();
      const current = controller;
      try {
        await load(current.signal);
        if (current.signal.aborted || stopped) return;
        failures = 0;
        setConnection('CONNECTED');
        setError(null);
      } catch (caught) {
        if (current.signal.aborted || stopped) return;
        failures++;
        setConnection('RECONNECTING');
        setError(playErrorMessage(caught));
      }
      if (!stopped && !current.signal.aborted)
        timer = setTimeout(
          () => {
            void run();
          },
          Math.min(30_000, interval * 2 ** Math.min(failures, 4))
        );
    };
    const resume = () => {
      stop();
      if (document.visibilityState !== 'visible') {
        setConnection('PAUSED');
        return;
      }
      setConnection('CONNECTING');
      void run();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    resume();
    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [load, interval]);
  return { connection, error };
}
