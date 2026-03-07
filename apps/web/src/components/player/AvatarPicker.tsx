'use client';

import { useCallback, useEffect, useState } from 'react';
import NextImage from 'next/image';
import { User, AlertTriangle } from 'lucide-react';
import { estimateAvatarCost, formatAvatarCost } from '@/lib/avatar-cost-estimator';
import type { HeyGenAvatarData } from '@/types/avatar';
import styles from './AvatarPicker.module.css';

interface AvatarPickerProps {
  podcastId: string;
  speakers: string[];
  onConfigured: () => void;
  onCancel: () => void;
  podcastDuration: number;
}

const MAX_DURATION = 600;

export function AvatarPicker({ podcastId, speakers, onConfigured, onCancel, podcastDuration }: AvatarPickerProps) {
  const [avatars, setAvatars] = useState<HeyGenAvatarData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const overDuration = podcastDuration > MAX_DURATION;

  useEffect(() => {
    fetch(`/api/podcasts/${podcastId}/video/avatars`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load avatars'))))
      .then((data: { avatars: HeyGenAvatarData[] }) => setAvatars(data.avatars))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load avatars'))
      .finally(() => setLoading(false));
  }, [podcastId]);

  const handleSelect = useCallback((speaker: string, avatarId: string) => {
    setSelections((prev) => {
      if (prev[speaker] === avatarId) {
        const next = { ...prev };
        delete next[speaker];
        return next;
      }
      return { ...prev, [speaker]: avatarId };
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const configured = Object.entries(selections).map(([speaker, avatarId]) => ({ speaker, avatarId }));
    if (configured.length === 0) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video/avatars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatars: configured }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error || 'Failed to configure avatars');
        return;
      }
      onConfigured();
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }, [selections, podcastId, onConfigured]);

  const selectedCount = Object.keys(selections).length;
  const estimatedCost = estimateAvatarCost(podcastDuration, selectedCount);

  if (loading) {
    return (
      <div className={styles.root}>
        <p className={styles.loading}>Loading avatars...</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h3 className={styles.title}>Choose Avatars</h3>
        {overDuration && (
          <div className={styles.warning}>
            <AlertTriangle size={14} />
            <span>Podcast exceeds {MAX_DURATION / 60}-minute avatar limit</span>
          </div>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.speakerColumns}>
        {speakers.map((speaker) => (
          <div key={speaker} className={styles.speakerColumn}>
            <h4 className={styles.speakerLabel}>
              <User size={14} />
              {speaker}
            </h4>
            <div className={styles.avatarGrid}>
              {avatars.map((avatar) => (
                <button
                  key={avatar.avatar_id}
                  className={`${styles.avatarCard} ${selections[speaker] === avatar.avatar_id ? styles.avatarCardSelected : ''}`}
                  onClick={() => handleSelect(speaker, avatar.avatar_id)}
                  type="button"
                  aria-pressed={selections[speaker] === avatar.avatar_id}
                  disabled={overDuration}
                >
                  {avatar.preview_image_url ? (
                    <NextImage
                      src={avatar.preview_image_url}
                      alt={avatar.avatar_name}
                      width={80}
                      height={80}
                      className={styles.avatarImage}
                    />
                  ) : (
                    <div className={styles.avatarPlaceholder}>
                      <User size={24} />
                    </div>
                  )}
                  <span className={styles.avatarName}>{avatar.avatar_name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <p className={styles.costEstimate}>
          {selectedCount > 0
            ? `${selectedCount} avatar${selectedCount > 1 ? 's' : ''}, est. ${formatAvatarCost(estimatedCost)}`
            : 'Select avatars for each speaker'}
        </p>
        <div className={styles.footerActions}>
          <button className={styles.cancelBtn} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={selectedCount === 0 || submitting || overDuration}
            type="button"
          >
            {submitting ? 'Configuring...' : 'Add Avatars'}
          </button>
        </div>
      </div>
    </div>
  );
}
