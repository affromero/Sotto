'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InterestGrid } from '@/components/discovery/InterestGrid';
import { Button } from '@/components/ui/Button';
import styles from './page.module.css';

interface TagOption {
  id: string;
  name: string;
  slug: string;
}

interface OnboardingFormProps {
  tags: TagOption[];
}

export function OnboardingForm({ tags }: OnboardingFormProps) {
  const router = useRouter();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const handleContinue = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/onboarding/interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds: selectedTagIds }),
      });

      if (!response.ok) {
        throw new Error('Failed to save interests');
      }

      router.push('/onboarding?step=keys');
    } catch {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/onboarding/interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds: [] }),
      });

      if (!response.ok) {
        throw new Error('Failed to skip onboarding');
      }

      router.push('/onboarding?step=keys');
    } catch {
      setSaving(false);
    }
  };

  return (
    <>
      <InterestGrid tags={tags} selectedTagIds={selectedTagIds} onChange={setSelectedTagIds} />

      <div className={styles.actions}>
        <Button onClick={handleContinue} loading={saving} disabled={saving}>
          {selectedTagIds.length > 0
            ? `Continue with ${selectedTagIds.length} topic${selectedTagIds.length !== 1 ? 's' : ''}`
            : 'Continue'}
        </Button>
        <button type="button" className={styles.skipButton} onClick={handleSkip} disabled={saving}>
          Skip for now
        </button>
      </div>
    </>
  );
}
