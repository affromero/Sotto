import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playPresenceInputSchema } from '@sotto/shared';
import { useHostPresence } from '@/components/play/client/useHostPresence';
import { usePlayPoll } from '@/components/play/client/usePlayPoll';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('foreground game presence', () => {
  it('releases on blur, stops renewing, and uses a fresh nonce on return', async () => {
    let focused = true;
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const writes: {
      type: 'RENEW' | 'RELEASE';
      viewNonce: string;
      keepalive?: boolean;
      signal?: AbortSignal | null;
    }[] = [];
    vi.stubGlobal('fetch', async (_path: string, options: RequestInit) => {
      const body = playPresenceInputSchema.parse(JSON.parse(String(options.body)));
      writes.push({ ...body, keepalive: options.keepalive, signal: options.signal });
      return Response.json({
        hostWaiting: body.type === 'RENEW',
        expiresAt: body.type === 'RENEW' ? new Date(Date.now() + 20000).toISOString() : null,
        serverTime: new Date().toISOString(),
      });
    });
    const hook = renderHook(() => useHostPresence('waiting-room', true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.ready).toBe(true);
    const first = writes[0];
    expect(first.type).toBe('RENEW');
    await act(async () => {
      focused = false;
      window.dispatchEvent(new Event('blur'));
    });
    expect(hook.result.current.ready).toBe(false);
    expect(writes.at(-1)).toMatchObject({
      type: 'RELEASE',
      viewNonce: first.viewNonce,
      keepalive: true,
    });
    expect(first.signal?.aborted).toBe(true);
    const pausedRequests = writes.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(writes).toHaveLength(pausedRequests);
    await act(async () => {
      focused = true;
      window.dispatchEvent(new Event('focus'));
    });
    expect(hook.result.current.ready).toBe(true);
    expect(writes.at(-1)?.type).toBe('RENEW');
    expect(writes.at(-1)?.viewNonce).not.toBe(first.viewNonce);
    hook.unmount();
    expect(writes.at(-1)).toMatchObject({ type: 'RELEASE', keepalive: true });
  });

  it('does not advertise readiness while heartbeat requests fail', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'Host access unavailable.' }, { status: 503 })
    );
    const hook = renderHook(() => useHostPresence('waiting-room', true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current).toMatchObject({ ready: false, error: 'Host access unavailable.' });
    hook.unmount();
  });
});

describe('visible game polling', () => {
  it('backs off after connection loss, aborts on backgrounding and reconnects on return', async () => {
    let visible: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
    const observed: { at: number; signal?: AbortSignal | null }[] = [];
    let disconnected = true;
    vi.stubGlobal('fetch', async (_path: string, options: RequestInit) => {
      observed.push({ at: Date.now(), signal: options.signal });
      if (disconnected) throw new TypeError('Offline');
      return Response.json({ connected: true });
    });
    const load = async (signal: AbortSignal) => {
      await fetch('/api/v1/play/rooms', { signal });
    };
    const hook = renderHook(() => usePlayPoll(load, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.connection).toBe('RECONNECTING');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(observed).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(observed[1].at - observed[0].at).toBe(2000);
    await act(async () => {
      visible = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(hook.result.current.connection).toBe('PAUSED');
    expect(observed.at(-1)?.signal?.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(observed).toHaveLength(2);
    await act(async () => {
      disconnected = false;
      visible = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(hook.result.current).toMatchObject({ connection: 'CONNECTED', error: null });
    hook.unmount();
    expect(observed.at(-1)?.signal?.aborted).toBe(true);
  });
});
