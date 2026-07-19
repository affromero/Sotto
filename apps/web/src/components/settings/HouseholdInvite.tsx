'use client';

import { useEffect, useState } from 'react';
import styles from './HouseholdInvite.module.css';

interface InvitePayload {
  inviteUrl: string;
  qrDataUrl: string;
  expiresAt: string;
}

/**
 * Owner-only card: a link + QR that opens the access gate for family members
 * without sharing the password. Tokens are signed and expire on their own, so
 * minting a fresh one is free.
 */
export function HouseholdInvite() {
  const [invite, setInvite] = useState<InvitePayload | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    setError(false);
    try {
      const res = await fetch('/api/v1/gate/invite');
      if (!res.ok) throw new Error(String(res.status));
      setInvite((await res.json()) as InvitePayload);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function copy() {
    if (!invite) return;
    await navigator.clipboard.writeText(invite.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className={styles.root} aria-labelledby="household-invite-title">
      <h2 id="household-invite-title" className={styles.title}>
        Invite your household
      </h2>
      <p className={styles.description}>
        Anyone with this link or QR code can open this Sotto without the access password, then pick
        or create their profile. It expires in 7 days — share it like the password itself.
      </p>

      {error ? (
        <p className={styles.error}>
          Could not create an invite.{' '}
          <button className={styles.retry} type="button" onClick={load}>
            Try again
          </button>
        </p>
      ) : invite ? (
        <div className={styles.inviteRow}>
          {/* Data-URL PNG from our own QR generator; next/image adds nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.qr} src={invite.qrDataUrl} alt="Invite QR code" />
          <div className={styles.linkColumn}>
            <code className={styles.link}>{invite.inviteUrl}</code>
            <div className={styles.actions}>
              <button className={styles.copy} type="button" onClick={copy}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button className={styles.refresh} type="button" onClick={load}>
                New invite
              </button>
            </div>
            <p className={styles.expiry}>
              Valid until {new Date(invite.expiresAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      ) : (
        <p className={styles.loading}>Creating invite…</p>
      )}
    </section>
  );
}
