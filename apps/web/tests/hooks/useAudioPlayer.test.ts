import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';

// Mock HTMLAudioElement
const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();
const mockLoad = vi.fn();
const mockAddEventListener = vi.fn();
const mockRemoveAttribute = vi.fn();

class MockAudio {
  src = '';
  currentTime = 0;
  duration = 0;
  playbackRate = 1;
  volume = 1;
  muted = false;
  play = mockPlay;
  pause = mockPause;
  load = mockLoad;
  addEventListener = mockAddEventListener;
  removeEventListener = vi.fn();
  removeAttribute = mockRemoveAttribute;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Audio', MockAudio);
});

describe('useAudioPlayer', () => {
  describe('initial state', () => {
    it('has null podcastId', () => {
      const { result } = renderHook(() => useAudioPlayer());
      expect(result.current.podcastId).toBeNull();
    });

    it('has null podcastTitle', () => {
      const { result } = renderHook(() => useAudioPlayer());
      expect(result.current.podcastTitle).toBeNull();
    });

    it('has null audioUrl', () => {
      const { result } = renderHook(() => useAudioPlayer());
      expect(result.current.audioUrl).toBeNull();
    });

    it('is not playing initially', () => {
      const { result } = renderHook(() => useAudioPlayer());
      expect(result.current.isPlaying).toBe(false);
    });

    it('has currentTime of 0', () => {
      const { result } = renderHook(() => useAudioPlayer());
      expect(result.current.currentTime).toBe(0);
    });

    it('has duration of 0', () => {
      const { result } = renderHook(() => useAudioPlayer());
      expect(result.current.duration).toBe(0);
    });

    it('has playbackRate of 1', () => {
      const { result } = renderHook(() => useAudioPlayer());
      expect(result.current.playbackRate).toBe(1);
    });

    it('has volume of 1', () => {
      const { result } = renderHook(() => useAudioPlayer());
      expect(result.current.volume).toBe(1);
    });

    it('is not muted initially', () => {
      const { result } = renderHook(() => useAudioPlayer());
      expect(result.current.isMuted).toBe(false);
    });
  });

  describe('play/pause controls', () => {
    it('sets isPlaying to true when play is called', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.play();
      });
      expect(result.current.isPlaying).toBe(true);
    });

    it('reverts isPlaying when play() promise rejects', async () => {
      mockPlay.mockRejectedValueOnce(new Error('not allowed'));
      const { result } = renderHook(() => useAudioPlayer());
      await act(async () => {
        result.current.play();
      });
      expect(result.current.isPlaying).toBe(false);
    });

    it('sets isPlaying to false when pause is called', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.play();
      });
      expect(result.current.isPlaying).toBe(true);
      act(() => {
        result.current.pause();
      });
      expect(result.current.isPlaying).toBe(false);
    });

    it('toggles from paused to playing', () => {
      const { result } = renderHook(() => useAudioPlayer());
      expect(result.current.isPlaying).toBe(false);
      act(() => {
        result.current.toggle();
      });
      expect(result.current.isPlaying).toBe(true);
    });

    it('toggles from playing to paused', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.play();
      });
      expect(result.current.isPlaying).toBe(true);
      act(() => {
        result.current.toggle();
      });
      expect(result.current.isPlaying).toBe(false);
    });
  });

  describe('volume controls', () => {
    it('updates volume state', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.setVolume(0.5);
      });
      expect(result.current.volume).toBe(0.5);
    });

    it('sets isMuted to true when volume is set to 0', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.setVolume(0);
      });
      expect(result.current.isMuted).toBe(true);
      expect(result.current.volume).toBe(0);
    });

    it('sets isMuted to false when volume is above 0', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.setVolume(0);
      });
      expect(result.current.isMuted).toBe(true);
      act(() => {
        result.current.setVolume(0.8);
      });
      expect(result.current.isMuted).toBe(false);
    });

    it('toggles mute state', () => {
      const { result } = renderHook(() => useAudioPlayer());
      expect(result.current.isMuted).toBe(false);
      act(() => {
        result.current.toggleMute();
      });
      expect(result.current.isMuted).toBe(true);
    });

    it('toggles mute back to unmuted', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.toggleMute();
      });
      expect(result.current.isMuted).toBe(true);
      act(() => {
        result.current.toggleMute();
      });
      expect(result.current.isMuted).toBe(false);
    });
  });

  describe('playback rate', () => {
    it('updates playback rate state', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.setPlaybackRate(1.5);
      });
      expect(result.current.playbackRate).toBe(1.5);
    });

    it('supports 2x playback rate', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.setPlaybackRate(2);
      });
      expect(result.current.playbackRate).toBe(2);
    });

    it('supports 0.5x playback rate', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.setPlaybackRate(0.5);
      });
      expect(result.current.playbackRate).toBe(0.5);
    });
  });

  describe('seek', () => {
    it('updates currentTime when seeking', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.seek(30);
      });
      expect(result.current.currentTime).toBe(30);
    });

    it('can seek to zero', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.seek(30);
      });
      act(() => {
        result.current.seek(0);
      });
      expect(result.current.currentTime).toBe(0);
    });
  });

  describe('loadPodcast', () => {
    it('sets podcastId', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.loadPodcast('podcast-1', 'https://example.com/audio.mp3');
      });
      expect(result.current.podcastId).toBe('podcast-1');
    });

    it('sets podcastTitle when provided', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.loadPodcast('podcast-1', 'https://example.com/audio.mp3', 'My Podcast');
      });
      expect(result.current.podcastTitle).toBe('My Podcast');
    });

    it('sets audioUrl', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.loadPodcast('podcast-1', 'https://example.com/audio.mp3');
      });
      expect(result.current.audioUrl).toBe('https://example.com/audio.mp3');
    });

    it('resets currentTime to 0', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.seek(45);
      });
      act(() => {
        result.current.loadPodcast('podcast-2', 'https://example.com/audio2.mp3');
      });
      expect(result.current.currentTime).toBe(0);
    });

    it('sets isPlaying to false', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.play();
      });
      act(() => {
        result.current.loadPodcast('podcast-3', 'https://example.com/audio3.mp3');
      });
      expect(result.current.isPlaying).toBe(false);
    });

    it('skips reload when same podcastId is loaded', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.loadPodcast('podcast-1', 'https://example.com/audio.mp3', 'Title 1');
      });
      act(() => {
        result.current.seek(30);
      });
      act(() => {
        result.current.loadPodcast('podcast-1', 'https://example.com/audio.mp3', 'Title 1 Updated');
      });
      expect(result.current.currentTime).toBe(30);
      expect(result.current.podcastTitle).toBe('Title 1 Updated');
    });
  });

  describe('clearPodcast', () => {
    it('resets all state to initial values', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.loadPodcast('podcast-1', 'https://example.com/audio.mp3', 'Test');
      });
      act(() => {
        result.current.play();
      });
      act(() => {
        result.current.clearPodcast();
      });
      expect(result.current.podcastId).toBeNull();
      expect(result.current.podcastTitle).toBeNull();
      expect(result.current.audioUrl).toBeNull();
      expect(result.current.isPlaying).toBe(false);
      expect(result.current.currentTime).toBe(0);
    });

    it('pauses audio before clearing', () => {
      const { result } = renderHook(() => useAudioPlayer());
      act(() => {
        result.current.loadPodcast('podcast-1', 'https://example.com/audio.mp3');
      });
      act(() => {
        result.current.clearPodcast();
      });
      expect(mockPause).toHaveBeenCalled();
    });
  });
});
