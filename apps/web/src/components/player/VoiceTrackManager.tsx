'use client';

import { useState, useCallback, useEffect } from 'react';
import { X, RefreshCw, Trash2, Star, Plus, Loader2 } from 'lucide-react';
import type { VoiceTrackSummary } from '@sotto/shared';
import styles from './VoiceTrackManager.module.css';

interface VoiceTrackManagerProps {
  podcastId: string;
  voiceTracks: VoiceTrackSummary[];
  isOpen: boolean;
  onClose: () => void;
  onTracksChange?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  READY: 'Ready',
  GENERATING_AUDIO: 'Generating...',
  STITCHING: 'Stitching...',
  STALE: 'Needs Update',
  FAILED: 'Failed',
  PENDING: 'Pending',
};

export function VoiceTrackManager({
  podcastId,
  voiceTracks: initialTracks,
  isOpen,
  onClose,
  onTracksChange,
}: VoiceTrackManagerProps) {
  const [tracks, setTracks] = useState(initialTracks);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  // Poll for in-progress tracks
  useEffect(() => {
    const inProgress = tracks.some(t =>
      t.status === 'GENERATING_AUDIO' || t.status === 'STITCHING' || t.status === 'PENDING'
    );
    if (!inProgress) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/podcasts/${podcastId}/voice-tracks`);
        if (res.ok) {
          const updated = await res.json();
          setTracks(updated);
        }
      } catch {}
    }, 5000);

    return () => clearInterval(interval);
  }, [tracks, podcastId]);

  const handleDelete = useCallback(async (trackId: string) => {
    if (!confirm('Delete this voice track?')) return;
    setLoading(trackId);
    setError(null);

    try {
      const res = await fetch(`/api/podcasts/${podcastId}/voice-tracks/${trackId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }
      setTracks(prev => prev.filter(t => t.id !== trackId));
      onTracksChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setLoading(null);
    }
  }, [podcastId, onTracksChange]);

  const handleRegenerate = useCallback(async (trackId: string) => {
    setLoading(trackId);
    setError(null);

    try {
      const res = await fetch(`/api/podcasts/${podcastId}/voice-tracks/${trackId}/regenerate`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to regenerate');
      }
      setTracks(prev => prev.map(t =>
        t.id === trackId ? { ...t, status: 'GENERATING_AUDIO' as const, failureReason: null } : t
      ));
      onTracksChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate');
    } finally {
      setLoading(null);
    }
  }, [podcastId, onTracksChange]);

  const handleSetDefault = useCallback(async (trackId: string | null) => {
    setError(null);

    try {
      const res = await fetch(`/api/podcasts/${podcastId}/default-track`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceTrackId: trackId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to set default');
      }
      onTracksChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set default');
    }
  }, [podcastId, onTracksChange]);

  if (!isOpen) return null;

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'READY': return styles.statusReady;
      case 'GENERATING_AUDIO':
      case 'STITCHING': return styles.statusGenerating;
      case 'STALE': return styles.statusStale;
      case 'FAILED': return styles.statusFailed;
      default: return '';
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Voice Tracks</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          {error && <div className={styles.error}>{error}</div>}

          {tracks.length === 0 ? (
            <div className={styles.empty}>
              No voice tracks yet. Add one to hear your podcast with different voices.
            </div>
          ) : (
            <div className={styles.trackList}>
              {tracks.map(track => (
                <div key={track.id} className={styles.trackCard}>
                  <div className={styles.trackInfo}>
                    <div className={styles.trackName}>{track.name}</div>
                    <div className={styles.trackMeta}>
                      <span className={`${styles.statusBadge} ${getStatusStyle(track.status)}`}>
                        {STATUS_LABELS[track.status] || track.status}
                      </span>
                      {track.ttsProvider && <span>{track.ttsProvider}</span>}
                      {track.duration && (
                        <span>{Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}</span>
                      )}
                    </div>
                    {track.failureReason && (
                      <div style={{ fontSize: '0.75rem', color: '#991B1B', marginTop: '0.25rem' }}>
                        {track.failureReason}
                      </div>
                    )}
                  </div>

                  <div className={styles.trackActions}>
                    {track.status === 'READY' && (
                      <button
                        className={styles.actionBtn}
                        onClick={() => handleSetDefault(track.id)}
                        title="Set as default"
                      >
                        <Star size={16} />
                      </button>
                    )}
                    {(track.status === 'STALE' || track.status === 'FAILED') && (
                      <button
                        className={styles.actionBtn}
                        onClick={() => handleRegenerate(track.id)}
                        disabled={loading === track.id}
                        title="Regenerate"
                      >
                        {loading === track.id ? <Loader2 size={16} /> : <RefreshCw size={16} />}
                      </button>
                    )}
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(track.id)}
                      disabled={loading === track.id}
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={styles.addSection}>
            <button
              className={styles.addBtn}
              onClick={() => {
                // Navigate to create flow — for now, a simple prompt-based approach
                const name = prompt('Voice track name (e.g., "British Narrator"):');
                if (!name) return;
                setError(null);

                // Create with default voices (will use pool)
                fetch(`/api/podcasts/${podcastId}/voice-tracks`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name,
                    voices: [
                      { speaker: 'Host', voiceId: '' },
                      { speaker: 'Expert', voiceId: '' },
                    ],
                  }),
                })
                  .then(async res => {
                    if (!res.ok) {
                      const data = await res.json();
                      throw new Error(data.error || 'Failed to create');
                    }
                    return res.json();
                  })
                  .then(newTrack => {
                    setTracks(prev => [...prev, {
                      id: newTrack.id,
                      name,
                      status: newTrack.status,
                      audioUrl: null,
                      duration: null,
                      ttsProvider: null,
                      failureReason: null,
                      voices: [],
                    }]);
                    onTracksChange?.();
                  })
                  .catch(err => {
                    setError(err instanceof Error ? err.message : 'Failed to create');
                  });
              }}
            >
              <Plus size={16} />
              Add Voice Track
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
