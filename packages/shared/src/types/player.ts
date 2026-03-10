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
  activeVoiceTrackId: string | null;
  musicUrl: string | null;
  musicVolume: number;
  isMusicMuted: boolean;
  isMusicLoaded: boolean;
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
  setActiveVoiceTrackId: (id: string | null) => void;
  loadPodcast: (podcastId: string, audioUrl: string, podcastTitle?: string) => void;
  clearPodcast: () => void;
  loadMusic: (musicUrl: string, volume: number) => void;
  setMusicVolume: (volume: number) => void;
  toggleMusicMute: () => void;
  clearMusic: () => void;
}
