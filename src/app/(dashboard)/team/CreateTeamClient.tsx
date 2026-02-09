'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function CreateTeamClient() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (response.ok) {
        router.refresh();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to create team');
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)', width: '100%', maxWidth: '300px' }}>
      <Input
        label="Team Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="My Team"
        maxLength={100}
        required
      />
      {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>{error}</p>}
      <Button type="submit" loading={creating} disabled={creating}>
        Create Team
      </Button>
    </form>
  );
}
