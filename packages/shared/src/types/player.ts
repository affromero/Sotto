export interface PlayerState {
  podcastId: string | null;
  podcastTitle: string | null;
  audioUrl: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
}

export interface PlayerControls {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  loadPodcast: (podcastId: string, audioUrl: string, podcastTitle?: string) => void;
  clearPodcast: () => void;
}
