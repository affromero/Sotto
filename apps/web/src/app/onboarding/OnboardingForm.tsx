'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InterestGrid } from '@/components/discovery/InterestGrid';
import type { CustomTag } from '@/components/discovery/InterestGrid';
import { Button } from '@/components/ui/Button';
import styles from './page.module.css';

interface SubTag {
  id: string;
  name: string;
  slug: string;
}

interface CategoryTag {
  id: string;
  name: string;
  slug: string;
  children: SubTag[];
}

interface OnboardingFormProps {
  categories: CategoryTag[];
}

export function OnboardingForm({ categories }: OnboardingFormProps) {
  const router = useRouter();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [customTags, setCustomTags] = useState<CustomTag[]>([]);
  const [saving, setSaving] = useState(false);

  const totalCount = selectedTagIds.length + customTags.length;

  const handleChange = (tagIds: string[], custom: CustomTag[]) => {
    setSelectedTagIds(tagIds);
    setCustomTags(custom);
  };

  const handleContinue = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/onboarding/interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds: selectedTagIds, customTags }),
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
        body: JSON.stringify({ tagIds: [], customTags: [] }),
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
      <InterestGrid
        categories={categories}
        selectedTagIds={selectedTagIds}
        customTags={customTags}
        onChange={handleChange}
      />

      <div className={styles.actions}>
        <Button onClick={handleContinue} loading={saving} disabled={saving}>
          {totalCount > 0
            ? `Continue with ${totalCount} topic${totalCount !== 1 ? 's' : ''}`
            : 'Continue'}
        </Button>
        <button type="button" className={styles.skipButton} onClick={handleSkip} disabled={saving}>
          Skip for now
        </button>
      </div>
    </>
  );
}
