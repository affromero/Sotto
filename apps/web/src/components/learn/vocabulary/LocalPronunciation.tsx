'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './LocalPronunciation.module.css';

export function LocalPronunciation({ endpoint }: { endpoint: string }) {
  const [status, setStatus] = useState<'idle' | 'preparing' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      audio.current?.pause();
    },
    [endpoint]
  );

  async function play() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setStatus('preparing');
    setError('');
    try {
      for (let attempt = 0; attempt < 60; attempt++) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retry: attempt === 0 && status === 'error' }),
          signal: controller.signal,
        });
        const body = (await response.json()) as { status?: string; error?: string };
        if (!response.ok || ['FAILED', 'UNRESOLVED'].includes(body.status ?? ''))
          throw new Error(
            body.error ?? 'Local pronunciation is unavailable. Check local speech in Settings.'
          );
        if (body.status === 'READY') {
          setStatus('ready');
          audio.current?.pause();
          const player = new Audio(endpoint);
          audio.current = player;
          await player.play();
          return;
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            controller.signal.removeEventListener('abort', abort);
            resolve();
          }, 1500);
          const abort = () => {
            clearTimeout(timer);
            reject(controller.signal.reason);
          };
          controller.signal.addEventListener('abort', abort, { once: true });
        });
      }
      throw new Error(
        'Local pronunciation is still preparing. Try again to check its saved status.'
      );
    } catch (cause) {
      if (!controller.signal.aborted) {
        setStatus('error');
        setError(
          cause instanceof Error ? cause.message : 'Playback failed. Try local pronunciation again.'
        );
      }
    }
  }
  return (
    <div className={styles.root}>
      <button
        type="button"
        disabled={status === 'preparing'}
        onClick={() => void play()}
        aria-label="Play local pronunciation"
      >
        {status === 'preparing'
          ? 'Preparing local audio…'
          : status === 'error'
            ? 'Retry local pronunciation'
            : 'Hear pronunciation'}
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
