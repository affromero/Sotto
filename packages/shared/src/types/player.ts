export interface PlayerState {
  episodeId: string | null;
  episodeTitle: string | null;
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
  loadEpisode: (episodeId: string, audioUrl: string, episodeTitle?: string) => void;
  clearEpisode: () => void;
}
