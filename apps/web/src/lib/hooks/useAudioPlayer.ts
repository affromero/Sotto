'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { PlayerState, PlayerControls } from '@/types/player';

export function useAudioPlayer(): PlayerState & PlayerControls {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
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
    musicUrl: null,
    musicVolume: 0.15,
    isMusicMuted: false,
    isMusicLoaded: false,
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
          syncMusic(now);
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
        musicRef.current?.pause();
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }

  function getMusic(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    if (!musicRef.current) {
      const music = new Audio();
      music.loop = true;
      musicRef.current = music;
    }
    return musicRef.current;
  }

  function syncMusic(primaryTime: number) {
    const music = musicRef.current;
    if (!music || !music.src || !music.duration) return;
    const expectedPos = primaryTime % music.duration;
    if (Math.abs(music.currentTime - expectedPos) > 0.5) {
      music.currentTime = expectedPos;
    }
  }

  const play = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    setState((s) => ({ ...s, isPlaying: true }));
    audio.play().catch(() => setState((s) => ({ ...s, isPlaying: false })));
    const music = musicRef.current;
    if (music?.src) {
      music.play().catch(() => {});
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  }, []);

  const pause = useCallback(() => {
    getAudio()?.pause();
    musicRef.current?.pause();
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
      syncMusic(time);
    }
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = getAudio();
    if (audio) {
      audio.currentTime += seconds;
      syncMusic(audio.currentTime);
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const audio = getAudio();
    if (audio) {
      audio.playbackRate = rate;
      setState((s) => ({ ...s, playbackRate: rate }));
    }
    const music = musicRef.current;
    if (music) {
      music.playbackRate = rate;
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
    // Also clear music
    const music = musicRef.current;
    if (music) {
      music.pause();
      music.removeAttribute('src');
      music.load();
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
      musicUrl: null,
      musicVolume: 0.15,
      isMusicMuted: false,
      isMusicLoaded: false,
    });
  }, []);

  const loadMusic = useCallback((musicUrl: string, volume: number) => {
    const music = getMusic();
    if (!music) return;
    music.src = musicUrl;
    music.volume = volume;
    music.load();
    setState((s) => ({
      ...s,
      musicUrl,
      musicVolume: volume,
      isMusicLoaded: true,
    }));
    // If podcast is already playing, start music too
    if (state.isPlaying) {
      music.play().catch(() => {});
    }
  }, [state.isPlaying]);

  const setMusicVolume = useCallback((volume: number) => {
    const music = musicRef.current;
    if (music) {
      music.volume = volume;
    }
    setState((s) => ({ ...s, musicVolume: volume, isMusicMuted: volume === 0 }));
  }, []);

  const toggleMusicMute = useCallback(() => {
    const music = musicRef.current;
    if (music) {
      music.muted = !music.muted;
    }
    setState((s) => ({ ...s, isMusicMuted: !s.isMusicMuted }));
  }, []);

  const clearMusic = useCallback(() => {
    const music = musicRef.current;
    if (music) {
      music.pause();
      music.removeAttribute('src');
      music.load();
    }
    setState((s) => ({
      ...s,
      musicUrl: null,
      musicVolume: 0.15,
      isMusicMuted: false,
      isMusicLoaded: false,
    }));
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
    setActiveVoiceTrackId,
    loadPodcast,
    clearPodcast,
    loadMusic,
    setMusicVolume,
    toggleMusicMute,
    clearMusic,
  };
}
