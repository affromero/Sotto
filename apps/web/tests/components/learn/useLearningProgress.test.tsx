import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  reconcileLearningProgress,
  retainedLearningProgress,
  useLearningProgress,
} from '@/components/learn/progress/useLearningProgress';

afterEach(() => vi.unstubAllGlobals());
describe('learning progress persistence', () => {
  it('flushes the most recent draft when the learner leaves before the debounce', async () => {
    let saved: unknown;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      saved = JSON.parse(String(init?.body));
      return Response.json({ saved: true, progressRevision: 2 });
    });
    const endpoint = '/api/v1/practice/leave-before-delay';
    const hook = renderHook(
      ({ text }) => useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 1),
      { initialProps: { text: 'First draft' } }
    );
    hook.rerender({ text: 'Final unsent edit' });
    hook.unmount();
    await waitFor(() =>
      expect(saved).toEqual({ expectedRevision: 1, writingDrafts: { w1: 'Final unsent edit' } })
    );
  });

  it('serializes edits behind a pending save without overwriting them on a stale remount', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saved: unknown[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      saved.push(JSON.parse(String(init?.body)));
      if (saved.length === 1) await pending;
      return Response.json({ saved: true, progressRevision: saved.length + 2 });
    });
    const endpoint = '/api/v1/classes/stale-remount';
    const answers = renderHook(
      ({ index }) => useLearningProgress(endpoint, { answers: { q1: index } }, true, 2),
      { initialProps: { index: 0 } }
    );
    answers.rerender({ index: 1 });
    answers.unmount();
    const writing = renderHook(
      ({ text }) => useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 2),
      { initialProps: { text: 'Old draft' } }
    );
    writing.rerender({ text: 'A new draft' });
    writing.unmount();
    const stale = renderHook(() =>
      useLearningProgress(
        endpoint,
        { answers: { q1: 0 }, writingDrafts: { w1: 'Old draft' } },
        true,
        2
      )
    );
    expect(retainedLearningProgress(endpoint, {}).answers).toEqual({ q1: 1 });
    expect(retainedLearningProgress(endpoint, {}).writingDrafts).toEqual({ w1: 'A new draft' });
    await act(async () => release());
    await waitFor(() =>
      expect(saved).toEqual([
        { expectedRevision: 2, answers: { q1: 1 } },
        { expectedRevision: 3, writingDrafts: { w1: 'A new draft' } },
      ])
    );
    stale.unmount();
  });

  it('checks conflicting work and requires an explicit replacement with the current revision', async () => {
    const saved: unknown[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init)
        return Response.json({
          status: 'IN_PROGRESS',
          attempt: 4,
          progressRevision: 5,
          writingDrafts: { w1: 'Other tab' },
          sections: [{ questions: [], writingPrompts: [{ id: 'w1' }] }],
        });
      saved.push(JSON.parse(String(init.body)));
      return saved.length === 1
        ? Response.json({ error: 'A newer revision exists.' }, { status: 409 })
        : Response.json({ saved: true, progressRevision: 6 });
    });
    const endpoint = '/api/v1/classes/conflicted-work';
    const hook = renderHook(
      ({ text }) => useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 4, '4'),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'Keep this draft' });
    await waitFor(() => expect(hook.result.current).toMatch(/newer revision/i));
    expect(await reconcileLearningProgress(endpoint, '4')).toBe('conflict');
    expect(saved).toHaveLength(1);
    await act(async () => {
      await reconcileLearningProgress(endpoint, '4', true);
    });
    expect(hook.result.current).toBe('');
    expect(saved).toEqual([
      { expectedRevision: 4, writingDrafts: { w1: 'Keep this draft' } },
      { expectedRevision: 5, writingDrafts: { w1: 'Keep this draft' } },
    ]);
    hook.unmount();
  });

  it('recognizes a lost successful acknowledgement without resending paid or saved work', async () => {
    const saved: unknown[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init)
        return Response.json({
          status: 'ready',
          progressRevision: 3,
          learnerAnswers: { q1: 1 },
          items: [{ id: 'q1' }],
        });
      saved.push(JSON.parse(String(init.body)));
      throw new Error('Lost acknowledgement');
    });
    const endpoint = '/api/v1/practice/lost-acknowledgement';
    const hook = renderHook(
      ({ index }) => useLearningProgress(endpoint, { answers: { q1: index } }, true, 2),
      { initialProps: { index: 0 } }
    );
    hook.rerender({ index: 1 });
    await waitFor(() => expect(hook.result.current).toMatch(/acknowledgement/i));
    await act(async () => {
      expect(await reconcileLearningProgress(endpoint)).toBe('saved');
    });
    expect(saved).toHaveLength(1);
    expect(hook.result.current).toBe('');
    hook.unmount();
  });

  it('keeps both dispatched and newer edits in browser storage until acknowledgement', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('fetch', async () => {
      await held;
      return Response.json({ progressRevision: 2 });
    });
    const endpoint = '/api/v1/practice/reload-during-save';
    const hook = renderHook(
      ({ answers, text }) =>
        useLearningProgress(endpoint, { answers, writingDrafts: { w1: text } }, true, 1),
      { initialProps: { answers: { q1: 0 }, text: '' } }
    );
    hook.rerender({ answers: { q1: 1 }, text: '' });
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    hook.rerender({ answers: { q1: 1 }, text: 'Newer draft' });
    const snapshot = JSON.parse(sessionStorage.getItem('learning:' + endpoint + '/')!);
    expect(snapshot.pending).toEqual({ answers: { q1: 1 }, writingDrafts: { w1: 'Newer draft' } });
    await act(async () => release());
    hook.unmount();
  });

  it('uses fresh server edits after an acknowledged save while keeping stale reads from losing local work', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ progressRevision: 3 }));
    const endpoint = '/api/v1/practice/fresh-read';
    const hook = renderHook(
      ({ index }) => useLearningProgress(endpoint, { answers: { q1: index } }, true, 2),
      { initialProps: { index: 0 } }
    );
    hook.rerender({ index: 1 });
    hook.unmount();
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem('learning:' + endpoint + '/')!).pending).toBeNull()
    );
    expect(retainedLearningProgress(endpoint, { answers: { q1: 0 } }, 2).answers).toEqual({
      q1: 1,
    });
    expect(retainedLearningProgress(endpoint, { answers: { q1: 2 } }, 4).answers).toEqual({
      q1: 2,
    });
  });

  it('retains only pending edits from a cached page when the server has a newer revision', () => {
    const endpoint = '/api/v1/practice/cached-newer-server';
    sessionStorage.setItem(
      'learning:' + endpoint + '/',
      JSON.stringify({
        revision: 3,
        pending: { answers: { q1: 1 } },
        latest: { answers: { q1: 1, q2: 0 } },
        error: 'Save failed',
      })
    );
    expect(retainedLearningProgress(endpoint, { answers: { q1: 0, q2: 2 } }, 4).answers).toEqual({
      q1: 1,
      q2: 2,
    });
  });

  it('ignores malformed cached edits while preserving the authoritative server values', () => {
    const endpoint = '/api/v1/practice/malformed-cache';
    sessionStorage.setItem(
      'learning:' + endpoint + '/',
      JSON.stringify({
        revision: 3,
        pending: { answers: { q1: 20 } },
        latest: { answers: { q1: 20 } },
      })
    );
    expect(retainedLearningProgress(endpoint, { answers: { q1: 2 } }, 4).answers).toEqual({
      q1: 2,
    });
  });

  it('reports a failed explicit replacement and retains the local draft for recovery', async () => {
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) =>
      init
        ? Response.json({ error: 'Save service unavailable' }, { status: 503 })
        : Response.json({
            status: 'ready_writing',
            progressRevision: 5,
            writingDrafts: { w1: 'Other tab' },
            prompts: [{ id: 'w1' }],
          })
    );
    const endpoint = '/api/v1/practice/failed-replacement';
    const hook = renderHook(
      ({ text }) => useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 4),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'Keep my draft' });
    await waitFor(() => expect(hook.result.current).toMatch(/unavailable/));
    await expect(reconcileLearningProgress(endpoint, '', true)).rejects.toThrow(
      'Save service unavailable'
    );
    expect(retainedLearningProgress(endpoint, {}, 4).writingDrafts).toEqual({
      w1: 'Keep my draft',
    });
    hook.unmount();
  });

  it('retains local edits when the class attempt changes before reconciliation', async () => {
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) =>
      init
        ? Response.json({ error: 'Changed attempt' }, { status: 409 })
        : Response.json({ status: 'IN_PROGRESS', attempt: 3, progressRevision: 9, sections: [] })
    );
    const endpoint = '/api/v1/classes/changed-attempt';
    const hook = renderHook(
      ({ text }) => useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 4, '2'),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'Keep the previous answer' });
    await waitFor(() => expect(hook.result.current).toMatch(/changed/i));
    await expect(reconcileLearningProgress(endpoint, '2', true)).rejects.toThrow(/changed/i);
    expect(retainedLearningProgress(endpoint, {}, 4, '2').writingDrafts).toEqual({
      w1: 'Keep the previous answer',
    });
    expect(retainedLearningProgress(endpoint, {}, 9, '3').writingDrafts).toBeUndefined();
    hook.unmount();
  });
});
