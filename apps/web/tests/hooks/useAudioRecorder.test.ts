import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioRecorder } from '@/lib/hooks/useAudioRecorder';

const mockStop = vi.fn();
const mockStart = vi.fn();
const mockPlay = vi.fn();
const mockPause = vi.fn();

let mockRecorderState = 'inactive';
let onstopCallback: (() => void) | null = null;

class MockMediaRecorder {
  mimeType: string;
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, opts: { mimeType: string }) {
    this.mimeType = opts.mimeType;
  }

  start() {
    mockStart();
    mockRecorderState = 'recording';
    onstopCallback = this.onstop;
  }

  stop() {
    mockStop();
    mockRecorderState = 'inactive';
    if (onstopCallback) onstopCallback();
  }

  get state() {
    return mockRecorderState;
  }

  static isTypeSupported(mime: string) {
    return mime === 'audio/webm;codecs=opus';
  }
}

class MockAudio {
  onended: (() => void) | null = null;
  play = mockPlay;
  pause = mockPause;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockRecorderState = 'inactive';
  onstopCallback = null;

  vi.stubGlobal('MediaRecorder', MockMediaRecorder);
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:preview'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
      }),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAudioRecorder', () => {
  describe('initial state', () => {
    it('is not recording initially', () => {
      const { result } = renderHook(() => useAudioRecorder());
      expect(result.current.isRecording).toBe(false);
    });

    it('has no recorded blob', () => {
      const { result } = renderHook(() => useAudioRecorder());
      expect(result.current.recordedBlob).toBeNull();
    });

    it('has duration of 0', () => {
      const { result } = renderHook(() => useAudioRecorder());
      expect(result.current.duration).toBe(0);
    });

    it('has no mimeType', () => {
      const { result } = renderHook(() => useAudioRecorder());
      expect(result.current.mimeType).toBeNull();
    });

    it('has no error', () => {
      const { result } = renderHook(() => useAudioRecorder());
      expect(result.current.error).toBeNull();
    });

    it('has default minSeconds of 5', () => {
      const { result } = renderHook(() => useAudioRecorder());
      expect(result.current.minSeconds).toBe(5);
    });
  });

  describe('startRecording', () => {
    it('sets isRecording to true after starting', async () => {
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      expect(result.current.isRecording).toBe(true);
    });

    it('requests microphone access', async () => {
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: true,
      });
    });

    it('sets mimeType to webm when supported', async () => {
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      expect(result.current.mimeType).toBe('audio/webm;codecs=opus');
    });

    it('sets error when microphone access denied', async () => {
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
        new Error('Permission denied')
      );
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      expect(result.current.error).toBe(
        'Microphone access denied. Please allow microphone access and try again.'
      );
      expect(result.current.isRecording).toBe(false);
    });
  });

  describe('stopRecording', () => {
    it('calls stop on the media recorder', async () => {
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        result.current.stopRecording();
      });
      expect(mockStop).toHaveBeenCalled();
    });

    it('sets isRecording to false after stopping', async () => {
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      expect(result.current.isRecording).toBe(true);
      act(() => {
        result.current.stopRecording();
      });
      expect(result.current.isRecording).toBe(false);
    });

    it('does not throw when not recording', () => {
      const { result } = renderHook(() => useAudioRecorder());
      expect(() => {
        act(() => {
          result.current.stopRecording();
        });
      }).not.toThrow();
    });
  });

  describe('duration timer', () => {
    it('increments duration each second', async () => {
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(result.current.duration).toBe(3);
    });

    it('auto-stops at maxSeconds', async () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ maxSeconds: 10 })
      );
      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(result.current.duration).toBe(10);
      expect(mockStop).toHaveBeenCalled();
    });

    it('uses default maxSeconds of 60', async () => {
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        vi.advanceTimersByTime(58000);
      });
      expect(result.current.duration).toBe(58);
      expect(mockStop).not.toHaveBeenCalled();
    });
  });

  describe('minSeconds', () => {
    it('uses custom minSeconds value', () => {
      const { result } = renderHook(() =>
        useAudioRecorder({ minSeconds: 10 })
      );
      expect(result.current.minSeconds).toBe(10);
    });
  });

  describe('reset', () => {
    it('clears recorded blob', async () => {
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        result.current.stopRecording();
      });
      act(() => {
        result.current.reset();
      });
      expect(result.current.recordedBlob).toBeNull();
    });

    it('resets duration to 0', async () => {
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      act(() => {
        result.current.stopRecording();
      });
      act(() => {
        result.current.reset();
      });
      expect(result.current.duration).toBe(0);
    });

    it('resets isRecording to false', async () => {
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        result.current.reset();
      });
      expect(result.current.isRecording).toBe(false);
    });

    it('clears error', async () => {
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
        new Error('denied')
      );
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      expect(result.current.error).not.toBeNull();
      act(() => {
        result.current.reset();
      });
      expect(result.current.error).toBeNull();
    });

    it('clears mimeType', async () => {
      const { result } = renderHook(() => useAudioRecorder());
      await act(async () => {
        await result.current.startRecording();
      });
      expect(result.current.mimeType).not.toBeNull();
      act(() => {
        result.current.reset();
      });
      expect(result.current.mimeType).toBeNull();
    });
  });

  describe('playPreview', () => {
    it('does nothing when no recorded blob', () => {
      const { result } = renderHook(() => useAudioRecorder());
      act(() => {
        result.current.playPreview();
      });
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });
  });
});
