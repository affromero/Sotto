import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioRecorder } from '@/lib/hooks/useAudioRecorder';
import { createElement, StrictMode, type ReactNode } from 'react';

const mockStop = vi.fn();
const mockStart = vi.fn();
const mockPlay = vi.fn();
const mockPause = vi.fn();

let mockRecorderState = 'inactive';
let instances: MockMediaRecorder[] = [];
let deferStop = false;

class MockMediaRecorder {
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, opts: { mimeType: string }) {
    this.mimeType = opts.mimeType;
    instances.push(this);
  }

  start() {
    mockStart();
    mockRecorderState = 'recording';
  }

  stop() {
    mockStop();
    mockRecorderState = 'inactive';
    if (!deferStop) this.onstop?.();
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
  instances = [];
  deferStop = false;

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
    it('does not leave the prior timer running when stop completes after a new start', async () => {
      const hook = renderHook(() => useAudioRecorder());
      await act(async () => {
        await hook.result.current.startRecording();
      });
      const previous = instances[0];
      deferStop = true;
      act(() => hook.result.current.stopRecording());
      await act(async () => {
        await hook.result.current.startRecording();
      });
      act(() => {
        previous.onstop?.();
        vi.advanceTimersByTime(3000);
      });
      expect(hook.result.current.duration).toBe(3);
      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
    });
    it('keeps late audio from an older recorder out of a new recording', async () => {
      const hook = renderHook(() => useAudioRecorder());
      await act(async () => {
        await hook.result.current.startRecording();
      });
      const previous = instances[0];
      act(() => hook.result.current.reset());
      await act(async () => {
        await hook.result.current.startRecording();
      });
      const current = instances[1];
      act(() => {
        previous.ondataavailable?.({ data: new Blob(['old']) });
        current.ondataavailable?.({ data: new Blob(['fresh']) });
        hook.result.current.stopRecording();
      });
      expect(hook.result.current.recordedBlob?.size).toBe(5);
    });

    it('does not start a second recorder while one is active', async () => {
      const hook = renderHook(() => useAudioRecorder());
      await act(async () => {
        await hook.result.current.startRecording();
      });
      await act(async () => {
        await hook.result.current.startRecording();
      });
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
      expect(mockStart).toHaveBeenCalledTimes(1);
    });

    it('stops the older stream when overlapping permission requests resolve out of order', async () => {
      const stopOld = vi.fn();
      const stopNew = vi.fn();
      let old: (stream: MediaStream) => void = () => {};
      let current: (stream: MediaStream) => void = () => {};
      vi.mocked(navigator.mediaDevices.getUserMedia)
        .mockImplementationOnce(
          () =>
            new Promise<MediaStream>((resolve) => {
              old = resolve;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise<MediaStream>((resolve) => {
              current = resolve;
            })
        );
      const hook = renderHook(() => useAudioRecorder());
      let first: Promise<void>;
      let second: Promise<void>;
      act(() => {
        first = hook.result.current.startRecording();
        second = hook.result.current.startRecording();
      });
      await act(async () => {
        current({ getTracks: () => [{ stop: stopNew }] } as unknown as MediaStream);
        await second;
        old({ getTracks: () => [{ stop: stopOld }] } as unknown as MediaStream);
        await first;
      });
      expect(stopOld).toHaveBeenCalled();
      expect(stopNew).not.toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalledTimes(1);
      hook.unmount();
      expect(stopNew).toHaveBeenCalled();
    });
    it('stops a late microphone stream instead of recording after unmount', async () => {
      const stopTrack = vi.fn();
      let complete: (stream: MediaStream) => void = () => {};
      vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(
        () =>
          new Promise<MediaStream>((resolve) => {
            complete = resolve;
          })
      );
      const hook = renderHook(() => useAudioRecorder());
      let pending: Promise<void>;
      act(() => {
        pending = hook.result.current.startRecording();
      });
      hook.unmount();
      await act(async () => {
        complete({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
        await pending;
      });
      expect(stopTrack).toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('stops a late microphone stream when its class authorization changed', async () => {
      const stopTrack = vi.fn();
      let complete: (stream: MediaStream) => void = () => {};
      let authorized = true;
      vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(
        () =>
          new Promise<MediaStream>((resolve) => {
            complete = resolve;
          })
      );
      const hook = renderHook(() => useAudioRecorder());
      let pending: Promise<void>;
      act(() => {
        pending = hook.result.current.startRecording(() => authorized);
      });
      authorized = false;
      await act(async () => {
        complete({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
        await pending;
      });
      expect(stopTrack).toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(hook.result.current.isRecording).toBe(false);
    });

    it('stops the active microphone when its view is unmounted', async () => {
      const stopTrack = vi.fn();
      vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce({
        getTracks: () => [{ stop: stopTrack }],
      } as unknown as MediaStream);
      const hook = renderHook(() => useAudioRecorder());
      await act(async () => {
        await hook.result.current.startRecording();
      });
      hook.unmount();
      expect(mockStop).toHaveBeenCalled();
      expect(stopTrack).toHaveBeenCalled();
    });
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
    it('stops once at the limit under StrictMode', async () => {
      const hook = renderHook(() => useAudioRecorder({ maxSeconds: 2 }), {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(StrictMode, null, children),
      });
      await act(async () => {
        await hook.result.current.startRecording();
      });
      act(() => vi.advanceTimersByTime(3000));
      expect(hook.result.current.duration).toBe(2);
      expect(mockStop).toHaveBeenCalledTimes(1);
    });

    it('ignores an old timer tick after resetting and starting a new recorder', async () => {
      const interval = vi.spyOn(globalThis, 'setInterval');
      const hook = renderHook(() => useAudioRecorder());
      await act(async () => {
        await hook.result.current.startRecording();
      });
      const oldTick = interval.mock.calls[0][0];
      expect(typeof oldTick).toBe('function');
      act(() => hook.result.current.reset());
      await act(async () => {
        await hook.result.current.startRecording();
      });
      act(() => {
        if (typeof oldTick === 'function') oldTick();
      });
      expect(hook.result.current.duration).toBe(0);
      expect(mockStop).toHaveBeenCalledTimes(1);
      interval.mockRestore();
    });
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
      const { result } = renderHook(() => useAudioRecorder({ maxSeconds: 10 }));
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
      const { result } = renderHook(() => useAudioRecorder({ minSeconds: 10 }));
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
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new Error('denied'));
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
