'use client';

import { useState, useTransition } from 'react';
import type { HealthData, CheckResult } from '@/lib/health';
import styles from './page.module.css';

function StatusDot({ status }: { status: string }) {
  const cls =
    status === 'ok' ? styles.statusOk :
    status === 'error' ? styles.statusError :
    status === 'degraded' ? styles.statusDegraded :
    styles.statusNotConfigured;
  return <span className={`${styles.statusDot} ${cls}`} aria-label={status} />;
}

function ServiceCard({ name, check }: { name: string; check: CheckResult }) {
  return (
    <div className={styles.serviceCard}>
      <div className={styles.serviceHeader}>
        <StatusDot status={check.status} />
        <span className={styles.serviceName}>{name}</span>
      </div>
      {check.latencyMs !== undefined && check.latencyMs > 0 && (
        <span className={styles.latency}>{check.latencyMs}ms</span>
      )}
      {check.detail && !check.detail.startsWith('{') && (
        <span className={styles.detail}>{check.detail}</span>
      )}
    </div>
  );
}

export function HealthDashboard({ initialData }: { initialData: HealthData }) {
  const [data, setData] = useState(initialData);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/health');
        const json = await res.json();
        setData(json);
      } catch {
        // Keep stale data on failure
      }
    });
  }

  // Parse queue data from the checks.queues.detail JSON
  const queueData: Record<string, { waiting: number; active: number; failed: number }> | null =
    data.checks.queues?.detail ? (() => { try { return JSON.parse(data.checks.queues.detail); } catch { return null; } })() : null;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>System Health</h1>
          <p className={styles.subtitle}>
            <StatusDot status={data.status === 'healthy' ? 'ok' : 'degraded'} />
            <span className={styles.statusLabel}>{data.status}</span>
            {' · '}
            <span className={styles.version}>{data.version}</span>
            {' · '}
            <time className={styles.timestamp}>{new Date(data.timestamp).toLocaleString()}</time>
          </p>
        </div>
        <button
          className={styles.refreshButton}
          onClick={refresh}
          disabled={isPending}
          type="button"
        >
          {isPending ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Services</h2>
        <div className={styles.grid}>
          {Object.entries(data.checks)
            .filter(([key]) => key !== 'queues')
            .map(([key, check]) => (
              <ServiceCard key={key} name={key} check={check} />
            ))}
        </div>
      </section>

      {queueData && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Queues</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Waiting</th>
                  <th>Active</th>
                  <th>Failed</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(queueData).map(([name, stats]) => (
                  <tr key={name} className={stats.failed > 0 ? styles.rowFailed : undefined}>
                    <td className={styles.mono}>{name}</td>
                    <td>{stats.waiting}</td>
                    <td>{stats.active}</td>
                    <td>{stats.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>OAuth Providers</h2>
        <div className={styles.grid}>
          {Object.entries(data.oauth).map(([provider, configured]) => (
            <div key={provider} className={styles.serviceCard}>
              <div className={styles.serviceHeader}>
                <StatusDot status={configured ? 'ok' : 'not_configured'} />
                <span className={styles.serviceName}>{provider}</span>
              </div>
            </div>
          ))}
          <div className={styles.serviceCard}>
            <div className={styles.serviceHeader}>
              <StatusDot status={data.vapid ? 'ok' : 'not_configured'} />
              <span className={styles.serviceName}>Web Push (VAPID)</span>
            </div>
          </div>
        </div>
      </section>

      {data.env && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Environment Variables</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Set</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.env).map(([key, set]) => (
                  <tr key={key}>
                    <td className={styles.mono}>{key}</td>
                    <td><StatusDot status={set ? 'ok' : 'not_configured'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
