'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useTrack } from '@/components/providers/EventProvider';
import type { PlayerState } from '@/types/player';

const HEARTBEAT_INTERVAL_MS = 30_000;
const ABANDON_TIMEOUT_MS = 60_000;

interface TelemetryState {
  podcastId: string | null;
  isPlaying: boolean;
  lastPlayTime: number;
  cumulativeListenSeconds: number;
  pauseCount: number;
  seekCount: number;
  speedChanges: number;
  interactionCount: number;
  lastSeekTime: number;
  lastSpeedChangeTime: number;
  sessionStartTime: number;
  completionFired: boolean;
}

function initialTelemetryState(): TelemetryState {
  return {
    podcastId: null,
    isPlaying: false,
    lastPlayTime: 0,
    cumulativeListenSeconds: 0,
    pauseCount: 0,
    seekCount: 0,
    speedChanges: 0,
    interactionCount: 0,
    lastSeekTime: 0,
    lastSpeedChangeTime: 0,
    sessionStartTime: Date.now(),
    completionFired: false,
  };
}

/**
 * Wrapper hook that observes player state transitions and emits events.
 * Does NOT modify the audio player — only observes.
 *
 * @param playerState Current player state snapshot
 * @param onSeekCapture Called to capture fromPosition before seek executes
 */
export function usePlaybackTelemetry(playerState: PlayerState & { lastSeekFrom?: number }): void {
  const track = useTrack();
  const stateRef = useRef<TelemetryState>(initialTelemetryState());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abandonRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRef = useRef<PlayerState | null>(null);

  const clearAbandonTimer = useCallback(() => {
    if (abandonRef.current) {
      clearTimeout(abandonRef.current);
      abandonRef.current = null;
    }
  }, []);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    clearHeartbeat();
    heartbeatRef.current = setInterval(() => {
      const s = stateRef.current;
      if (!s.podcastId || !s.isPlaying) return;

      // Update cumulative listen time
      const now = Date.now();
      const delta = (now - s.lastPlayTime) / 1000;
      s.cumulativeListenSeconds += delta;
      s.lastPlayTime = now;

      track({
        eventType: 'playback.heartbeat',
        podcastId: s.podcastId,
        position: playerState.currentTime,
        speed: playerState.playbackRate,
        cumulativeListenSeconds: s.cumulativeListenSeconds,
      });
    }, HEARTBEAT_INTERVAL_MS);
  }, [clearHeartbeat, track, playerState.currentTime, playerState.playbackRate]);

  const startAbandonTimer = useCallback(() => {
    clearAbandonTimer();
    abandonRef.current = setTimeout(() => {
      const s = stateRef.current;
      if (!s.podcastId || s.isPlaying) return;

      const now = Date.now();
      const duration = playerState.duration || 1;
      const position = playerState.currentTime;

      track({
        eventType: 'playback.abandon',
        podcastId: s.podcastId,
        abandonPosition: position,
        abandonPercent: (position / duration) * 100,
        totalListenSeconds: s.cumulativeListenSeconds,
        lastSpeed: playerState.playbackRate,
        pauseCount: s.pauseCount,
        seekCount: s.seekCount,
        speedChanges: s.speedChanges,
        interactionCount: s.interactionCount,
        timeSinceLastSeek: s.lastSeekTime ? (now - s.lastSeekTime) / 1000 : 0,
        timeSinceLastSpeedChange: s.lastSpeedChangeTime ? (now - s.lastSpeedChangeTime) / 1000 : 0,
        sessionDuration: (now - s.sessionStartTime) / 1000,
      });
    }, ABANDON_TIMEOUT_MS);
  }, [
    clearAbandonTimer,
    track,
    playerState.currentTime,
    playerState.duration,
    playerState.playbackRate,
  ]);

  // Detect state transitions
  useEffect(() => {
    const prev = prevRef.current;
    const curr = playerState;
    const s = stateRef.current;

    // New podcast loaded
    if (curr.podcastId && curr.podcastId !== s.podcastId) {
      stateRef.current = {
        ...initialTelemetryState(),
        podcastId: curr.podcastId,
        sessionStartTime: Date.now(),
      };
    }

    if (!curr.podcastId) {
      prevRef.current = curr;
      return;
    }

    // Play transition
    if (curr.isPlaying && (!prev || !prev.isPlaying)) {
      s.isPlaying = true;
      s.lastPlayTime = Date.now();
      clearAbandonTimer();
      startHeartbeat();

      track({
        eventType: 'playback.play',
        podcastId: curr.podcastId,
        position: curr.currentTime,
        speed: curr.playbackRate,
      });
    }

    // Pause transition
    if (!curr.isPlaying && prev?.isPlaying) {
      const now = Date.now();
      const listenedSinceLast = (now - s.lastPlayTime) / 1000;
      s.cumulativeListenSeconds += listenedSinceLast;
      s.isPlaying = false;
      s.pauseCount++;
      clearHeartbeat();
      startAbandonTimer();

      track({
        eventType: 'playback.pause',
        podcastId: curr.podcastId,
        position: curr.currentTime,
        listenedSinceLast,
      });
    }

    // Seek detection (handled via lastSeekFrom set by AudioPlayerProvider)
    if ((curr as PlayerState & { lastSeekFrom?: number }).lastSeekFrom !== undefined) {
      const from = (curr as PlayerState & { lastSeekFrom?: number }).lastSeekFrom!;
      if (from !== curr.currentTime) {
        s.seekCount++;
        s.lastSeekTime = Date.now();

        track({
          eventType: 'playback.seek',
          podcastId: curr.podcastId,
          fromPosition: from,
          toPosition: curr.currentTime,
        });
      }
    }

    // Speed change detection
    if (prev && curr.playbackRate !== prev.playbackRate && curr.podcastId === prev.podcastId) {
      s.speedChanges++;
      s.lastSpeedChangeTime = Date.now();

      track({
        eventType: 'playback.speed_change',
        podcastId: curr.podcastId,
        fromSpeed: prev.playbackRate,
        toSpeed: curr.playbackRate,
        position: curr.currentTime,
      });
    }

    // Completion detection (at 95%+)
    if (curr.duration > 0 && curr.currentTime / curr.duration >= 0.95 && !s.completionFired) {
      s.completionFired = true;
      clearAbandonTimer();

      track({
        eventType: 'playback.complete',
        podcastId: curr.podcastId,
        totalListenSeconds: s.cumulativeListenSeconds,
        speed: curr.playbackRate,
        pauseCount: s.pauseCount,
        seekCount: s.seekCount,
        speedChanges: s.speedChanges,
        interactionCount: s.interactionCount,
      });
    }

    prevRef.current = { ...curr };
  }, [playerState, track, clearAbandonTimer, clearHeartbeat, startHeartbeat, startAbandonTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearHeartbeat();
      clearAbandonTimer();
    };
  }, [clearHeartbeat, clearAbandonTimer]);
}
