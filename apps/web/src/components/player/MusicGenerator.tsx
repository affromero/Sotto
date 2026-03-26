'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
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

interface ProviderGroup {
  provider: string;
  models: ModelOption[];
}

interface MusicGeneratorProps {
  podcastId: string;
  initialMusicUrl: string | null;
  onMusicReady: (musicUrl: string, volume: number) => void;
  onMusicRemoved: () => void;
  isOpen: boolean;
  onClose: () => void;
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

function PlayIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
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

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

/** Strip version prefix to get a short display name: "Suno V5" → "V5" */
function shortModelName(label: string, provider: string): string {
  const stripped = label.replace(new RegExp(`^${provider}\\s*`, 'i'), '').trim();
  return stripped || label;
}

/** Group flat model list by provider */
function groupByProvider(models: ModelOption[]): ProviderGroup[] {
  const map = new Map<string, ModelOption[]>();
  for (const m of models) {
    const list = map.get(m.provider) || [];
    list.push(m);
    map.set(m.provider, list);
  }
  return Array.from(map.entries()).map(([provider, models]) => ({ provider, models }));
}

/** Find the recommended (most expensive = highest quality) model per provider */
function isRecommended(model: ModelOption, group: ProviderGroup): boolean {
  if (group.models.length <= 1) return false;
  const maxCost = Math.max(...group.models.map((m) => m.costPerTrack));
  return model.costPerTrack === maxCost;
}

export function MusicGenerator({ podcastId, onMusicReady, onMusicRemoved, isOpen, onClose }: MusicGeneratorProps) {
  const [generations, setGenerations] = useState<MusicGenerationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const hasInProgress = generations.some((g) => g.status === 'PENDING' || g.status === 'GENERATING');
  const selectedGen = generations.find((g) => g.selected);
  const providerGroups = groupByProvider(availableModels);

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
    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      poll();
    }, 10000);
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

  // Stop preview when modal closes
  useEffect(() => {
    if (!isOpen) stopPreview();
  }, [isOpen]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Background Music" size="medium">
      <div className={styles.modalContent}>
        {/* ── No provider state ──────────────────────────────────── */}
        {!availableModels.length && !generations.length && (
          <p className={styles.noProviders}>
            Add a <a href="/settings">Suno or ElevenLabs key</a> in Settings to generate background music.
          </p>
        )}

        {/* ── Model selector — grouped by provider ───────────────── */}
        {providerGroups.length > 0 && (
          <div className={styles.providerGroups}>
            {providerGroups.map((group) => (
              <div key={group.provider} className={styles.providerSection}>
                <span className={styles.providerName}>{group.provider}</span>
                <div className={styles.modelGrid}>
                  {group.models.map((m) => {
                    const active = selectedModel === m.id;
                    const recommended = isRecommended(m, group);
                    return (
                      <button
                        key={m.id}
                        className={`${styles.modelCard} ${active ? styles.modelCardActive : ''}`}
                        onClick={() => setSelectedModel(m.id)}
                        disabled={loading || hasInProgress}
                        aria-pressed={active}
                        aria-label={`Select ${m.label}`}
                      >
                        <span className={styles.modelName}>
                          {shortModelName(m.label, m.provider)}
                        </span>
                        {recommended && (
                          <span className={styles.recommendedBadge}>Best</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Generate CTA ───────────────────────────────────────── */}
        {availableModels.length > 0 && (
          <button
            className={styles.generateButton}
            onClick={handleGenerate}
            disabled={loading || hasInProgress || !selectedModel}
            aria-label="Generate background music"
          >
            {hasInProgress ? (
              <>
                <WaveformIcon />
                Generating...
              </>
            ) : loading ? (
              'Starting...'
            ) : (
              'Generate Track'
            )}
          </button>
        )}

        {error && <p className={styles.error}>{error}</p>}

        {/* ── Generations list ────────────────────────────────────── */}
        {generations.length > 0 && (
          <div className={styles.generationsSection}>
            <div className={styles.generationsHeader}>
              <span className={styles.generationsTitle}>
                {generations.length === 1 ? '1 track' : `${generations.length} tracks`}
              </span>
              {generations.length > 1 && (
                <button
                  className={styles.removeAllButton}
                  onClick={handleDeleteAll}
                  disabled={loading}
                  aria-label="Remove all music generations"
                >
                  Remove all
                </button>
              )}
            </div>
            <ul className={styles.generationList} aria-label="Music generations">
              {generations.map((gen) => (
                <li
                  key={gen.id}
                  className={`${styles.generationItem} ${gen.selected ? styles.generationItemActive : ''}`}
                >
                  {/* Left: status + model */}
                  <div className={styles.genInfo}>
                    {gen.status === 'READY' && gen.selected && (
                      <span className={styles.activeDot} aria-hidden="true" />
                    )}
                    {(gen.status === 'PENDING' || gen.status === 'GENERATING') && (
                      <WaveformIcon />
                    )}
                    {gen.status === 'FAILED' && (
                      <span className={styles.failedDot} aria-hidden="true" />
                    )}
                    {gen.status === 'READY' && !gen.selected && (
                      <span className={styles.readyDot} aria-hidden="true" />
                    )}
                    <span className={styles.genLabel}>
                      {gen.model || 'Default'}
                    </span>
                    {gen.status === 'READY' && gen.selected && (
                      <span className={styles.activeTag}>Active</span>
                    )}
                    {(gen.status === 'PENDING' || gen.status === 'GENERATING') && (
                      <span className={styles.generatingTag}>Generating</span>
                    )}
                    {gen.status === 'FAILED' && (
                      <span className={styles.failedTag}>Failed</span>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div className={styles.genActions}>
                    {gen.status === 'READY' && gen.musicUrl && (
                      <button
                        className={`${styles.actionButton} ${previewingId === gen.id ? styles.actionButtonPlaying : ''}`}
                        onClick={() => togglePreview(gen)}
                        aria-label={previewingId === gen.id ? 'Stop preview' : 'Preview music'}
                      >
                        {previewingId === gen.id ? <PauseIcon /> : <PlayIcon />}
                      </button>
                    )}
                    {gen.status === 'READY' && !gen.selected && (
                      <button
                        className={`${styles.actionButton} ${styles.actionButtonUse}`}
                        onClick={() => handleSelect(gen.id)}
                        disabled={loading}
                        aria-label="Use this music"
                      >
                        <CheckIcon />
                      </button>
                    )}
                    <button
                      className={`${styles.actionButton} ${styles.actionButtonDelete}`}
                      onClick={() => handleDelete(gen.id)}
                      disabled={loading || gen.status === 'PENDING' || gen.status === 'GENERATING'}
                      aria-label="Delete this music generation"
                    >
                      <TrashIcon />
                    </button>
                  </div>

                  {gen.status === 'FAILED' && gen.failureReason && (
                    <p className={styles.failureReason}>{gen.failureReason}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
