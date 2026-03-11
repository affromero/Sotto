'use client';

import { useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { X, RefreshCw, Trash2, Star, Plus, Loader2, Check, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AudioConfigPanel, type AudioConfig } from '@/components/player/AudioConfigPanel';
import type { VoiceTrackSummary } from '@sotto/shared';
import styles from './VoiceTrackManager.module.css';

const PROVIDER_DISPLAY: Record<string, string> = {
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI',
  cartesia: 'Cartesia',
  hume: 'Hume AI',
  fal: 'Fal',
  minimax: 'MiniMax',
  replicate: 'Replicate',
  kittentts: 'KittenTTS',
};

function buildVoiceTooltip(voices: VoiceTrackSummary['voices']): string | undefined {
  if (!voices || voices.length === 0) return undefined;
  return voices
    .map((v) => {
      const provider = v.provider ? (PROVIDER_DISPLAY[v.provider] ?? v.provider) : '';
      const voice = v.voiceId || 'Auto';
      return `${v.speaker}: ${voice}${provider ? ` [${provider}]` : ''}`;
    })
    .join('\n');
}

interface VoiceTrackManagerProps {
  podcastId: string;
  voiceTracks: VoiceTrackSummary[];
  speakers: string[];
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
  speakers,
  isOpen,
  onClose,
  onTracksChange,
}: VoiceTrackManagerProps) {
  const [tracks, setTracks] = useState(initialTracks);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [audioConfig, setAudioConfig] = useState<AudioConfig | null>(null);

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
      } catch { /* ignore polling errors */ }
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

  const handleReview = useCallback(async (trackId: string, action: 'accept' | 'reject') => {
    setLoading(trackId);
    setError(null);

    try {
      const res = await fetch(`/api/podcasts/${podcastId}/voice-tracks/${trackId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(action === 'reject' && rejectionReason ? { rejectionReason } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${action}`);
      }

      setTracks(prev => prev.map(t =>
        t.id === trackId
          ? { ...t, proposalStatus: action === 'accept' ? 'ACCEPTED' as const : 'REJECTED' as const }
          : t
      ));
      setRejectingId(null);
      setRejectionReason('');
      onTracksChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setLoading(null);
    }
  }, [podcastId, onTracksChange, rejectionReason]);

  const handleConfigChange = useCallback((config: AudioConfig) => {
    setAudioConfig(config);
  }, []);

  const handleAddTrack = useCallback(async () => {
    setError(null);
    setAddLoading(true);

    try {
      const res = await fetch(`/api/podcasts/${podcastId}/voice-tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voices: audioConfig?.voices && audioConfig.voices.length > 0
            ? audioConfig.voices.map(v => ({ speaker: v.speaker, voiceId: v.voiceId || '', provider: v.provider }))
            : speakers.map(s => ({ speaker: s, voiceId: '' })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create');
      }
      const newTrack = await res.json();
      if (newTrack.duplicate) {
        setError('This voice combination already exists.');
        return;
      }
      setTracks(prev => [...prev, {
        id: newTrack.id,
        name: newTrack.name ?? 'Voice Track',
        status: newTrack.status,
        audioUrl: null,
        duration: null,
        ttsProvider: null,
        ttsModel: null,
        failureReason: null,
        voices: [],
        contributor: null,
        proposalStatus: null,
        proposalMessage: null,
      }]);
      setAudioConfig(null);
      setShowAddInput(false);
      onTracksChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setAddLoading(false);
    }
  }, [podcastId, audioConfig, speakers, onTracksChange]);

  if (!isOpen) return null;

  const pendingProposals = tracks.filter(t => t.proposalStatus === 'PENDING');
  const regularTracks = tracks.filter(t => t.proposalStatus !== 'PENDING');

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
          <button className={styles.closeBtn} onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          {error && <div className={styles.error}>{error}</div>}

          {/* Proposals Section */}
          {pendingProposals.length > 0 && (
            <div className={styles.proposalsSection}>
              <h3 className={styles.sectionTitle}>
                Proposals ({pendingProposals.length})
              </h3>
              <div className={styles.proposalList}>
                {pendingProposals.map(track => (
                  <div key={track.id} className={styles.proposalCard} title={buildVoiceTooltip(track.voices)}>
                    <div className={styles.proposalInfo}>
                      {track.contributor && (
                        <div className={styles.proposalAuthor}>
                          {track.contributor.image && (
                            <Image
                              src={track.contributor.image}
                              alt=""
                              width={24}
                              height={24}
                              className={styles.proposalAvatar}
                            />
                          )}
                          <span className={styles.proposalAuthorName}>
                            {track.contributor.handle
                              ? `@${track.contributor.handle}`
                              : track.contributor.name}
                          </span>
                        </div>
                      )}
                      <div className={styles.trackName}>{track.name}</div>
                      <div className={styles.trackMeta}>
                        {track.ttsProvider && (
                          <span className={styles.providerBadge}>{track.ttsProvider}</span>
                        )}
                        {track.duration && (
                          <span>{Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}</span>
                        )}
                      </div>
                      {track.proposalMessage && (
                        <div className={styles.proposalMessage}>
                          <MessageSquare size={12} />
                          <span>{track.proposalMessage}</span>
                        </div>
                      )}
                    </div>
                    <div className={styles.proposalActions}>
                      {rejectingId === track.id ? (
                        <div className={styles.rejectForm}>
                          <textarea
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Reason (optional)"
                            className={styles.rejectTextarea}
                            rows={2}
                          />
                          <div className={styles.rejectFormActions}>
                            <Button
                              variant="ghost"
                              onClick={() => { setRejectingId(null); setRejectionReason(''); }}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="primary"
                              loading={loading === track.id}
                              onClick={() => handleReview(track.id, 'reject')}
                            >
                              Reject
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            className={styles.acceptBtn}
                            onClick={() => handleReview(track.id, 'accept')}
                            disabled={loading === track.id}
                            title="Accept"
                            type="button"
                          >
                            <Check size={16} />
                            Accept
                          </button>
                          <button
                            className={styles.rejectBtn}
                            onClick={() => setRejectingId(track.id)}
                            disabled={loading === track.id}
                            title="Reject"
                            type="button"
                          >
                            <X size={16} />
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Regular Tracks */}
          {regularTracks.length === 0 && pendingProposals.length === 0 ? (
            <div className={styles.empty}>
              No voice tracks yet. Add one to hear your podcast with different voices.
            </div>
          ) : (
            <div className={styles.trackList}>
              {regularTracks.map(track => (
                <div key={track.id} className={styles.trackCard} title={buildVoiceTooltip(track.voices)}>
                  <div className={styles.trackInfo}>
                    <div className={styles.trackName}>
                      {track.name}
                      {track.contributor && (
                        <span className={styles.contributedBy}>
                          by {track.contributor.handle ? `@${track.contributor.handle}` : track.contributor.name}
                        </span>
                      )}
                    </div>
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
                      <div className={styles.failureReason}>
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
                        type="button"
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
                        type="button"
                      >
                        {loading === track.id ? <Loader2 size={16} /> : <RefreshCw size={16} />}
                      </button>
                    )}
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(track.id)}
                      disabled={loading === track.id}
                      title="Delete"
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add Voice Track */}
          <div className={styles.addSection}>
            {showAddInput ? (
              <div
                className={styles.addForm}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setShowAddInput(false); setAudioConfig(null); }
                }}
              >
                <AudioConfigPanel speakers={speakers} onConfigChange={handleConfigChange} />
                <div className={styles.addFormActions}>
                  <Button
                    variant="ghost"
                    onClick={() => { setShowAddInput(false); setAudioConfig(null); }}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={handleAddTrack} loading={addLoading}>
                    Generate
                  </Button>
                </div>
              </div>
            ) : (
              <button
                className={styles.addBtn}
                onClick={() => setShowAddInput(true)}
                type="button"
              >
                <Plus size={16} />
                Add Voice Track
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
