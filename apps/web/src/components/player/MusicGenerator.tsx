'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import styles from './MusicGenerator.module.css';

interface ModelOption {
  id: string;
  label: string;
  provider: string;
  costPerTrack: number;
}

interface MusicGenerationItem {
  id: string;
  status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED';
  musicUrl: string | null;
  duration: number | null;
  fileSize: number | null;
  provider: string | null;
  model: string | null;
  failureReason: string | null;
  selected: boolean;
  createdAt: string;
}

interface MusicGeneratorProps {
  podcastId: string;
  initialMusicUrl: string | null;
  onMusicReady: (musicUrl: string, volume: number) => void;
  onMusicRemoved: () => void;
}

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

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatModelLabel(model: ModelOption): string {
  return `${model.label} (${model.provider}) — ${formatCost(model.costPerTrack)}/track`;
}

export function MusicGenerator({ podcastId, onMusicReady, onMusicRemoved }: MusicGeneratorProps) {
  const [generations, setGenerations] = useState<MusicGenerationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const hasInProgress = generations.some((g) => g.status === 'PENDING' || g.status === 'GENERATING');
  const selectedGen = generations.find((g) => g.selected);

  // Notify parent when selected generation changes
  useEffect(() => {
    if (selectedGen?.musicUrl) {
      onMusicReady(selectedGen.musicUrl, 0.15);
    }
  }, [selectedGen?.musicUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch generations + models on mount
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
        if (data.generations) {
          setGenerations(data.generations);
        }
      } catch {
        // Silently fail
      }
    })();
    return () => { cancelled = true; };
  }, [podcastId]);

  const poll = useCallback(async () => {
    const res = await fetch(`/api/podcasts/${podcastId}/music`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.generations) {
      setGenerations(data.generations);
    }
  }, [podcastId]);

  // Poll while any generation is in progress
  useEffect(() => {
    if (!hasInProgress) return;
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [hasInProgress, poll]);

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
      await poll();
    } catch {
      setError('Failed to start music generation');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (generationId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/music/select`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationId }),
      });
      if (res.ok) {
        await poll();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (generationId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/music?generationId=${generationId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        if (previewingId === generationId) {
          stopPreview();
        }
        await poll();
        // If deleted the selected one, notify parent
        const deleted = generations.find((g) => g.id === generationId);
        if (deleted?.selected) {
          onMusicRemoved();
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAll = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/music`, { method: 'DELETE' });
      if (res.ok) {
        stopPreview();
        setGenerations([]);
        onMusicRemoved();
      }
    } finally {
      setLoading(false);
    }
  };

  const togglePreview = (gen: MusicGenerationItem) => {
    if (previewingId === gen.id) {
      stopPreview();
      return;
    }
    stopPreview();
    if (!gen.musicUrl) return;
    const audio = new Audio(gen.musicUrl);
    audio.volume = 0.5;
    audio.play();
    audio.addEventListener('ended', () => setPreviewingId(null));
    audioRef.current = audio;
    setPreviewingId(gen.id);
  };

  const stopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPreviewingId(null);
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // ── No provider ─────────────────────────────────────────────
  if (!availableModels.length && !generations.length) {
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

  return (
    <div className={styles.root}>
      {/* ── Header + Generate controls ──────────────────────────── */}
      <div className={styles.container}>
        <span className={styles.label}>
          <span className={styles.musicIcon}><MusicNoteIcon /></span>
          Background Music
        </span>
        <span className={styles.divider} />

        {availableModels.length > 0 && (
          <>
            <select
              className={styles.modelSelect}
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={loading || hasInProgress}
              aria-label="Select music model and see price per track"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {formatModelLabel(m)}
                </option>
              ))}
            </select>
            <button
              className={styles.generateButton}
              onClick={handleGenerate}
              disabled={loading || hasInProgress}
              aria-label="Generate background music"
            >
              {hasInProgress ? 'Generating...' : loading ? 'Starting...' : 'Generate'}
            </button>
          </>
        )}

        {generations.length > 1 && (
          <div className={styles.actions}>
            <button
              className={styles.removeAction}
              onClick={handleDeleteAll}
              disabled={loading}
              aria-label="Remove all music generations"
            >
              Remove All
            </button>
          </div>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {/* ── Generations list ────────────────────────────────────── */}
      {generations.length > 0 && (
        <ul className={styles.generationList} aria-label="Music generations">
          {generations.map((gen) => (
            <li key={gen.id} className={`${styles.generationItem} ${gen.selected ? styles.generationItemSelected : ''}`}>
              {/* Status indicator */}
              {gen.status === 'READY' && gen.selected && (
                <span className={styles.readyIndicator} aria-label="Active">
                  <span className={styles.readyDot} />
                  Active
                </span>
              )}
              {gen.status === 'READY' && !gen.selected && (
                <span className={styles.candidateLabel}>Ready</span>
              )}
              {(gen.status === 'PENDING' || gen.status === 'GENERATING') && (
                <span className={styles.generating}>
                  <WaveformIcon />
                  <span>Generating...</span>
                </span>
              )}
              {gen.status === 'FAILED' && (
                <span className={styles.failedLabel}>Failed</span>
              )}

              {/* Model info */}
              <span className={styles.genModel}>
                {gen.model || 'Default'}
              </span>

              {/* Actions */}
              <div className={styles.genActions}>
                {gen.status === 'READY' && gen.musicUrl && (
                  <button
                    className={styles.previewButton}
                    onClick={() => togglePreview(gen)}
                    aria-label={previewingId === gen.id ? 'Stop preview' : 'Preview music'}
                  >
                    {previewingId === gen.id ? <PauseIcon /> : <PlayIcon />}
                    {previewingId === gen.id ? 'Stop' : 'Preview'}
                  </button>
                )}
                {gen.status === 'READY' && !gen.selected && (
                  <button
                    className={styles.selectButton}
                    onClick={() => handleSelect(gen.id)}
                    disabled={loading}
                    aria-label="Use this music"
                  >
                    <CheckIcon />
                    Use
                  </button>
                )}
                <button
                  className={styles.deleteButton}
                  onClick={() => handleDelete(gen.id)}
                  disabled={loading || gen.status === 'PENDING' || gen.status === 'GENERATING'}
                  aria-label="Delete this music generation"
                >
                  &times;
                </button>
              </div>

              {/* Failure reason */}
              {gen.status === 'FAILED' && gen.failureReason && (
                <p className={styles.failureReason}>{gen.failureReason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
