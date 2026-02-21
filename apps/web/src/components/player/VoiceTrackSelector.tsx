'use client';

import { useState, useCallback } from 'react';
import { Plus, AlertTriangle, Loader2 } from 'lucide-react';
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
  isOwner: boolean;
  onTracksChange?: () => void;
}

export function VoiceTrackSelector({
  podcastId,
  podcastAudioUrl,
  podcastTitle,
  voiceTracks,
  defaultVoiceTrackId,
  isOwner,
  onTracksChange,
}: VoiceTrackSelectorProps) {
  const player = usePlayer();
  const [activeTrackId, setActiveTrackId] = useState<string | null>(defaultVoiceTrackId);
  const [managerOpen, setManagerOpen] = useState(false);

  const handleSelectOriginal = useCallback(() => {
    const currentTime = player.currentTime;
    setActiveTrackId(null);
    player.loadPodcast(podcastId, podcastAudioUrl, podcastTitle);
    setTimeout(() => player.seek(currentTime), 100);
  }, [player, podcastId, podcastAudioUrl, podcastTitle]);

  const handleSelectTrack = useCallback((track: VoiceTrackSummary) => {
    if (!track.audioUrl) return;
    const currentTime = player.currentTime;
    setActiveTrackId(track.id);
    player.loadPodcast(podcastId, track.audioUrl, podcastTitle);
    setTimeout(() => player.seek(currentTime), 100);
  }, [player, podcastId, podcastTitle]);

  // Don't render if no tracks and not owner
  const readyTracks = voiceTracks.filter(t => t.status === 'READY');
  if (readyTracks.length === 0 && !isOwner) return null;

  return (
    <>
      <div className={styles.root}>
        <span className={styles.label}>Audio</span>
        <div className={styles.pills}>
          <button
            className={`${styles.pill} ${activeTrackId === null ? styles.pillActive : ''}`}
            onClick={handleSelectOriginal}
          >
            Original
          </button>
          {voiceTracks.map(track => {
            if (track.status === 'READY') {
              return (
                <button
                  key={track.id}
                  className={`${styles.pill} ${activeTrackId === track.id ? styles.pillActive : ''}`}
                  onClick={() => handleSelectTrack(track)}
                >
                  {track.name}
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
                >
                  <Loader2 size={14} className={styles.generatingIcon} />
                  {track.name}
                </button>
              );
            }
            return null;
          })}
          {isOwner && (
            <button className={styles.addPill} onClick={() => setManagerOpen(true)}>
              <Plus size={14} />
              Add
            </button>
          )}
        </div>
      </div>

      {managerOpen && (
        <VoiceTrackManager
          podcastId={podcastId}
          voiceTracks={voiceTracks}
          isOpen={managerOpen}
          onClose={() => setManagerOpen(false)}
          onTracksChange={onTracksChange}
        />
      )}
    </>
  );
}
