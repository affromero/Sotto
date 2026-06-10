'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface ShowcaseTogglesState {
  videoEnabled: boolean;
  setVideoEnabled: (v: boolean) => void;
  avatarEnabled: boolean;
  setAvatarEnabled: (v: boolean) => void;
}

const ShowcaseTogglesContext = createContext<ShowcaseTogglesState | null>(null);

// Returns null when outside provider (e.g. admin dashboard) instead of throwing,
// so AudioClipPlayer works both inside the provider and without it (admin dashboard).
export function useShowcaseToggles(): ShowcaseTogglesState | null {
  return useContext(ShowcaseTogglesContext);
}

export function ShowcaseTogglesProvider({ children }: { children: ReactNode }) {
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [avatarEnabled, setAvatarEnabled] = useState(false);

  return (
    <ShowcaseTogglesContext.Provider
      value={{ videoEnabled, setVideoEnabled, avatarEnabled, setAvatarEnabled }}
    >
      {children}
    </ShowcaseTogglesContext.Provider>
  );
}
