import { create } from 'zustand';

interface CurrentPodcast {
  id: string;
  title: string;
  creator: string;
  audioUrl: string;
}

interface PlayerStore {
  currentPodcast: CurrentPodcast | null;
  setCurrentPodcast: (podcast: CurrentPodcast) => void;
  clearPodcast: () => void;
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  currentPodcast: null,
  setCurrentPodcast: (podcast) => set({ currentPodcast: podcast }),
  clearPodcast: () => set({ currentPodcast: null }),
}));
