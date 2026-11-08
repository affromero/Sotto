import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveClassWork,
  flushLearningProgress,
  pauseClassLearningProgress,
  quarantineClassLearningProgress,
  reconcileLearningProgress,
  retainedLearningProgress,
  retainedClassWork,
  useLearningProgress,
} from '@/components/learn/progress/useLearningProgress';

afterEach(() => vi.unstubAllGlobals());
describe('learning progress persistence', () => {
  it('keeps unmounted work quarantined until its exact class binding is verified', async () => {
    const endpoint = '/api/v1/classes/quarantine-remount';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ progressRevision: 8 }));
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(
      ({ text }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'Keep this draft' });
    const release = pauseClassLearningProgress(endpoint);
    quarantineClassLearningProgress(endpoint);
    hook.unmount();
    release();
    await expect(flushLearningProgress(endpoint, '2')).rejects.toThrow(/class check/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(retainedClassWork(endpoint, '2')[0].pending.writingDrafts?.w1).toBe('Keep this draft');
    expect(() => release.verify(binding)).toThrow(/could not be verified/i);
    const releaseReopened = pauseClassLearningProgress(endpoint);
    releaseReopened.verify(binding);
    expect(() =>
      releaseReopened.verify({ ...binding, taskMaterialRevision: 'b'.repeat(64) })
    ).toThrow(/already been used/i);
    expect(fetchMock).not.toHaveBeenCalled();
    releaseReopened();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).writingDrafts.w1).toBe(
      'Keep this draft'
    );
  });

  it('keeps old work unsent when a reopened class has a different binding', async () => {
    const endpoint = '/api/v1/classes/quarantine-new-binding';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ progressRevision: 8 }));
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(
      ({ text }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'Old draft' });
    const release = pauseClassLearningProgress(endpoint);
    quarantineClassLearningProgress(endpoint);
    hook.unmount();
    release();
    const releaseReopened = pauseClassLearningProgress(endpoint);
    releaseReopened.verify({ ...binding, taskMaterialRevision: 'b'.repeat(64) });
    releaseReopened();
    await expect(flushLearningProgress(endpoint, '2')).rejects.toThrow(/material changed/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(retainedClassWork(endpoint, '2')[0].pending.writingDrafts?.w1).toBe('Old draft');
  });

  it('does not let a stale hold verify through a newer hold', async () => {
    const endpoint = '/api/v1/classes/stale-quarantine-hold';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const old = pauseClassLearningProgress(endpoint);
    quarantineClassLearningProgress(endpoint);
    old();
    const current = pauseClassLearningProgress(endpoint);
    expect(() => old.verify(binding)).toThrow(/could not be verified/i);
    current();
    await expect(flushLearningProgress(endpoint, '2')).rejects.toThrow(/class check/i);
    const recovery = pauseClassLearningProgress(endpoint);
    recovery.verify(binding);
    recovery();
  });

  it('keeps a class quarantined when its attempt cannot be represented safely', async () => {
    const endpoint = '/api/v1/classes/unsafe-attempt';
    const hold = pauseClassLearningProgress(endpoint);
    expect(() =>
      hold.verify({
        expectedAttempt: Number.MAX_SAFE_INTEGER + 1,
        taskMaterialRevision: 'a'.repeat(64),
      })
    ).toThrow(/could not be verified/i);
    hold();
    await expect(flushLearningProgress(endpoint, '2')).rejects.toThrow(/class check/i);
  });

  it('quarantines automatically when the newest of two checks exits unverified', async () => {
    const endpoint = '/api/v1/classes/failed-overlapping-holds';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const first = pauseClassLearningProgress(endpoint);
    const second = pauseClassLearningProgress(endpoint);
    second();
    first();
    await expect(flushLearningProgress(endpoint, '2')).rejects.toThrow(/class check/i);
    const retry = pauseClassLearningProgress(endpoint);
    retry.verify(binding);
    retry();
  });

  it('keeps the verified binding authoritative when an old component rerenders', async () => {
    const endpoint = '/api/v1/classes/quarantine-old-rerender';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ progressRevision: 8 }));
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(
      ({ text }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'Old draft' });
    const old = pauseClassLearningProgress(endpoint);
    quarantineClassLearningProgress(endpoint);
    old();
    const current = pauseClassLearningProgress(endpoint);
    current.verify({ ...binding, taskMaterialRevision: 'b'.repeat(64) });
    hook.rerender({ text: 'Old draft plus latest edit' });
    current();
    await expect(flushLearningProgress(endpoint, '2')).rejects.toThrow(/material changed/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(retainedClassWork(endpoint, '2')[0].pending.writingDrafts?.w1).toBe(
      'Old draft plus latest edit'
    );
    hook.unmount();
  });

  it('checks a rehydrated browser copy against the newly verified binding', async () => {
    const endpoint = '/api/v1/classes/quarantine-stored-binding';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ progressRevision: 8 }));
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.setItem(
      `learning:${endpoint}/2`,
      JSON.stringify({ revision: 7, pending: { writingDrafts: { w1: 'Stored draft' } }, binding })
    );
    quarantineClassLearningProgress(endpoint);
    const current = pauseClassLearningProgress(endpoint);
    current.verify({ ...binding, taskMaterialRevision: 'b'.repeat(64) });
    current();
    const hook = renderHook(() => useLearningProgress(endpoint, {}, true, 7, '2', binding));
    await expect(flushLearningProgress(endpoint, '2')).rejects.toThrow(/material changed/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(retainedClassWork(endpoint, '2')[0].pending.writingDrafts?.w1).toBe('Stored draft');
    hook.unmount();
  });
  it('retains edits while checks hold the queue and resumes only after every hold is released', async () => {
    const endpoint = '/api/v1/classes/paused-queue';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ progressRevision: 8 }));
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(
      ({ text }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '' } }
    );
    const releaseFirst = pauseClassLearningProgress(endpoint);
    const releaseSecond = pauseClassLearningProgress(endpoint);
    hook.rerender({ text: 'Keep this draft' });
    await expect(flushLearningProgress(endpoint, '2')).rejects.toThrow(/class check/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      JSON.parse(sessionStorage.getItem(`learning:${endpoint}/2`)!).pending.writingDrafts.w1
    ).toBe('Keep this draft');
    expect(retainedClassWork(endpoint, '2')[0].pending.writingDrafts?.w1).toBe('Keep this draft');
    releaseFirst();
    releaseFirst();
    expect(fetchMock).not.toHaveBeenCalled();
    releaseSecond.verify(binding);
    releaseSecond();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).writingDrafts.w1).toBe(
      'Keep this draft'
    );
    hook.unmount();
  });

  it('lets an in-flight save settle without sending newer edits until the check ends', async () => {
    const endpoint = '/api/v1/classes/paused-in-flight';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    let complete: (value: Response) => void = () => {};
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
            markStarted();
          })
      )
      .mockResolvedValueOnce(Response.json({ progressRevision: 9 }));
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(
      ({ text }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'First' });
    act(() => window.dispatchEvent(new Event('pagehide')));
    await started;
    const release = pauseClassLearningProgress(endpoint);
    hook.rerender({ text: 'First and more' });
    await act(async () => {
      complete(Response.json({ progressRevision: 8 }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(sessionStorage.getItem(`learning:${endpoint}/2`)!).pending.writingDrafts.w1
    ).toBe('First and more');
    release.verify(binding);
    release();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(second).toMatchObject({ expectedRevision: 8, writingDrafts: { w1: 'First and more' } });
    hook.unmount();
  });

  it('retains later edits when an old in-flight save completes after a new binding is verified', async () => {
    const endpoint = '/api/v1/classes/quarantine-in-flight-mismatch';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    let complete: (value: Response) => void = () => {};
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
          markStarted();
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(
      ({ text }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'First' });
    act(() => window.dispatchEvent(new Event('pagehide')));
    await started;
    const hold = pauseClassLearningProgress(endpoint);
    hook.rerender({ text: 'First and more' });
    hold.verify({ ...binding, taskMaterialRevision: 'b'.repeat(64) });
    hold();
    await act(async () => {
      complete(Response.json({ progressRevision: 8 }));
    });
    await expect(flushLearningProgress(endpoint, '2')).rejects.toThrow(/material changed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(retainedClassWork(endpoint, '2')[0].pending.writingDrafts?.w1).toBe('First and more');
    hook.unmount();
  });

  it('blocks a waiting material replacement if a check starts during its save', async () => {
    const endpoint = '/api/v1/classes/pause-during-flush';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    let complete: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        })
    );
    const hook = renderHook(
      ({ text }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'Draft' });
    const outcome = flushLearningProgress(endpoint, '2').then(
      () => 'allowed',
      (error: Error) => error.message
    );
    const release = pauseClassLearningProgress(endpoint);
    await act(async () => {
      complete(Response.json({ progressRevision: 8 }));
    });
    expect(await outcome).toMatch(/class check/i);
    release.verify(binding);
    release();
    await expect(flushLearningProgress(endpoint, '2')).resolves.toBe(8);
    hook.unmount();
  });

  it('invalidates a reconciliation even when the check ends before its response arrives', async () => {
    const endpoint = '/api/v1/classes/pause-during-reconcile';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    let complete: (value: Response) => void = () => {};
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: 'Conflict' }, { status: 409 }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          })
      );
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(
      ({ text }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'Draft' });
    await expect(flushLearningProgress(endpoint, '2')).rejects.toThrow('Conflict');
    const outcome = reconcileLearningProgress(endpoint, '2', true).then(
      () => 'allowed',
      (error: Error) => error.message
    );
    const release = pauseClassLearningProgress(endpoint);
    release.verify(binding);
    release();
    await act(async () => {
      complete(
        Response.json({
          status: 'IN_PROGRESS',
          attempt: 2,
          progressRevision: 8,
          taskMaterialRevision: binding.taskMaterialRevision,
          sections: [{ questions: [], writingPrompts: [{ id: 'w1' }] }],
        })
      );
    });
    expect(await outcome).toMatch(/local edits changed/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(sessionStorage.getItem(`learning:${endpoint}/2`)!).pending.writingDrafts.w1
    ).toBe('Draft');
    hook.unmount();
  });
  it('binds class edits to the material and attempt that produced them', async () => {
    let saved: unknown;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      saved = JSON.parse(String(init?.body));
      return Response.json({ progressRevision: 8 });
    });
    const endpoint = '/api/v1/classes/bound-save';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const hook = renderHook(
      ({ answers }) => useLearningProgress(endpoint, { answers }, true, 7, '2', binding),
      { initialProps: { answers: {} as Record<string, number> } }
    );
    hook.rerender({ answers: { q1: 1 } });
    await act(async () => {
      await flushLearningProgress(endpoint, '2', 7);
    });
    expect(saved).toEqual({ answers: { q1: 1 }, expectedRevision: 7, ...binding });
    hook.unmount();
  });

  it('keeps legacy browser edits without assigning them to new class material', async () => {
    const endpoint = '/api/v1/classes/legacy-bound-work';
    sessionStorage.setItem(
      `learning:${endpoint}/2`,
      JSON.stringify({
        revision: 7,
        pending: { writingDrafts: { w1: 'Retained draft' } },
      })
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const retained = retainedLearningProgress(endpoint, {}, 7, '2', binding);
    expect(retained.writingDrafts).toBeUndefined();
    expect(retainedClassWork(endpoint, '2')[0].pending.writingDrafts).toEqual({
      w1: 'Retained draft',
    });
    await expect(flushLearningProgress(endpoint, '2', 7)).rejects.toThrow(/could not be verified/i);
    await expect(reconcileLearningProgress(endpoint, '2', true)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({ method: 'PATCH' })
    );
    expect(
      JSON.parse(sessionStorage.getItem(`learning:${endpoint}/2`)!).pending.writingDrafts.w1
    ).toBe('Retained draft');
  });

  it('does not rebind pending edits after class material changes on the same attempt', async () => {
    const endpoint = '/api/v1/classes/changed-bound-work';
    const fetchMock = vi.fn(async () => Response.json({ error: 'Unavailable' }, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const second = { expectedAttempt: 2, taskMaterialRevision: 'b'.repeat(64) };
    const hook = renderHook(
      ({ text, binding }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '', binding: first } }
    );
    hook.rerender({ text: 'Keep my draft', binding: first });
    hook.rerender({ text: 'Keep my draft', binding: second });
    await expect(flushLearningProgress(endpoint, '2', 7)).rejects.toThrow(/material changed/i);
    expect(retainedLearningProgress(endpoint, {}, 7, '2', second).writingDrafts).toBeUndefined();
    expect(retainedClassWork(endpoint, '2')[0].pending.writingDrafts).toEqual({
      w1: 'Keep my draft',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('retains the original question and selected option when material changes', () => {
    const endpoint = '/api/v1/classes/answer-copy';
    const first = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const changed = { expectedAttempt: 2, taskMaterialRevision: 'b'.repeat(64) };
    const hook = renderHook(
      ({ answer, binding }) =>
        useLearningProgress(endpoint, { answers: { q1: answer } }, true, 7, '2', binding, {
          q1: { question: 'How do you greet Ana?', option: 'Hola, Ana' },
        }),
      { initialProps: { answer: 0, binding: first } }
    );
    hook.rerender({ answer: 1, binding: first });
    hook.rerender({ answer: 1, binding: changed });
    expect(retainedClassWork(endpoint, '2')[0].answerContext.q1).toEqual({
      question: 'How do you greet Ana?',
      option: 'Hola, Ana',
    });
    hook.unmount();
  });

  it('retains complete long question and selected option text', () => {
    const endpoint = '/api/v1/classes/long-answer-copy';
    const first = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const changed = { expectedAttempt: 2, taskMaterialRevision: 'b'.repeat(64) };
    const context = { q1: { question: 'Question '.repeat(150), option: 'Answer '.repeat(100) } };
    const hook = renderHook(
      ({ answer, binding }) =>
        useLearningProgress(endpoint, { answers: { q1: answer } }, true, 7, '2', binding, context),
      { initialProps: { answer: 0, binding: first } }
    );
    hook.rerender({ answer: 1, binding: first });
    hook.rerender({ answer: 1, binding: changed });
    expect(retainedClassWork(endpoint, '2')[0].answerContext.q1).toEqual(context.q1);
    expect(JSON.parse(sessionStorage.getItem(`learning:${endpoint}/2`)!).answerContext.q1).toEqual(
      context.q1
    );
    hook.unmount();
  });

  it('warns and exposes in-memory work when browser storage is full', async () => {
    const endpoint = '/api/v1/classes/storage-full';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    const hook = renderHook(
      ({ text, materialBinding }) =>
        useLearningProgress(
          endpoint,
          { writingDrafts: { w1: text } },
          true,
          7,
          '2',
          materialBinding
        ),
      { initialProps: { text: '', materialBinding: binding } }
    );
    hook.rerender({ text: 'Keep my draft', materialBinding: binding });
    await waitFor(() => expect(hook.result.current).toMatch(/could not keep a local copy/i));
    expect(retainedClassWork(endpoint, '2')[0].pending.writingDrafts).toEqual({
      w1: 'Keep my draft',
    });
    hook.rerender({
      text: 'Keep my draft',
      materialBinding: { ...binding, taskMaterialRevision: 'b'.repeat(64) },
    });
    expect(hook.result.current).toMatch(/material changed/i);
    expect(hook.result.current).toMatch(/could not keep a local copy/i);
    storage.mockRestore();
    vi.stubGlobal('fetch', async () => Response.json({ progressRevision: 8 }));
    hook.unmount();
  });

  it('retains an unknown save after its connection times out', async () => {
    vi.useFakeTimers();
    const endpoint = '/api/v1/classes/timed-out-save';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    vi.stubGlobal(
      'fetch',
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    const hook = renderHook(
      ({ text }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'Keep this draft' });
    act(() => window.dispatchEvent(new Event('pagehide')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(hook.result.current).toMatch(/timed out.*unknown/i);
    expect(retainedLearningProgress(endpoint, {}, 7, '2', binding).writingDrafts).toEqual({
      w1: 'Keep this draft',
    });
    hook.unmount();
    vi.useRealTimers();
  });

  it('saves a new selection matching an archived answer on the previous material', async () => {
    const endpoint = '/api/v1/classes/new-selection-after-archive';
    const first = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const changed = { expectedAttempt: 2, taskMaterialRevision: 'b'.repeat(64) };
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      writes.push(JSON.parse(String(init?.body)));
      return Response.json({ progressRevision: 8 });
    });
    const hook = renderHook(
      ({ answer, binding }) =>
        useLearningProgress(endpoint, { answers: { q1: answer } }, true, 7, '2', binding),
      { initialProps: { answer: 0, binding: first } }
    );
    hook.rerender({ answer: 1, binding: first });
    hook.rerender({ answer: 0, binding: changed });
    archiveClassWork(endpoint, '2');
    hook.rerender({ answer: 0, binding: changed });
    hook.rerender({ answer: 1, binding: changed });
    await act(async () => {
      await flushLearningProgress(endpoint, '2', 7);
    });
    expect(writes).toEqual([{ expectedRevision: 7, answers: { q1: 1 }, ...changed }]);
    hook.unmount();
  });

  it('resumes the original queue if its exact material identity returns', async () => {
    const endpoint = '/api/v1/classes/restored-material';
    const first = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const changed = { expectedAttempt: 2, taskMaterialRevision: 'b'.repeat(64) };
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      writes.push(JSON.parse(String(init?.body)));
      return Response.json({ progressRevision: 8 });
    });
    const hook = renderHook(
      ({ text, binding }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '', binding: first } }
    );
    hook.rerender({ text: 'My original draft', binding: first });
    hook.rerender({ text: 'My original draft', binding: changed });
    expect(hook.result.current).toMatch(/material changed/i);
    hook.rerender({ text: 'My original draft', binding: first });
    expect(hook.result.current).toBe('');
    await act(async () => {
      await flushLearningProgress(endpoint, '2', 7);
    });
    expect(writes).toEqual([
      { expectedRevision: 7, writingDrafts: { w1: 'My original draft' }, ...first },
    ]);
    hook.unmount();
  });

  it('retains bound drafts when material changes after the recovery read', async () => {
    const endpoint = '/api/v1/classes/changed-after-read';
    const binding = { expectedAttempt: 2, taskMaterialRevision: 'a'.repeat(64) };
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init)
        return Response.json({
          status: 'IN_PROGRESS',
          attempt: 2,
          taskMaterialRevision: binding.taskMaterialRevision,
          progressRevision: 8,
          writingDrafts: { w1: 'Other draft' },
          sections: [{ questions: [], writingPrompts: [{ id: 'w1' }] }],
        });
      writes.push(JSON.parse(String(init.body)));
      return Response.json({ error: 'Class material changed' }, { status: 409 });
    });
    const hook = renderHook(
      ({ text }) =>
        useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7, '2', binding),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'My retained draft' });
    await waitFor(() => expect(hook.result.current).toMatch(/material changed/i));
    await expect(reconcileLearningProgress(endpoint, '2', true)).rejects.toThrow(
      /material changed/i
    );
    expect(writes).toEqual([
      { expectedRevision: 7, writingDrafts: { w1: 'My retained draft' }, ...binding },
      { expectedRevision: 8, writingDrafts: { w1: 'My retained draft' }, ...binding },
    ]);
    expect(retainedLearningProgress(endpoint, {}, 8, '2', binding).writingDrafts).toEqual({
      w1: 'My retained draft',
    });
    hook.unmount();
  });
  it('confirms debounced answers before returning the revision for replacement material', async () => {
    let saved: unknown;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      saved = JSON.parse(String(init?.body));
      return Response.json({ progressRevision: 8 });
    });
    const endpoint = '/api/v1/classes/flush-before-replacement';
    const hook = renderHook(
      ({ answers }) => useLearningProgress(endpoint, { answers }, true, 7, '2'),
      { initialProps: { answers: {} as Record<string, number> } }
    );
    hook.rerender({ answers: { q1: 1, q2: 0 } });
    await act(async () => {
      expect(await flushLearningProgress(endpoint, '2', 7)).toBe(8);
    });
    expect(saved).toEqual({ answers: { q1: 1, q2: 0 }, expectedRevision: 7 });
    expect(JSON.parse(sessionStorage.getItem(`learning:${endpoint}/2`)!).pending).toBeNull();
    hook.unmount();
  });

  it('waits for an in-flight save and the edits queued behind it', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saved: unknown[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      saved.push(JSON.parse(String(init?.body)));
      if (saved.length === 1) await held;
      return Response.json({ progressRevision: saved.length + 3 });
    });
    const endpoint = '/api/v1/classes/flush-serialized-edits';
    const hook = renderHook(
      ({ answers }) => useLearningProgress(endpoint, { answers }, true, 3, '1'),
      { initialProps: { answers: {} as Record<string, number> } }
    );
    hook.rerender({ answers: { q1: 1 } });
    act(() => window.dispatchEvent(new Event('pagehide')));
    hook.rerender({ answers: { q1: 1, q2: 0 } });
    let confirmed = false;
    const confirmation = flushLearningProgress(endpoint, '1', 3).then((revision) => {
      confirmed = true;
      return revision;
    });
    await Promise.resolve();
    expect(confirmed).toBe(false);
    await act(async () => {
      release();
      expect(await confirmation).toBe(5);
    });
    expect(saved).toEqual([
      { answers: { q1: 1 }, expectedRevision: 3 },
      { answers: { q2: 0 }, expectedRevision: 4 },
    ]);
    hook.unmount();
  });

  it('blocks replacement when saving fails and retains answers for recovery', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'Progress service unavailable' }, { status: 503 })
    );
    const endpoint = '/api/v1/classes/flush-failed-save';
    const hook = renderHook(
      ({ answers }) => useLearningProgress(endpoint, { answers }, true, 4, '1'),
      { initialProps: { answers: {} as Record<string, number> } }
    );
    hook.rerender({ answers: { q1: 0 } });
    await act(async () => {
      await expect(flushLearningProgress(endpoint, '1', 4)).rejects.toThrow(
        'Progress service unavailable'
      );
    });
    expect(hook.result.current).toBe('Progress service unavailable');
    expect(retainedLearningProgress(endpoint, {}, 4, '1').answers).toEqual({ q1: 0 });
    hook.unmount();
  });

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
