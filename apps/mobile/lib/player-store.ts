import { create } from 'zustand';

interface CurrentEpisode {
  id: string;
  title: string;
  creator: string;
  audioUrl: string;
}

interface PlayerStore {
  currentEpisode: CurrentEpisode | null;
  setCurrentEpisode: (episode: CurrentEpisode) => void;
  clearEpisode: () => void;
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  currentEpisode: null,
  setCurrentEpisode: (episode) => set({ currentEpisode: episode }),
  clearEpisode: () => set({ currentEpisode: null }),
}));
