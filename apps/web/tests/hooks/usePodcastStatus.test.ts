import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePodcastStatus } from '@/lib/hooks/usePodcastStatus';

// --- Mock EventSource ---
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateError() {
    this.onerror?.();
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  (globalThis as Record<string, unknown>).EventSource = MockEventSource;
  global.fetch = vi.fn();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).EventSource;
});

function mockFetchStatus(status: string, extra: Record<string, unknown> = {}) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ status, ...extra }),
  } as Response);
}

describe('usePodcastStatus', () => {
  describe('initial state', () => {
    it('returns initialStatus when provided', () => {
      const { result } = renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING' }),
      );
      expect(result.current.status).toBe('SCRIPTING');
    });

    it('returns null status when no initialStatus', () => {
      const { result } = renderHook(() =>
        usePodcastStatus({ podcastId: null }),
      );
      expect(result.current.status).toBeNull();
    });

    it('does not connect when podcastId is null', () => {
      renderHook(() => usePodcastStatus({ podcastId: null }));
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it('does not connect when initialStatus is terminal', () => {
      renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'READY' }),
      );
      expect(MockEventSource.instances).toHaveLength(0);
    });
  });

  describe('SSE connection', () => {
    it('opens EventSource to the correct URL', () => {
      renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-123', initialStatus: 'SCRIPTING' }),
      );
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0].url).toBe('/api/podcasts/pod-123/stream');
    });

    it('sets isConnected=true on open', async () => {
      mockFetchStatus('SCRIPTING');
      const { result } = renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING' }),
      );
      expect(result.current.isConnected).toBe(false);

      await act(async () => {
        MockEventSource.instances[0].simulateOpen();
        await Promise.resolve();
      });
      expect(result.current.isConnected).toBe(true);
    });

    it('does a reconciliation fetch on open', async () => {
      mockFetchStatus('VERIFYING_SCRIPT');
      renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING' }),
      );

      await act(async () => {
        MockEventSource.instances[0].simulateOpen();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetch).toHaveBeenCalledWith('/api/podcasts/pod-1');
    });

    it('closes SSE when reconciliation fetch returns terminal status', async () => {
      mockFetchStatus('READY');
      const { result } = renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING' }),
      );
      const es = MockEventSource.instances[0];

      await act(async () => {
        es.simulateOpen();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(es.closed).toBe(true);
      expect(result.current.status).toBe('READY');
    });
  });

  describe('SSE messages', () => {
    it('fetches full object on status change event', async () => {
      // First call: reconciliation on open
      mockFetchStatus('SCRIPTING');
      // Second call: reconciliation on message
      mockFetchStatus('GENERATING_AUDIO');

      const onStatusChange = vi.fn();
      renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING', onStatusChange }),
      );

      await act(async () => {
        MockEventSource.instances[0].simulateOpen();
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        MockEventSource.instances[0].simulateMessage({ status: 'GENERATING_AUDIO' });
        await Promise.resolve();
        await Promise.resolve();
      });

      // The full GET fetch is called (not just the SSE { status })
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(onStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'GENERATING_AUDIO' }),
      );
    });

    it('closes SSE on terminal status from message', async () => {
      mockFetchStatus('SCRIPTING'); // reconciliation on open
      mockFetchStatus('READY');     // reconciliation on message

      renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING' }),
      );
      const es = MockEventSource.instances[0];

      await act(async () => {
        es.simulateOpen();
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        es.simulateMessage({ status: 'READY' });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(es.closed).toBe(true);
    });
  });

  describe('fallback polling', () => {
    it('starts polling on SSE error', async () => {
      vi.useFakeTimers();
      mockFetchStatus('SCRIPTING');

      renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING' }),
      );

      await act(async () => {
        MockEventSource.instances[0].simulateError();
        await Promise.resolve();
      });

      // Advance past one poll interval
      mockFetchStatus('GENERATING_AUDIO');
      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetch).toHaveBeenCalledWith('/api/podcasts/pod-1');
    });

    it('stops polling when terminal status is received', async () => {
      vi.useFakeTimers();
      mockFetchStatus('READY');

      renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING' }),
      );

      await act(async () => {
        MockEventSource.instances[0].simulateError();
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      const callCount = vi.mocked(fetch).mock.calls.length;

      // Advance again — should NOT poll
      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
      });

      expect(vi.mocked(fetch).mock.calls.length).toBe(callCount);
    });

    it('does not stack pollers on repeated SSE errors', async () => {
      vi.useFakeTimers();

      renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING' }),
      );

      // Simulate two errors in succession
      await act(async () => {
        MockEventSource.instances[0].simulateError();
        await Promise.resolve();
      });

      // A reconnect creates a new EventSource
      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
      });

      if (MockEventSource.instances.length > 1) {
        await act(async () => {
          MockEventSource.instances[1].simulateError();
          await Promise.resolve();
        });
      }

      // Advance one poll interval — should only get ONE fetch, not two stacked
      mockFetchStatus('SCRIPTING');
      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      // Each interval tick should produce at most 1 fetch
      const fetchCalls = vi.mocked(fetch).mock.calls.filter(
        (c) => c[0] === '/api/podcasts/pod-1',
      );
      expect(fetchCalls.length).toBeLessThanOrEqual(2);
    });
  });

  describe('visibility handling', () => {
    it('skips polling when tab is hidden', async () => {
      vi.useFakeTimers();

      renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING' }),
      );

      await act(async () => {
        MockEventSource.instances[0].simulateError();
        await Promise.resolve();
      });

      Object.defineProperty(document, 'visibilityState', { value: 'hidden' });

      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
      });

      // No fetch should be made while hidden
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('closes EventSource on unmount', () => {
      const { unmount } = renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING' }),
      );
      const es = MockEventSource.instances[0];
      expect(es.closed).toBe(false);

      unmount();
      expect(es.closed).toBe(true);
    });

    it('clears polling interval on unmount', async () => {
      vi.useFakeTimers();

      const { unmount } = renderHook(() =>
        usePodcastStatus({ podcastId: 'pod-1', initialStatus: 'SCRIPTING' }),
      );

      await act(async () => {
        MockEventSource.instances[0].simulateError();
        await Promise.resolve();
      });

      unmount();

      // Advance time — no fetch should happen
      await act(async () => {
        vi.advanceTimersByTime(20_000);
        await Promise.resolve();
      });

      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
