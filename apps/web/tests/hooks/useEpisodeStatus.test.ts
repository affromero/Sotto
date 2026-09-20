import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEpisodeStatus } from '@/lib/hooks/useEpisodeStatus';

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
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    writable: true,
    configurable: true,
  });
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

function deferredStatus() {
  let resolve!: (data: { status: string }) => void;
  const body = new Promise<{ status: string }>((done) => {
    resolve = done;
  });
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: () => body } as Response);
  return resolve;
}

describe('useEpisodeStatus', () => {
  describe('initial state', () => {
    it('returns initialStatus when provided', () => {
      const { result } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' })
      );
      expect(result.current.status).toBe('SCRIPTING');
    });

    it('returns null status when no initialStatus', () => {
      const { result } = renderHook(() => useEpisodeStatus({ episodeId: null }));
      expect(result.current.status).toBeNull();
    });

    it('does not connect when episodeId is null', () => {
      renderHook(() => useEpisodeStatus({ episodeId: null }));
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it('does not connect when initialStatus is terminal', () => {
      renderHook(() => useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'READY' }));
      expect(MockEventSource.instances).toHaveLength(0);
    });
  });

  describe('SSE connection', () => {
    it('opens EventSource to the correct URL', () => {
      renderHook(() => useEpisodeStatus({ episodeId: 'pod-123', initialStatus: 'SCRIPTING' }));
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0].url).toBe('/api/v1/episodes/pod-123/stream');
    });

    it('sets isConnected=true on open', async () => {
      mockFetchStatus('SCRIPTING');
      const { result } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' })
      );
      expect(result.current.isConnected).toBe(false);

      await act(async () => {
        MockEventSource.instances[0].simulateOpen();
        await Promise.resolve();
      });
      expect(result.current.isConnected).toBe(true);
    });

    it('does a reconciliation fetch on open', async () => {
      mockFetchStatus('COMPILING');
      renderHook(() => useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' }));

      await act(async () => {
        MockEventSource.instances[0].simulateOpen();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetch).toHaveBeenCalledWith('/api/v1/episodes/pod-1', {
        signal: expect.any(AbortSignal),
      });
    });

    it('closes SSE when reconciliation fetch returns terminal status', async () => {
      mockFetchStatus('READY');
      const { result } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' })
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
    it('refetches invalidations without assigning a delayed producer status', async () => {
      const { result } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'STITCHING' })
      );
      const event = {
        kind: 'episode-invalidated',
        episodeId: 'pod-1',
        operationId: '8d9d7fa5-e156-4dad-b58d-b01bdd35dcef',
      };
      mockFetchStatus('GENERATING_AUDIO');
      await act(async () => {
        MockEventSource.instances[0].simulateMessage(event);
      });
      expect(result.current.status).toBe('GENERATING_AUDIO');
      expect(MockEventSource.instances[0].closed).toBe(false);
      mockFetchStatus('READY');
      await act(async () => {
        MockEventSource.instances[0].simulateMessage(event);
      });
      expect(result.current.status).toBe('GENERATING_AUDIO');
      await act(async () => {
        MockEventSource.instances[0].simulateMessage({
          ...event,
          operationId: '11c4bcab-7d92-4f2e-bf06-662d9c259729',
        });
      });
      expect(result.current.status).toBe('READY');
    });

    it('allows redelivery after an invalidation fetch fails', async () => {
      const { result } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'STITCHING' })
      );
      const event = {
        kind: 'episode-invalidated',
        episodeId: 'pod-1',
        operationId: '8d9d7fa5-e156-4dad-b58d-b01bdd35dcef',
      };
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection lost'));
      await act(async () => {
        MockEventSource.instances[0].simulateMessage(event);
      });
      expect(result.current.status).toBe('STITCHING');
      mockFetchStatus('READY');
      await act(async () => {
        MockEventSource.instances[0].simulateMessage(event);
      });
      expect(result.current.status).toBe('READY');
    });
    it('fetches full object on status change event', async () => {
      // First call: reconciliation on open
      mockFetchStatus('SCRIPTING');
      // Second call: reconciliation on message
      mockFetchStatus('GENERATING_AUDIO');

      const onStatusChange = vi.fn();
      renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING', onStatusChange })
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
        expect.objectContaining({ status: 'GENERATING_AUDIO' })
      );
    });

    it('closes SSE on terminal status from message', async () => {
      mockFetchStatus('SCRIPTING'); // reconciliation on open
      mockFetchStatus('READY'); // reconciliation on message

      renderHook(() => useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' }));
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

      renderHook(() => useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' }));

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

      expect(fetch).toHaveBeenCalledWith('/api/v1/episodes/pod-1', {
        signal: expect.any(AbortSignal),
      });
    });

    it('stops polling when terminal status is received', async () => {
      vi.useFakeTimers();
      mockFetchStatus('READY');

      renderHook(() => useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' }));

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

      renderHook(() => useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' }));

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
      const fetchCalls = vi
        .mocked(fetch)
        .mock.calls.filter((c) => c[0] === '/api/v1/episodes/pod-1');
      expect(fetchCalls.length).toBeLessThanOrEqual(2);
    });
  });

  describe('visibility handling', () => {
    it('skips polling when tab is hidden', async () => {
      vi.useFakeTimers();

      renderHook(() => useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' }));

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
    it('applies a slow polling response without starting competing polls', async () => {
      vi.useFakeTimers();
      const finish = deferredStatus();
      const { result } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' })
      );
      act(() => MockEventSource.instances[0].simulateError());
      await act(async () => vi.advanceTimersByTime(30_000));
      await act(async () => finish({ status: 'STITCHING' }));
      expect(result.current.status).toBe('STITCHING');
      mockFetchStatus('READY');
      await act(async () => vi.advanceTimersByTime(10_000));
      expect(result.current.status).toBe('READY');
    });

    it('finishes terminal teardown before invoking a reentrant callback', async () => {
      mockFetchStatus('READY');
      const onStatusChange = vi.fn(() =>
        MockEventSource.instances[0].simulateMessage({ status: 'STITCHING' })
      );
      const { result } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING', onStatusChange })
      );
      await act(async () => MockEventSource.instances[0].simulateOpen());
      expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'READY' }));
      expect(result.current.status).toBe('READY');
      expect(result.current.isConnected).toBe(false);
      expect(MockEventSource.instances[0].closed).toBe(true);
    });

    it('keeps newer status when an older response finishes parsing later', async () => {
      const finishOld = deferredStatus();
      const onStatusChange = vi.fn();
      const { result } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING', onStatusChange })
      );
      const source = MockEventSource.instances[0];
      await act(async () => source.simulateOpen());
      mockFetchStatus('GENERATING_AUDIO');
      await act(async () => source.simulateMessage({ status: 'GENERATING_AUDIO' }));
      await act(async () => finishOld({ status: 'READY' }));
      expect(result.current.status).toBe('GENERATING_AUDIO');
      expect(source.closed).toBe(false);
      expect(onStatusChange).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'READY' }));
    });

    it('discards responses from the previous episode and resets null and terminal selections', async () => {
      const finishOld = deferredStatus();
      const onStatusChange = vi.fn();
      const { result, rerender } = renderHook(
        ({ episodeId, initialStatus }: { episodeId: string | null; initialStatus: string }) =>
          useEpisodeStatus({ episodeId, initialStatus, onStatusChange }),
        { initialProps: { episodeId: 'pod-1' as string | null, initialStatus: 'SCRIPTING' } }
      );
      await act(async () => MockEventSource.instances[0].simulateOpen());
      rerender({ episodeId: 'pod-2', initialStatus: 'STITCHING' });
      await act(async () => finishOld({ status: 'READY' }));
      expect(result.current.status).toBe('STITCHING');
      expect(onStatusChange).not.toHaveBeenCalled();
      rerender({ episodeId: 'pod-3', initialStatus: 'FAILED' });
      expect(result.current.status).toBe('FAILED');
      expect(result.current.isConnected).toBe(false);
      rerender({ episodeId: null, initialStatus: 'FAILED' });
      expect(result.current.status).toBeNull();
    });

    it('does not notify after unmount while a response is parsing', async () => {
      const finish = deferredStatus();
      const onStatusChange = vi.fn();
      const { unmount } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', onStatusChange })
      );
      await act(async () => MockEventSource.instances[0].simulateOpen());
      const requestSignal = vi.mocked(fetch).mock.calls[0][1]?.signal;
      unmount();
      expect(requestSignal?.aborted).toBe(true);
      await act(async () => finish({ status: 'READY' }));
      expect(onStatusChange).not.toHaveBeenCalled();
    });

    it('keeps a replacement stream open when the old stream responds or errors', async () => {
      const finishOld = deferredStatus();
      const { result } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' })
      );
      const old = MockEventSource.instances[0];
      await act(async () => old.simulateOpen());
      act(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const replacement = MockEventSource.instances[1];
      mockFetchStatus('STITCHING');
      await act(async () => replacement.simulateOpen());
      await act(async () => {
        finishOld({ status: 'READY' });
        old.simulateError();
      });
      expect(result.current.status).toBe('STITCHING');
      expect(result.current.isConnected).toBe(true);
      expect(replacement.closed).toBe(false);
    });

    it('cancels pending reconnects while hidden and creates one stream when visible', async () => {
      vi.useFakeTimers();
      renderHook(() => useEpisodeStatus({ episodeId: 'pod-1' }));
      act(() => {
        MockEventSource.instances[0].simulateError();
        Object.defineProperty(document, 'visibilityState', { value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(MockEventSource.instances).toHaveLength(1);
      act(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.instances[1].closed).toBe(false);
    });

    it('accepts invalidation redelivery after a newer reconciliation supersedes it', async () => {
      const finishOld = deferredStatus();
      const event = {
        kind: 'episode-invalidated',
        episodeId: 'pod-1',
        operationId: '8d9d7fa5-e156-4dad-b58d-b01bdd35dcef',
      };
      const { result } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' })
      );
      const source = MockEventSource.instances[0];
      await act(async () => source.simulateMessage(event));
      mockFetchStatus('STITCHING');
      await act(async () => source.simulateMessage({ status: 'STITCHING' }));
      await act(async () => finishOld({ status: 'READY' }));
      expect(result.current.status).toBe('STITCHING');
      mockFetchStatus('READY');
      await act(async () => source.simulateMessage(event));
      expect(result.current.status).toBe('READY');
      expect(source.closed).toBe(true);
    });

    it('closes EventSource on unmount', () => {
      const { unmount } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' })
      );
      const es = MockEventSource.instances[0];
      expect(es.closed).toBe(false);

      unmount();
      expect(es.closed).toBe(true);
    });

    it('clears polling interval on unmount', async () => {
      vi.useFakeTimers();

      const { unmount } = renderHook(() =>
        useEpisodeStatus({ episodeId: 'pod-1', initialStatus: 'SCRIPTING' })
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
