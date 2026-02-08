'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { PlayerState, PlayerControls } from '@/types/player';

export function useAudioPlayer(): PlayerState & PlayerControls {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState>({
    podcastId: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    volume: 1,
    isMuted: false,
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && !audioRef.current) {
      audioRef.current = new Audio();

      audioRef.current.addEventListener('timeupdate', () => {
        setState((s) => ({ ...s, currentTime: audioRef.current?.currentTime || 0 }));
      });

      audioRef.current.addEventListener('loadedmetadata', () => {
        setState((s) => ({ ...s, duration: audioRef.current?.duration || 0 }));
      });

      audioRef.current.addEventListener('ended', () => {
        setState((s) => ({ ...s, isPlaying: false }));
      });
    }
  }, []);

  const play = useCallback(() => {
    audioRef.current?.play();
    setState((s) => ({ ...s, isPlaying: true }));
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setState((s) => ({ ...s, isPlaying: false }));
  }, []);

  const toggle = useCallback(() => {
    if (state.isPlaying) pause();
    else play();
  }, [state.isPlaying, play, pause]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setState((s) => ({ ...s, currentTime: time }));
    }
  }, []);

  const skip = useCallback((seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime += seconds;
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
      setState((s) => ({ ...s, playbackRate: rate }));
    }
  }, []);

  const setVolume = useCallback((volume: number) => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      setState((s) => ({ ...s, volume, isMuted: volume === 0 }));
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !audioRef.current.muted;
      setState((s) => ({ ...s, isMuted: !s.isMuted }));
    }
  }, []);

  const loadPodcast = useCallback((podcastId: string, audioUrl: string) => {
    if (audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.load();
      setState((s) => ({ ...s, podcastId, currentTime: 0, isPlaying: false }));
    }
  }, []);

  return { ...state, play, pause, toggle, seek, skip, setPlaybackRate, setVolume, toggleMute, loadPodcast };
}
