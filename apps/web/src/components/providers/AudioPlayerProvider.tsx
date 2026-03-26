'use client';

import { createContext, useContext, useMemo, useCallback, useState } from 'react';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { usePlaybackTelemetry } from '@/lib/hooks/usePlaybackTelemetry';
import { PlayerState, PlayerControls } from '@/types/player';

type AudioPlayerContextType = PlayerState & PlayerControls & { lastSeekFrom?: number };

const AudioPlayerContext = createContext<AudioPlayerContextType | null>(null);

function PlaybackTelemetryBridge({ playerState }: { playerState: AudioPlayerContextType }) {
  usePlaybackTelemetry(playerState);
  return null;
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const player = useAudioPlayer();
  const [lastSeekFrom, setLastSeekFrom] = useState<number | undefined>(undefined);

  // Wrap seek to capture fromPosition before it executes
  const wrappedSeek = useCallback(
    (time: number) => {
      setLastSeekFrom(player.currentTime);
      player.seek(time);
    },
    [player]
  );

  // Wrap skip to also capture fromPosition
  const wrappedSkip = useCallback(
    (seconds: number) => {
      setLastSeekFrom(player.currentTime);
      player.skip(seconds);
    },
    [player]
  );

  const value: AudioPlayerContextType = useMemo(
    () => ({
      ...player,
      seek: wrappedSeek,
      skip: wrappedSkip,
      lastSeekFrom,
    }),
    [player, wrappedSeek, wrappedSkip, lastSeekFrom]
  );

  return (
    <AudioPlayerContext.Provider value={value}>
      {value.podcastId && <PlaybackTelemetryBridge playerState={value} />}
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function usePlayer(): AudioPlayerContextType {
  const context = useContext(AudioPlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within AudioPlayerProvider');
  }
  return context;
}
