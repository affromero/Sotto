'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

interface Invitation {
  id: string;
  code: string;
  email: string | null;
  enabled: boolean;
  usedAt: string | null;
  expiresAt: string;
  createdAt: string;
  status: string;
  creator: { name: string | null; email: string };
}

interface InvitationLinksProps {
  initialInvitations: Invitation[];
}

export function InvitationLinks({ initialInvitations }: InvitationLinksProps) {
  const router = useRouter();
  const [invitations, setInvitations] = useState(initialInvitations);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch('/api/admin/invitations', { method: 'POST' });
      if (!res.ok) return;
      const data = await res.json();
      await navigator.clipboard.writeText(data.url);
      setCopied(data.invitation.id);
      setTimeout(() => setCopied(null), 2000);
      router.refresh();
      // Optimistically add to list
      setInvitations((prev) => [{ ...data.invitation, status: 'active', creator: { name: null, email: '' } }, ...prev]);
    } finally {
      setGenerating(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    const res = await fetch('/api/admin/invitations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setInvitations((prev) =>
      prev.map((inv) => (inv.id === id ? { ...inv, enabled: data.invitation.enabled, status: data.invitation.status } : inv))
    );
  }

  async function handleCopyUrl(code: string, id: string) {
    const baseUrl = window.location.origin;
    await navigator.clipboard.writeText(`${baseUrl}/invite/${code}`);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const statusClass: Record<string, string> = {
    active: styles.invStatusActive,
    used: styles.invStatusUsed,
    expired: styles.invStatusExpired,
    disabled: styles.invStatusDisabled,
  };

  return (
    <div className={styles.invitationSection}>
      <div className={styles.invHeader}>
        <h2 className={styles.invTitle}>Invitation Links</h2>
        <button
          className={styles.generateBtn}
          onClick={handleGenerate}
          disabled={generating}
          type="button"
        >
          {generating ? 'Generating...' : 'Generate Link'}
        </button>
      </div>

      {invitations.length === 0 ? (
        <p className={styles.invEmpty}>No invitation links yet.</p>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Status</th>
                <th>Redeemed By</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td className={styles.emailCell}>{inv.code}</td>
                  <td>
                    <span className={statusClass[inv.status] ?? styles.invStatusActive}>
                      {inv.status}
                    </span>
                  </td>
                  <td className={styles.twitterCell}>{inv.email ?? ''}</td>
                  <td className={styles.dateCell}>
                    {new Date(inv.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className={styles.dateCell}>
                    {new Date(inv.expiresAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        className={styles.copyBtn}
                        onClick={() => handleCopyUrl(inv.code, inv.id)}
                        type="button"
                      >
                        {copied === inv.id ? 'Copied!' : 'Copy URL'}
                      </button>
                      {inv.status === 'active' && (
                        <button
                          className={styles.rejectBtn}
                          onClick={() => handleToggle(inv.id, false)}
                          type="button"
                        >
                          Disable
                        </button>
                      )}
                      {inv.status === 'disabled' && (
                        <button
                          className={styles.approveBtn}
                          onClick={() => handleToggle(inv.id, true)}
                          type="button"
                        >
                          Enable
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
