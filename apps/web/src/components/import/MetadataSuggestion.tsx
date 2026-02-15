'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './MetadataSuggestion.module.css';

interface MetadataSuggestionProps {
  podcastId: string;
  currentTitle: string;
  currentTopic: string;
  suggestedTitle: string | null;
  suggestedTopic: string | null;
  onAccepted: () => void;
  onDismissed: () => void;
}

export function MetadataSuggestion({
  podcastId,
  currentTitle,
  currentTopic,
  suggestedTitle,
  suggestedTopic,
  onAccepted,
  onDismissed,
}: MetadataSuggestionProps) {
  const [loading, setLoading] = useState(false);

  async function handleAccept() {
    setLoading(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(suggestedTitle && { title: suggestedTitle }),
          ...(suggestedTopic && { topic: suggestedTopic }),
          dismissSuggestion: true,
        }),
      });
      if (res.ok) onAccepted();
    } finally {
      setLoading(false);
    }
  }

  async function handleDismiss() {
    setLoading(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissSuggestion: true }),
      });
      if (res.ok) onDismissed();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Sparkles size={20} className={styles.icon} aria-hidden="true" />
        <h3 className={styles.heading}>We have a suggestion</h3>
      </div>

      <div className={styles.comparison}>
        {suggestedTitle && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Title</span>
            <div className={styles.currentValue}>{currentTitle}</div>
            <div className={styles.suggestedValue}>{suggestedTitle}</div>
          </div>
        )}

        {suggestedTopic && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Description</span>
            <div className={styles.currentValue}>{currentTopic || 'No description'}</div>
            <div className={styles.suggestedValue}>{suggestedTopic}</div>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <Button variant="primary" size="medium" onClick={handleAccept} disabled={loading}>
          Use Suggestion
        </Button>
        <Button variant="ghost" size="medium" onClick={handleDismiss} disabled={loading}>
          Keep Mine
        </Button>
      </div>
    </div>
  );
}
