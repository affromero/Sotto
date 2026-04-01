'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import Image from 'next/image';
import { Plus, AlertTriangle, Loader2, ChevronDown } from 'lucide-react';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import { VoiceTrackManager } from './VoiceTrackManager';
import type { VoiceTrackSummary } from '@sotto/shared';
import styles from './VoiceTrackSelector.module.css';

interface VoiceTrackSelectorProps {
  podcastId: string;
  podcastAudioUrl: string;
  podcastTitle: string;
  voiceTracks: VoiceTrackSummary[];
  defaultVoiceTrackId: string | null;
  originalTrackName: string;
  isOwner: boolean;
  speakers: string[];
  onTracksChange?: () => void;
}

const PROVIDER_DISPLAY: Record<string, string> = {
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI',
  cartesia: 'Cartesia',
  hume: 'Hume AI',
  fal: 'Fal',
  replicate: 'Replicate',
  minimax: 'MiniMax',
  mistral: 'Mistral',
};

function buildVoiceTooltip(voices: VoiceTrackSummary['voices']): string | undefined {
  if (!voices || voices.length === 0) return undefined;
  return voices
    .map((v) => {
      const provider = v.provider ? (PROVIDER_DISPLAY[v.provider] ?? v.provider) : '';
      const voice = v.voiceName || v.voiceId || 'Auto';
      return `${v.speaker}: ${voice}${provider ? ` [${provider}]` : ''}`;
    })
    .join('\n');
}

