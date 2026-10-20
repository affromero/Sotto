import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playAcknowledgedSchema } from '@sotto/shared';
import { usePlayMutation } from '@/components/play/client/usePlayMutation';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uncertain game actions', () => {
  it('retries the original idempotent body and resolves the original draft submission once confirmed', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', async (_path: string, options: RequestInit) => {
      sent.push(JSON.parse(String(options.body)));
      if (sent.length === 1) throw new TypeError('Lost response');
      return Response.json({ acknowledged: true });
    });
    const hook = renderHook(() => usePlayMutation(playAcknowledgedSchema));
    const body = { actionId: 'same-action-after-lost-response', expectedRevision: 4 };
    let submission: Promise<unknown> | undefined;
    await act(async () => {
      submission = hook.result.current.run('/api/v1/play/rooms/game/actions', body);
    });
    expect(hook.result.current).toMatchObject({ pending: true, uncertain: true, busy: false });
    body.expectedRevision = 99;
    await act(async () => {
      await Promise.all([hook.result.current.retry(), hook.result.current.retry()]);
    });
    expect(await submission).toEqual({ acknowledged: true });
    expect(sent).toEqual([
      { actionId: body.actionId, expectedRevision: 4 },
      { actionId: body.actionId, expectedRevision: 4 },
    ]);
    expect(hook.result.current).toMatchObject({ pending: false, uncertain: false, error: null });
    hook.unmount();
  });

  it('returns a refused stale action to the caller without discarding its draft or leaving a retry pending', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'The game changed. Refresh before acting.' }, { status: 409 })
    );
    const hook = renderHook(() => usePlayMutation(playAcknowledgedSchema));
    let result: unknown;
    await act(async () => {
      result = await hook.result.current.runOutcome('/api/v1/play/rooms/game/actions', {
        actionId: 'stale-action',
      });
    });
    expect(result).toEqual({ kind: 'REFUSED', status: 409 });
    expect(hook.result.current).toMatchObject({ pending: false, uncertain: false, busy: false });
    expect(hook.result.current.error).toMatch(/game changed/i);
    hook.unmount();
  });

  it('cancels the waiting caller when its room unmounts', async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', async (_path: string, options: RequestInit) => {
      signal = options.signal;
      throw new TypeError('Offline');
    });
    const hook = renderHook(() => usePlayMutation(playAcknowledgedSchema));
    let submission: Promise<unknown> | undefined;
    await act(async () => {
      submission = hook.result.current.run('/api/v1/play/rooms/game/actions', {
        actionId: 'unconfirmed-action',
      });
    });
    hook.unmount();
    expect(await submission).toBeNull();
    expect(signal?.aborted).toBe(true);
  });
});
