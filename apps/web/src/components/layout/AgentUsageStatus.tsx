'use client';

import Link from 'next/link';
import { AlertTriangle, Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentUsageProvider, AgentUsageStatus as AgentUsagePayload } from '@/lib/agent-usage';
import styles from './AgentUsageStatus.module.css';

interface AgentUsageStatusProps {
  enabled: boolean;
}

function providerDisplayName(provider: AgentUsageProvider): string {
  return provider.planLabel ? `${provider.planLabel} ${provider.shortLabel}` : provider.shortLabel;
}

function shouldShowProvider(provider: AgentUsageProvider): boolean {
  return (
    provider.limitReached ||
    provider.status === 'ready' ||
    provider.status === 'unavailable' ||
    provider.windows.length > 0 ||
    provider.credits !== null
  );
}

function creditsLabel(provider: AgentUsageProvider): string | null {
  if (!provider.credits) return null;
  if (provider.credits.unlimited) return 'Credits unlimited';
  if (provider.credits.balance) return `Credits $${provider.credits.balance}`;
  return null;
}

export function AgentUsageStatus({ enabled }: AgentUsageStatusProps) {
  const [payload, setPayload] = useState<AgentUsagePayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;

    let disposed = false;
    const loadUsage = async () => {
      try {
        const response = await fetch('/api/v1/agent-usage', { cache: 'no-store' });
        if (disposed) return;
        if (!response.ok) {
          setFailed(true);
          return;
        }
        setPayload((await response.json()) as AgentUsagePayload);
        setFailed(false);
      } catch {
        if (!disposed) setFailed(true);
      }
    };

    const initialTimer = window.setTimeout(() => void loadUsage(), 0);
    const refreshTimer = window.setInterval(() => void loadUsage(), 60_000);

    return () => {
      disposed = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
    };
  }, [enabled]);

  if (!enabled) return null;

  const providers = payload?.providers.filter(shouldShowProvider) ?? [];
  if (!failed && providers.length === 0) return null;

  return (
    <section className={styles.root} aria-label="Agent usage status">
      <div className={styles.header}>
        <span className={styles.title}>
          <Clock3 className={styles.titleIcon} aria-hidden="true" />
          Agent time
        </span>
        <Link href="/settings" className={styles.settingsLink}>
          Hide
        </Link>
      </div>

      {failed ? (
        <div className={styles.unavailable}>
          <AlertTriangle className={styles.unavailableIcon} aria-hidden="true" />
          Usage status is unavailable.
        </div>
      ) : (
        providers.map((provider) => (
          <div key={provider.id} className={styles.provider}>
            <div className={styles.providerTop}>
              <span className={styles.providerName}>{providerDisplayName(provider)}</span>
              {provider.limitReached ? <span className={styles.limitReached}>Limited</span> : null}
            </div>

            {provider.windows.length > 0 ? (
              <div className={styles.windows}>
                {provider.windows.map((window) => (
                  <div key={`${provider.id}-${window.label}`} className={styles.windowRow}>
                    <span className={styles.windowLabel}>{window.label}</span>
                    <meter
                      className={styles.meter}
                      min={0}
                      max={100}
                      low={50}
                      high={80}
                      optimum={0}
                      value={window.usedPercent}
                      aria-label={`${provider.shortLabel} ${window.label} ${window.usedPercent}% used`}
                    />
                    <span className={styles.windowReset}>
                      {window.usedPercent}% {window.resetIn ? `(${window.resetIn})` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.unavailable}>
                <AlertTriangle className={styles.unavailableIcon} aria-hidden="true" />
                {provider.detail}
              </div>
            )}

            {creditsLabel(provider) ? (
              <span className={styles.credits}>{creditsLabel(provider)}</span>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}
