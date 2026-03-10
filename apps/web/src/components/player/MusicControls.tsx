'use client';

import { useState } from 'react';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import styles from './MusicControls.module.css';

/**
 * Inline music volume controls shown in the MiniPlayer when music is loaded.
 * The "Save" button persists volume to the server (visible to all listeners).
 */
export function MusicControls() {
  const player = usePlayer();
  const [saving, setSaving] = useState(false);

  if (!player?.isMusicLoaded || !player.podcastId) return null;

  const handleSaveVolume = async () => {
    setSaving(true);
    try {
      await fetch(`/api/podcasts/${player.podcastId}/music/volume`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: player.musicVolume }),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.musicControls}>
      <button
        className={styles.muteButton}
        onClick={player.toggleMusicMute}
        aria-label={player.isMusicMuted ? 'Unmute music' : 'Mute music'}
        title={player.isMusicMuted ? 'Unmute music' : 'Mute music'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </button>
      <input
        type="range"
        className={styles.volumeSlider}
        min="0"
        max="1"
        step="0.05"
        value={player.isMusicMuted ? 0 : player.musicVolume}
        onChange={(e) => player.setMusicVolume(parseFloat(e.target.value))}
        aria-label="Music volume"
      />
      <button
        className={styles.saveButton}
        onClick={handleSaveVolume}
        disabled={saving}
        aria-label="Save music volume"
        title="Save volume for all listeners"
      >
        {saving ? '...' : 'Save'}
      </button>
    </div>
  );
}
