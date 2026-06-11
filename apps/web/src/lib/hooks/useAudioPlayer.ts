'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
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
  });

  function getAudio(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    if (!audioRef.current) {
      const audio = new Audio();
      // Use requestAnimationFrame for smooth time updates (~60fps)
      // with 50ms threshold to avoid excessive re-renders
      let rafId = 0;
      let lastReported = 0;
      const tick = () => {
        if (!audio.paused) {
          const now = audio.currentTime;
          if (Math.abs(now - lastReported) > 0.05) {
            lastReported = now;
            setState((s) => ({ ...s, currentTime: now }));
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      audio.addEventListener('play', () => { rafId = requestAnimationFrame(tick); });
      audio.addEventListener('pause', () => { cancelAnimationFrame(rafId); });
      audio.addEventListener('loadedmetadata', () => {
        setState((s) => ({ ...s, duration: audio.duration || 0 }));
      });
      audio.addEventListener('ended', () => {
        cancelAnimationFrame(rafId);
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
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  }, []);

  const pause = useCallback(() => {
    getAudio()?.pause();
    setState((s) => ({ ...s, isPlaying: false }));
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
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

  const updateMediaSession = useCallback((title: string | null, playing: boolean) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'Sotto Podcast',
      artist: 'Sotto',
    });
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, []);

  const loadPodcast = useCallback(
    (podcastId: string, audioUrl: string, podcastTitle?: string) => {
      const audio = getAudio();
      if (!audio) return;
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
      updateMediaSession(podcastTitle ?? null, false);
    },
    [state.podcastId, state.audioUrl, updateMediaSession]
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
    });
  }, []);

  // Register MediaSession handlers for lock screen / notification controls
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', play);
    navigator.mediaSession.setActionHandler('pause', pause);
    navigator.mediaSession.setActionHandler('seekforward', () => skip(15));
    navigator.mediaSession.setActionHandler('seekbackward', () => skip(-15));
  }, [play, pause, skip]);

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
    loadPodcast,
    clearPodcast,
  };
}
