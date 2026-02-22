'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './KittenHealthBanner.module.css';

type HealthStatus = 'checking' | 'ok' | 'loading' | 'unavailable';

interface HealthData {
  configured: boolean;
  status: string;
  model?: string;
  latencyMs?: number;
}

function StatusDot({ status }: { status: HealthStatus }) {
  return (
    <span
      className={`${styles.dot} ${styles[`dot_${status}`]}`}
      aria-hidden="true"
    />
  );
}

function statusLabel(data: HealthData | null, status: HealthStatus): string {
  if (status === 'checking') return 'Checking…';
  if (status === 'unavailable') return 'Service offline';
  if (status === 'loading') return 'Model loading…';
  if (status === 'ok' && data) {
    const parts = ['Online'];
    if (data.model) parts.push(data.model);
    if (data.latencyMs !== undefined) parts.push(`${data.latencyMs}ms`);
    return parts.join(' · ');
  }
  return 'Unknown';
}

export function KittenHealthBanner() {
  const [status, setStatus] = useState<HealthStatus>('checking');
  const [data, setData] = useState<HealthData | null>(null);
  // Ref so the Refresh button can trigger an immediate re-poll
  const triggerPoll = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/admin/kittentts/health');
        if (cancelled) return;
        const json = (await res.json()) as HealthData;
        if (cancelled) return;
        setData(json);
        if (!json.configured || json.status === 'unavailable') {
          setStatus('unavailable');
        } else if (json.status === 'ok') {
          setStatus('ok');
        } else {
          setStatus('loading');
        }
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    }

    triggerPoll.current = () => { void poll(); };
    poll();
    const id = setInterval(() => { poll(); }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function handleRefresh() {
    setStatus('checking');
    triggerPoll.current();
  }

  return (
    <div className={`${styles.banner} ${styles[`banner_${status}`]}`} role="status" aria-live="polite">
      <div className={styles.left}>
        <StatusDot status={status} />
        <span className={styles.label}>
          <span className={styles.prefix}>KittenTTS</span>
          {' '}
          {statusLabel(data, status)}
        </span>
      </div>
      <button
        type="button"
        className={styles.refreshButton}
        onClick={handleRefresh}
        disabled={status === 'checking'}
        aria-label="Refresh KittenTTS health status"
      >
        Refresh
      </button>
    </div>
  );
}
