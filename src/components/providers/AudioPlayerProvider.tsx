'use client';

import { createContext, useContext } from 'react';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { PlayerState, PlayerControls } from '@/types/player';

type AudioPlayerContextType = PlayerState & PlayerControls;

const AudioPlayerContext = createContext<AudioPlayerContextType | null>(null);

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const player = useAudioPlayer();

  return (
    <AudioPlayerContext.Provider value={player}>
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
