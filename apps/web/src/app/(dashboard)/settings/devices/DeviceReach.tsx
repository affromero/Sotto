'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Flag, QrCode as QrCodeIcon, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DeviceShare } from './DeviceShare';
import type { TailscaleReachStatus, TailscaleSetupResult } from '@/lib/tailscale-reach';
import styles from './page.module.css';

const REACH_URL_STORAGE_KEY = 'sotto.reachUrl';

type SetupPhase = 'idle' | 'checking' | 'setting-up';

/**
 * Reachability helper for getting a phone or tablet onto this self-hosted Sotto
 * server. Powered by sidedoor (thesidedoor): a same-network QR and share sheet,
 * with the internet-exposing tunnel options fenced behind a clear warning. The
 * QR URL defaults to this browser's current origin.
 */
interface DeviceReachProps {
  initialStatus: TailscaleReachStatus;
  canSetUp: boolean;
}

export function DeviceReach({ initialStatus, canSetUp }: DeviceReachProps) {
  const [status, setStatus] = useState(initialStatus);
  const [phase, setPhase] = useState<SetupPhase>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [enableUrl, setEnableUrl] = useState<string | null>(null);
  const ready = Boolean(status.serveConfigured && status.serveUrl);

  useEffect(() => {
    if (status.serveUrl) {
      window.localStorage.setItem(REACH_URL_STORAGE_KEY, status.serveUrl);
    } else {
      window.localStorage.removeItem(REACH_URL_STORAGE_KEY);
    }
  }, [status.serveUrl]);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const res = await fetch('/api/v1/system/tailscale', { cache: 'no-store' });
        if (!res.ok) return;
        const nextStatus = (await res.json()) as TailscaleReachStatus;
        if (active) setStatus(nextStatus);
      } catch {
        /* Keep the server-rendered status. */
      }
    }

    void refresh();
    return () => {
      active = false;
    };
  }, []);

  async function setUpTailscale() {
    setPhase('setting-up');
    setMessage('');
    setError('');
    setEnableUrl(null);

    try {
      const res = await fetch('/api/v1/system/tailscale', { method: 'POST' });
      const result = (await res.json()) as TailscaleSetupResult;
      setStatus(result.status);

      if (result.ok) {
        setMessage(result.message);
        return;
      }

      setError(result.message);
      setEnableUrl(result.enableUrl ?? null);
    } catch {
      setError('Could not set up Tailscale from the browser. Try again on this Mac.');
    } finally {
      setPhase('idle');
    }
  }

  async function refreshStatus() {
    setPhase('checking');
    setError('');
    setMessage('');

    try {
      const res = await fetch('/api/v1/system/tailscale', { cache: 'no-store' });
      if (!res.ok) {
        setError('Could not refresh Tailscale status.');
        return;
      }
      setStatus((await res.json()) as TailscaleReachStatus);
    } catch {
      setError('Could not refresh Tailscale status.');
    } finally {
      setPhase('idle');
    }
  }

  return (
    <div className={styles.reachStack}>
      <section className={styles.tailscaleCard} aria-label="Tailscale private URL status">
        <div className={styles.tailscaleHead}>
          <span
            className={ready ? styles.tailscaleReadyIcon : styles.tailscalePendingIcon}
            aria-hidden="true"
          >
            {ready ? <Flag size={16} /> : <ShieldAlert size={16} />}
          </span>
          <div className={styles.tailscaleTitleGroup}>
            <h3 className={styles.tailscaleTitle}>Tailscale browser URL</h3>
            <p className={styles.tailscaleText}>{statusMessage(status)}</p>
          </div>
        </div>

        {ready && status.serveUrl ? (
          <div className={styles.tailscaleLinkBox}>
            <CheckCircle2 size={18} aria-hidden="true" />
            <div className={styles.tailscaleLinkText}>
              <span className={styles.tailscaleLinkLabel}>Ready on your tailnet</span>
              <a href={status.serveUrl} className={styles.tailscaleLink}>
                {status.serveUrl}
              </a>
            </div>
          </div>
        ) : (
          <div className={styles.tailscaleSetup}>
            <p className={styles.tailscaleSetupText}>
              Sotto can set up Tailscale Serve for this Mac. If macOS needs permission, it will show
              the native administrator password prompt on this computer.
            </p>
            <div className={styles.tailscaleActions}>
              {canSetUp ? (
                <Button onClick={() => void setUpTailscale()} loading={phase === 'setting-up'}>
                  {phase === 'setting-up' ? 'Setting up Tailscale' : 'Set up Tailscale'}
                </Button>
              ) : (
                <p className={styles.tailscaleSetupText}>Ask an admin to set up Tailscale.</p>
              )}
              <Button
                variant="ghost"
                onClick={() => void refreshStatus()}
                loading={phase === 'checking'}
              >
                Refresh
              </Button>
            </div>
          </div>
        )}

        {message && (
          <p className={styles.successText} role="status">
            {message}
          </p>
        )}
        {(error || status.error) && (
          <p className={styles.errorText} role="alert">
            {error || status.error}
          </p>
        )}
        {enableUrl && (
          <a className={styles.inlineLink} href={enableUrl} target="_blank" rel="noreferrer">
            Enable Tailscale Serve
          </a>
        )}
      </section>

      {ready && status.serveUrl ? (
        <DeviceShare url={status.serveUrl} />
      ) : (
        <div className={styles.reachQrPlaceholder} role="status">
          <QrCodeIcon size={28} aria-hidden="true" />
          <span>Private QR code appears here after Tailscale is ready.</span>
        </div>
      )}
    </div>
  );
}

function statusMessage(status: TailscaleReachStatus): string {
  if (status.serveUrl)
    return 'Ready. This QR opens the web app; use Step 2 for native app pairing.';
  if (!status.installed) return 'Tailscale is not installed on this computer.';
  if (!status.running) return 'Tailscale is installed, but it is not running or signed in.';
  return 'Tailscale is running. Set up the private HTTPS URL to show the correct QR code.';
}
