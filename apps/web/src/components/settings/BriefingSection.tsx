'use client';

import { useState, useCallback } from 'react';
import { BriefingCard } from './BriefingCard';
import type { BriefingData } from './BriefingCard';
import { BriefingForm } from './BriefingForm';
import styles from './BriefingSection.module.css';

const MAX_BRIEFINGS = 5;
const MAX_ENABLED = 3;

interface BriefingSectionProps {
  initialBriefings: BriefingData[];
  hasByokKeys: boolean;
  aiModelOptions: Array<{ id: string; displayName: string; tier: string; group?: string }>;
  ttsOptions: Array<{ id: string; displayName: string; badge?: string; group?: string }>;
}

export function BriefingSection({
  initialBriefings,
  hasByokKeys,
  aiModelOptions,
  ttsOptions,
}: BriefingSectionProps) {
  const [briefings, setBriefings] = useState<BriefingData[]>(initialBriefings);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/briefings');
    if (res.ok) {
      const data = await res.json();
      setBriefings(data.briefings);
    }
  }, []);

  const enabledCount = briefings.filter((b) => b.enabled).length;
  const atMaxTotal = briefings.length >= MAX_BRIEFINGS;
  const atMaxEnabled = enabledCount >= MAX_ENABLED;

  return (
    <div className={styles.root}>
      <div className={styles.counter}>
        {briefings.length} of {MAX_BRIEFINGS} briefings
        {atMaxEnabled && (
          <span className={styles.capHint}>
            &middot; {enabledCount}/{MAX_ENABLED} enabled
          </span>
        )}
      </div>

      {briefings.length === 0 && !showCreate && (
        <div className={styles.empty}>
          <p className={styles.emptyText}>
            No briefings yet. Create one to get a personalized podcast every morning.
          </p>
        </div>
      )}

      {briefings.map((b) => (
        <BriefingCard
          key={b.id}
          briefing={b}
          hasByokKeys={hasByokKeys}
          aiModelOptions={aiModelOptions}
          ttsOptions={ttsOptions}
          onRefresh={refresh}
        />
      ))}

      {showCreate ? (
        <div className={styles.createCard}>
          <BriefingForm
            mode="create"
            hasByokKeys={hasByokKeys}
            aiModelOptions={aiModelOptions}
            ttsOptions={ttsOptions}
            onSaved={() => {
              setShowCreate(false);
              refresh();
            }}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setShowCreate(true)}
          disabled={atMaxTotal}
          aria-label="Add briefing"
        >
          {atMaxTotal ? `Limit reached (${MAX_BRIEFINGS} max)` : '+ Add Briefing'}
        </button>
      )}
    </div>
  );
}
