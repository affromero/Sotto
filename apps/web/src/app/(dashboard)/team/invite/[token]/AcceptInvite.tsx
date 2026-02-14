'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

interface AcceptInviteProps {
  token: string;
}

interface InviteInfo {
  teamName: string;
  email: string;
  expiresAt: string;
}

export function AcceptInvite({ token }: AcceptInviteProps) {
  const router = useRouter();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInvite() {
      try {
        const response = await fetch(`/api/teams/invite/${token}`);
        if (response.ok) {
          const data = await response.json();
          setInfo(data);
        } else {
          const data = await response.json();
          setError(data.error || 'Invalid invite');
        }
      } catch {
        setError('Failed to load invite');
      } finally {
        setLoading(false);
      }
    }
    fetchInvite();
  }, [token]);

  const handleAccept = useCallback(async () => {
    setAccepting(true);
    setError(null);
    try {
      const response = await fetch(`/api/teams/invite/${token}`, {
        method: 'POST',
      });
      if (response.ok) {
        router.push('/team');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to accept invite');
      }
    } finally {
      setAccepting(false);
    }
  }, [token, router]);

  if (loading) {
    return <p>Loading invite...</p>;
  }

  if (error && !info) {
    return (
      <div>
        <p style={{ color: 'var(--color-error)', marginBottom: 'var(--spacing-md)' }}>{error}</p>
        <Button variant="secondary" onClick={() => router.push('/dashboard')}>
          Go to Dashboard
        </Button>
      </div>
    );
  }

  if (!info) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', alignItems: 'center', textAlign: 'center' }}>
      <h2 style={{ font: 'var(--text-h2)' }}>Team Invite</h2>
      <p style={{ color: 'var(--color-text-secondary)' }}>
        You have been invited to join <strong>{info.teamName}</strong>.
      </p>
      {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
        <Button onClick={handleAccept} loading={accepting} disabled={accepting}>
          Accept Invite
        </Button>
        <Button variant="ghost" onClick={() => router.push('/dashboard')}>
          Decline
        </Button>
      </div>
    </div>
  );
}