export function VoiceTrackSelector({
  podcastId,
  podcastAudioUrl,
  podcastTitle,
  voiceTracks,
  defaultVoiceTrackId,
  originalTrackName,
  isOwner,
  speakers,
  onTracksChange,
}: VoiceTrackSelectorProps) {
  const player = usePlayer();
  const [tracks, setTracks] = useState(voiceTracks);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(defaultVoiceTrackId);
  const [managerOpen, setManagerOpen] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  // Sync from props when server data changes (e.g. full page refresh)
  useEffect(() => {
    setTracks(voiceTracks);
  }, [voiceTracks]);

  // Fetch latest tracks from API
  const fetchTracks = useCallback(async () => {
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/voice-tracks`);
      if (res.ok) {
        const updated: VoiceTrackSummary[] = await res.json();
        setTracks(updated);
      }
    } catch { /* ignore polling errors */ }
  }, [podcastId]);

  // Poll when any track is in-progress
  useEffect(() => {
    const hasInProgress = tracks.some(t =>
      t.status === 'GENERATING_AUDIO' || t.status === 'STITCHING' || t.status === 'PENDING'
    );
    if (!hasInProgress) return;

    const interval = setInterval(fetchTracks, 10000);
    return () => clearInterval(interval);
  }, [tracks, fetchTracks]);

  // Re-fetch when tab becomes visible again
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchTracks();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchTracks]);

  const handleSelectOriginal = useCallback(() => {
    const currentTime = player.currentTime;
    const wasPlaying = player.isPlaying;
    setActiveTrackId(null);
    player.setActiveVoiceTrackId(null);
    player.loadPodcast(podcastId, podcastAudioUrl, podcastTitle);
    setTimeout(() => {
      player.seek(currentTime);
      if (wasPlaying) player.play();
    }, 100);
  }, [player, podcastId, podcastAudioUrl, podcastTitle]);

  const handleSelectTrack = useCallback((track: VoiceTrackSummary) => {
    if (!track.audioUrl) return;
    const currentTime = player.currentTime;
    const wasPlaying = player.isPlaying;
    setActiveTrackId(track.id);
    player.setActiveVoiceTrackId(track.id);
    player.loadPodcast(podcastId, track.audioUrl, podcastTitle);
    setTimeout(() => {
      player.seek(currentTime);
      if (wasPlaying) player.play();
    }, 100);
  }, [player, podcastId, podcastTitle]);

  const readyTracks = useMemo(
    () => tracks.filter(t => t.status === 'READY'),
    [tracks],
  );

  const pendingProposalCount = useMemo(
    () => isOwner ? tracks.filter(t => t.proposalStatus === 'PENDING').length : 0,
    [tracks, isOwner],
  );

  const visibleTracks = useMemo(
    () => isOwner ? tracks : readyTracks,
    [tracks, readyTracks, isOwner],
  );

  // Group tracks by provider for accordion view
  const groupedByProvider = useMemo(() => {
    const groups = new Map<string, VoiceTrackSummary[]>();
    for (const track of visibleTracks) {
      if (track.status !== 'READY') continue;
      const provider = track.ttsProvider || 'unknown';
      const existing = groups.get(provider) || [];
      existing.push(track);
      groups.set(provider, existing);
    }
    return groups;
  }, [visibleTracks]);

  const useGroupedLayout = readyTracks.length > 3;

  const toggleProvider = (provider: string) => {
    setExpandedProviders(prev => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  };

  // Don't render if no tracks and not owner
  if (readyTracks.length === 0 && !isOwner) return null;

  const renderTrackPill = (track: VoiceTrackSummary) => {
    if (track.status === 'READY') {
      return (
        <button
          key={track.id}
          className={`${styles.pill} ${activeTrackId === track.id ? styles.pillActive : ''} ${track.proposalStatus === 'PENDING' ? styles.pillPending : ''}`}
          onClick={() => handleSelectTrack(track)}
          title={buildVoiceTooltip(track.voices)}
          type="button"
        >
          <span>{track.name}</span>
          {track.contributor && (
            <span className={styles.contributor}>
              {track.contributor.image && (
                <Image
                  src={track.contributor.image}
                  alt=""
                  width={16}
                  height={16}
                  className={styles.contributorAvatar}
                />
              )}
              <span className={styles.contributorName}>
                {track.contributor.handle ? `@${track.contributor.handle}` : track.contributor.name}
              </span>
            </span>
          )}
          {track.proposalStatus === 'PENDING' && isOwner && (
            <span className={styles.pendingBadge}>Pending</span>
          )}
        </button>
      );
    }
    if (isOwner && track.status === 'STALE') {
      return (
        <button
          key={track.id}
          className={styles.pill}
          onClick={() => setManagerOpen(true)}
          title="Needs regeneration"
          type="button"
        >
          <AlertTriangle size={14} className={styles.staleIcon} />
          {track.name}
        </button>
      );
    }
    if (isOwner && (track.status === 'GENERATING_AUDIO' || track.status === 'STITCHING')) {
      return (
        <button
          key={track.id}
          className={styles.pill}
          onClick={() => setManagerOpen(true)}
          disabled
          type="button"
        >
          <Loader2 size={14} className={styles.generatingIcon} />
          {track.name}
        </button>
      );
    }
    return null;
  };

  return (
    <>
      <div className={styles.root}>
        <span className={styles.label}>Audio</span>

        {!useGroupedLayout ? (
          /* Flat pill strip for ≤3 ready tracks */
          <div className={styles.pills}>
            <button
              className={`${styles.pill} ${activeTrackId === null ? styles.pillActive : ''}`}
              onClick={handleSelectOriginal}
              type="button"
            >
              {originalTrackName}
            </button>
            {visibleTracks.map(renderTrackPill)}
            {isOwner && (
              <button className={styles.addPill} onClick={() => setManagerOpen(true)} type="button">
                <Plus size={14} />
                Add
                {pendingProposalCount > 0 && (
                  <span className={styles.proposalCount}>{pendingProposalCount}</span>
                )}
              </button>
            )}
          </div>
        ) : (
          /* Grouped accordion for 4+ ready tracks */
          <div className={styles.grouped}>
            <button
              className={`${styles.pill} ${activeTrackId === null ? styles.pillActive : ''}`}
              onClick={handleSelectOriginal}
              type="button"
            >
              {originalTrackName}
            </button>
            {Array.from(groupedByProvider.entries()).map(([provider, tracks]) => (
              <div key={provider} className={styles.providerGroup}>
                <button
                  className={styles.providerHeader}
                  onClick={() => toggleProvider(provider)}
                  type="button"
                >
                  <span className={styles.providerName}>
                    {PROVIDER_DISPLAY[provider] || provider}
                  </span>
                  <span className={styles.providerCount}>({tracks.length})</span>
                  <ChevronDown
                    size={14}
                    className={`${styles.chevron} ${expandedProviders.has(provider) ? styles.chevronOpen : ''}`}
                  />
                </button>
                {expandedProviders.has(provider) && (
                  <div className={styles.providerTracks}>
                    {tracks.map(renderTrackPill)}
                  </div>
                )}
              </div>
            ))}
            {/* Owner non-ready tracks (stale, generating) */}
            {isOwner && visibleTracks.filter(t => t.status !== 'READY').map(renderTrackPill)}
            {isOwner && (
              <button className={styles.addPill} onClick={() => setManagerOpen(true)} type="button">
                <Plus size={14} />
                Add
                {pendingProposalCount > 0 && (
                  <span className={styles.proposalCount}>{pendingProposalCount}</span>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {managerOpen && (
        <VoiceTrackManager
          podcastId={podcastId}
          voiceTracks={tracks}
          speakers={speakers}
          isOpen={managerOpen}
          onClose={() => { setManagerOpen(false); fetchTracks(); }}
          onTracksChange={() => { fetchTracks(); onTracksChange?.(); }}
        />
      )}
    </>
  );
}
