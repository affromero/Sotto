'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

interface WaitlistActionsProps {
  id: string;
  status: string;
}

export function WaitlistActions({ id, status }: WaitlistActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleAction(newStatus: 'APPROVED' | 'REJECTED') {
    setLoading(newStatus);
    try {
      await fetch('/api/v1/admin/waitlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      });
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function handleRemove() {
    if (!window.confirm('Remove this waitlist entry? This cannot be undone.')) return;
    setLoading('REMOVE');
    try {
      await fetch('/api/v1/admin/waitlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  if (status !== 'PENDING') {
    return (
      <div className={styles.actions}>
        <span className={styles[`status${status.charAt(0) + status.slice(1).toLowerCase()}`]}>{status.toLowerCase()}</span>
        <button
          className={styles.removeBtn}
          onClick={handleRemove}
          disabled={loading !== null}
          type="button"
        >
          {loading === 'REMOVE' ? '...' : 'Remove'}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.actions}>
      <button
        className={styles.approveBtn}
        onClick={() => handleAction('APPROVED')}
        disabled={loading !== null}
        type="button"
      >
        {loading === 'APPROVED' ? '...' : 'Approve'}
      </button>
      <button
        className={styles.rejectBtn}
        onClick={() => handleAction('REJECTED')}
        disabled={loading !== null}
        type="button"
      >
        {loading === 'REJECTED' ? '...' : 'Reject'}
      </button>
      <button
        className={styles.removeBtn}
        onClick={handleRemove}
        disabled={loading !== null}
        type="button"
      >
        {loading === 'REMOVE' ? '...' : 'Remove'}
      </button>
    </div>
  );
}
