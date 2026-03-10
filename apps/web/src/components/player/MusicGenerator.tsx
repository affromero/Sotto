'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './MusicGenerator.module.css';

interface MusicGeneratorProps {
  podcastId: string;
  initialMusicUrl: string | null;
  onMusicReady: (musicUrl: string, volume: number) => void;
  onMusicRemoved: () => void;
}

type MusicStatus = 'PENDING' | 'GENERATING' | 'READY' | 'FAILED' | null;

export function MusicGenerator({ podcastId, initialMusicUrl, onMusicReady, onMusicRemoved }: MusicGeneratorProps) {
  const [status, setStatus] = useState<MusicStatus>(initialMusicUrl ? 'READY' : null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const poll = useCallback(async () => {
    const res = await fetch(`/api/podcasts/${podcastId}/music`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.status) return;
    setStatus(data.status);
    if (data.status === 'READY' && data.musicUrl) {
      onMusicReady(data.musicUrl, 0.15);
    }
    if (data.status === 'FAILED') {
      setError(data.failureReason || 'Music generation failed');
    }
  }, [podcastId, onMusicReady]);

  // Poll while generating
  useEffect(() => {
    if (status !== 'PENDING' && status !== 'GENERATING') return;
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [status, poll]);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/music`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to start music generation');
        return;
      }
      const data = await res.json();
      setStatus(data.status);
    } catch {
      setError('Failed to start music generation');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/music`, { method: 'DELETE' });
      if (res.ok) {
        setStatus(null);
        setError(null);
        onMusicRemoved();
      }
    } finally {
      setLoading(false);
    }
  };

  if (status === 'PENDING' || status === 'GENERATING') {
    return (
      <div className={styles.container}>
        <div className={styles.generating}>
          <span className={styles.spinner} />
          <span>Generating background music...</span>
        </div>
      </div>
    );
  }

  if (status === 'READY') {
    return (
      <div className={styles.container}>
        <button
          className={styles.secondaryAction}
          onClick={handleGenerate}
          disabled={loading}
          aria-label="Regenerate background music"
        >
          Regenerate Music
        </button>
        <button
          className={styles.removeAction}
          onClick={handleRemove}
          disabled={loading}
          aria-label="Remove background music"
        >
          Remove Music
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <button
        className={styles.generateButton}
        onClick={handleGenerate}
        disabled={loading}
        aria-label="Generate background music"
      >
        {loading ? 'Starting...' : 'Generate Background Music'}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
