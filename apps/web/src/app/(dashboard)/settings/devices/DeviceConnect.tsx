'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { generateQrDataUrl } from '@/lib/qr';
import styles from './page.module.css';

const REACH_URL_STORAGE_KEY = 'sotto.reachUrl';

interface PairingResult {
  connectUrl: string;
  serverUrl: string;
  qrDataUrl: string;
  expiresAt: string;
}

interface DeviceConnectProps {
  reachUrl?: string | null;
}

export function DeviceConnect({ reachUrl }: DeviceConnectProps) {
  const [pairing, setPairing] = useState<PairingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const storedReachUrl = window.localStorage.getItem(REACH_URL_STORAGE_KEY)?.trim();
      const configuredReachUrl =
        storedReachUrl && storedReachUrl.length > 0 ? storedReachUrl : reachUrl?.trim();
      const res = await fetch('/api/v1/auth/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configuredReachUrl ? { reachUrl: configuredReachUrl } : {}),
      });
      if (!res.ok) {
        setError('Could not create a pairing code. Try again.');
        return;
      }
      const data: { connectUrl: string; serverUrl: string; expiresAt: string } = await res.json();
      const qrDataUrl = await generateQrDataUrl(data.connectUrl);
      setPairing({ ...data, qrDataUrl });
    } catch {
      setError('Could not create a pairing code. Try again.');
    } finally {
      setLoading(false);
    }
  }, [reachUrl]);

  const copy = useCallback(async () => {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.connectUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [pairing]);

  return (
    <section className={styles.card} aria-labelledby="connect-heading">
      <h2 id="connect-heading" className={styles.srOnly}>
        Pairing code
      </h2>

      {pairing ? (
        <div className={styles.result}>
          <div className={styles.qrTile}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data-URL QR cannot be optimized by next/image */}
            <img
              src={pairing.qrDataUrl}
              alt="QR code to connect a device to this account"
              className={styles.qrImage}
              width={220}
              height={220}
            />
          </div>
          <p className={styles.serverUrl}>{pairing.serverUrl}</p>
          <p className={styles.expiry}>Expires {formatTime(pairing.expiresAt)}.</p>
          <div className={styles.actions}>
            <Button variant="secondary" size="small" onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button variant="ghost" size="small" onClick={generate} loading={loading}>
              New code
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.cta}>
          <p className={styles.ctaText}>
            Generate a one-time code, then scan it from the app on the device you want to add.
          </p>
          <Button onClick={generate} loading={loading} disabled={loading}>
            Show pairing code
          </Button>
        </div>
      )}
      {error && <p className={styles.errorText}>{error}</p>}
    </section>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
