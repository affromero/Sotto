import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWritingDrafts } from '@/components/learn/writing/useWritingDrafts';
import type { WritingPromptData } from '@/components/learn/classTypes';

function prompt(id: string, previousText?: string): WritingPromptData {
  return {
    id,
    order: 0,
    task: 'Write something',
    guidance: null,
    ideas: [],
    response: previousText
      ? { text: previousText, overallScore: 0.8, corrections: [], feedback: 'Good' }
      : null,
  };
}

const graded = {
  ok: true,
  json: async () => ({ overallScore: 0.9, corrections: [], feedback: 'Better' }),
};

describe('useWritingDrafts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(graded));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats an already graded answer as nothing to send', () => {
    const { result } = renderHook(() =>
      useWritingDrafts([prompt('p1', 'Fertig.')], '/api/writing')
    );

    expect(result.current.hasChanges).toBe(false);
    expect(result.current.changedIds).toEqual([]);
  });

  it('sends only the prompt that was edited', async () => {
    const { result } = renderHook(() =>
      useWritingDrafts([prompt('p1', 'Fertig.'), prompt('p2', 'Auch fertig.')], '/api/writing')
    );

    act(() => result.current.setText('p2', 'Doch nicht fertig.'));
    expect(result.current.changedIds).toEqual(['p2']);

    await act(async () => {
      await result.current.submit();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/writing/p2', expect.anything());
  });

  it('stops re-sending an answer once it is graded', async () => {
    const { result } = renderHook(() => useWritingDrafts([prompt('p1')], '/api/writing'));

    act(() => result.current.setText('p1', 'Mein erster Satz.'));
    await act(async () => {
      await result.current.submit();
    });

    await waitFor(() => expect(result.current.hasChanges).toBe(false));

    await act(async () => {
      await result.current.submit();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-grades everything when asked with nothing changed', async () => {
    const { result } = renderHook(() =>
      useWritingDrafts([prompt('p1', 'Fertig.'), prompt('p2', 'Auch fertig.')], '/api/writing')
    );

    await act(async () => {
      await result.current.submit(true);
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores whitespace-only edits', () => {
    const { result } = renderHook(() =>
      useWritingDrafts([prompt('p1', 'Fertig.')], '/api/writing')
    );

    act(() => result.current.setText('p1', '  Fertig.  '));

    expect(result.current.hasChanges).toBe(false);
  });

  it('never sends an empty answer', async () => {
    const { result } = renderHook(() => useWritingDrafts([prompt('p1')], '/api/writing'));

    act(() => result.current.setText('p1', '   '));
    await act(async () => {
      await result.current.submit(true);
    });

    expect(result.current.hasChanges).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('holds back an answer over the route limit', () => {
    const { result } = renderHook(() => useWritingDrafts([prompt('p1')], '/api/writing'));

    act(() => result.current.setText('p1', 'a'.repeat(4001)));

    expect(result.current.isOverLimit).toBe(true);
    expect(result.current.hasChanges).toBe(false);
  });

  it('reports a failed grade and leaves the draft pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Too long' }) })
    );
    const { result } = renderHook(() => useWritingDrafts([prompt('p1')], '/api/writing'));

    act(() => result.current.setText('p1', 'Mein Satz.'));
    let outcome = true;
    await act(async () => {
      outcome = await result.current.submit();
    });

    expect(outcome).toBe(false);
    expect(result.current.error).toBe('Too long');
    expect(result.current.hasChanges).toBe(true);
  });
});
