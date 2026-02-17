'use client';

import { useState } from 'react';
import { StarRating } from '@/components/ui/StarRating';
import styles from './PostListenRating.module.css';

interface PostListenRatingProps {
  podcastId: string;
  onDismiss: () => void;
}

const DIMENSIONS = [
  { key: 'voiceNaturalness', label: 'Voice naturalness' },
  { key: 'contentAccuracy', label: 'Content accuracy' },
  { key: 'conversationFlow', label: 'Conversation flow' },
  { key: 'overallSatisfaction', label: 'Overall satisfaction' },
] as const;

type DimensionKey = (typeof DIMENSIONS)[number]['key'];

export function PostListenRating({ podcastId, onDismiss }: PostListenRatingProps) {
  const [ratings, setRatings] = useState<Record<DimensionKey, number>>({
    voiceNaturalness: 0,
    contentAccuracy: 0,
    conversationFlow: 0,
    overallSatisfaction: 0,
  });
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const allRated = DIMENSIONS.every((d) => ratings[d.key] > 0);

  async function handleSubmit() {
    if (!allRated) return;
    setSubmitting(true);

    try {
      const response = await fetch(`/api/podcasts/${podcastId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ratings,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      });

      if (response.ok) {
        setSubmitted(true);
        setTimeout(onDismiss, 3000);
      }
    } catch {
      // Silently fail — rating is non-critical
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className={`${styles.root} ${styles.thankYou}`} role="status">
        <p className={styles.thankYouText}>Thanks for your feedback!</p>
      </div>
    );
  }

  return (
    <div className={styles.root} role="region" aria-label="Rate your podcast">
      <h3 className={styles.title}>How was your podcast?</h3>

      <div className={styles.dimensions}>
        {DIMENSIONS.map((dim) => (
          <div key={dim.key} className={styles.row}>
            <span className={styles.label}>{dim.label}</span>
            <StarRating
              value={ratings[dim.key]}
              onChange={(v) => setRatings((prev) => ({ ...prev, [dim.key]: v }))}
              disabled={submitting}
              size={20}
              label={dim.label}
            />
          </div>
        ))}
      </div>

      <textarea
        className={styles.comment}
        placeholder="Any other thoughts? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
        rows={2}
        disabled={submitting}
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.submitBtn}
          onClick={handleSubmit}
          disabled={!allRated || submitting}
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
        <button
          type="button"
          className={styles.skipBtn}
          onClick={onDismiss}
          disabled={submitting}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
