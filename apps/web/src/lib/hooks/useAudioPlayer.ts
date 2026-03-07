'use client';

import { useState, useRef, useCallback } from 'react';
import { PlayerState, PlayerControls } from '@/types/player';

export function useAudioPlayer(): PlayerState & PlayerControls {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState>({
    podcastId: null,
    podcastTitle: null,
    audioUrl: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    volume: 1,
    isMuted: false,
    activeVoiceTrackId: null,
  });

  function getAudio(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    if (!audioRef.current) {
      const audio = new Audio();
      audio.addEventListener('timeupdate', () => {
        setState((s) => ({ ...s, currentTime: audio.currentTime || 0 }));
      });
      audio.addEventListener('loadedmetadata', () => {
        setState((s) => ({ ...s, duration: audio.duration || 0 }));
      });
      audio.addEventListener('ended', () => {
        setState((s) => ({ ...s, isPlaying: false }));
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }

  const play = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    setState((s) => ({ ...s, isPlaying: true }));
    audio.play().catch(() => setState((s) => ({ ...s, isPlaying: false })));
  }, []);

  const pause = useCallback(() => {
    getAudio()?.pause();
    setState((s) => ({ ...s, isPlaying: false }));
  }, []);

  const toggle = useCallback(() => {
    if (state.isPlaying) pause();
    else play();
  }, [state.isPlaying, play, pause]);

  const seek = useCallback((time: number) => {
    const audio = getAudio();
    if (audio) {
      audio.currentTime = time;
      setState((s) => ({ ...s, currentTime: time }));
    }
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = getAudio();
    if (audio) {
      audio.currentTime += seconds;
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const audio = getAudio();
    if (audio) {
      audio.playbackRate = rate;
      setState((s) => ({ ...s, playbackRate: rate }));
    }
  }, []);

  const setVolume = useCallback((volume: number) => {
    const audio = getAudio();
    if (audio) {
      audio.volume = volume;
      setState((s) => ({ ...s, volume, isMuted: volume === 0 }));
    }
  }, []);

  const toggleMute = useCallback(() => {
    const audio = getAudio();
    if (audio) {
      audio.muted = !audio.muted;
      setState((s) => ({ ...s, isMuted: !s.isMuted }));
    }
  }, []);

  const setActiveVoiceTrackId = useCallback((id: string | null) => {
    setState((s) => ({ ...s, activeVoiceTrackId: id }));
  }, []);

  const loadPodcast = useCallback(
    (podcastId: string, audioUrl: string, podcastTitle?: string) => {
      const audio = getAudio();
      if (!audio) return;
      // Skip if same podcast AND same audio URL (voice track switch changes URL)
      if (state.podcastId === podcastId && state.audioUrl === audioUrl) {
        setState((s) => ({ ...s, podcastTitle: podcastTitle ?? s.podcastTitle }));
        return;
      }
      audio.src = audioUrl;
      audio.load();
      setState((s) => ({
        ...s,
        podcastId,
        podcastTitle: podcastTitle ?? null,
        audioUrl,
        currentTime: 0,
        isPlaying: false,
      }));
    },
    [state.podcastId, state.audioUrl]
  );

  const clearPodcast = useCallback(() => {
    const audio = getAudio();
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setState({
      podcastId: null,
      podcastTitle: null,
      audioUrl: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      volume: 1,
      isMuted: false,
      activeVoiceTrackId: null,
    });
  }, []);

  return {
    ...state,
    play,
    pause,
    toggle,
    seek,
    skip,
    setPlaybackRate,
    setVolume,
    toggleMute,
    setActiveVoiceTrackId,
    loadPodcast,
    clearPodcast,
  };
}
