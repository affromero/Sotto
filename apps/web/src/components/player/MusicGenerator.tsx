'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './MusicGenerator.module.css';

interface ModelOption {
  id: string;
  label: string;
  provider: string;
}

interface MusicGeneratorProps {
  podcastId: string;
  initialMusicUrl: string | null;
  onMusicReady: (musicUrl: string, volume: number) => void;
  onMusicRemoved: () => void;
}

type MusicStatus = 'PENDING' | 'GENERATING' | 'READY' | 'FAILED' | null;

function MusicNoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function WaveformIcon() {
  return (
    <div className={styles.waveform}>
      <span className={styles.waveBar} />
      <span className={styles.waveBar} />
      <span className={styles.waveBar} />
      <span className={styles.waveBar} />
    </div>
  );
}

export function MusicGenerator({ podcastId, initialMusicUrl, onMusicReady, onMusicRemoved }: MusicGeneratorProps) {
  const [status, setStatus] = useState<MusicStatus>(initialMusicUrl ? 'READY' : null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');

  // Fetch available models on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/podcasts/${podcastId}/music`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.availableModels?.length) {
          setAvailableModels(data.availableModels);
          setSelectedModel(data.availableModels[0].id);
        }
        if (data.status) setStatus(data.status);
        if (data.status === 'READY' && data.musicUrl) {
          onMusicReady(data.musicUrl, 0.15);
        }
      } catch {
        // Silently fail — models will be empty
      }
    })();
    return () => { cancelled = true; };
  }, [podcastId]); // eslint-disable-line react-hooks/exhaustive-deps

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
        body: JSON.stringify({ model: selectedModel || undefined }),
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

  // ── Generating ──────────────────────────────────────────────
  if (status === 'PENDING' || status === 'GENERATING') {
    return (
      <div className={styles.container}>
        <span className={styles.label}>
          <span className={styles.musicIcon}><MusicNoteIcon /></span>
          Background Music
        </span>
        <span className={styles.divider} />
        <div className={styles.generating}>
          <WaveformIcon />
          <span>Generating...</span>
        </div>
      </div>
    );
  }

  // ── Ready ───────────────────────────────────────────────────
  if (status === 'READY') {
    return (
      <div className={styles.container}>
        <span className={styles.label}>
          <span className={styles.musicIcon}><MusicNoteIcon /></span>
          Background Music
        </span>
        <span className={styles.divider} />
        <span className={styles.readyIndicator}>
          <span className={styles.readyDot} />
          Active
        </span>
        <div className={styles.actions}>
          <button
            className={styles.secondaryAction}
            onClick={handleGenerate}
            disabled={loading}
            aria-label="Regenerate background music"
          >
            Regenerate
          </button>
          <button
            className={styles.removeAction}
            onClick={handleRemove}
            disabled={loading}
            aria-label="Remove background music"
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  // ── No provider ─────────────────────────────────────────────
  if (!availableModels.length) {
    return (
      <div className={styles.container}>
        <span className={styles.label}>
          <span className={styles.musicIcon}><MusicNoteIcon /></span>
          Background Music
        </span>
        <span className={styles.divider} />
        <p className={styles.noProviders}>
          Add a <a href="/settings">Suno or ElevenLabs key</a> to generate music.
        </p>
      </div>
    );
  }

  // ── Default: model picker + generate ────────────────────────
  return (
    <div className={styles.container}>
      <span className={styles.label}>
        <span className={styles.musicIcon}><MusicNoteIcon /></span>
        Background Music
      </span>
      <span className={styles.divider} />
      <select
        className={styles.modelSelect}
        value={selectedModel}
        onChange={(e) => setSelectedModel(e.target.value)}
        disabled={loading}
        aria-label="Select music model"
      >
        {availableModels.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        className={styles.generateButton}
        onClick={handleGenerate}
        disabled={loading}
        aria-label="Generate background music"
      >
        {loading ? 'Starting...' : 'Generate'}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
