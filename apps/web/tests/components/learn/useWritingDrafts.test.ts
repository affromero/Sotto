import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWritingDrafts } from '@/components/learn/writing/useWritingDrafts';
import type { WritingPromptData } from '@/components/learn/classTypes';
import { pauseClassLearningProgress } from '@/components/learn/progress/useLearningProgress';

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

let endpoint = '';
let testNumber = 0;
describe('useWritingDrafts', () => {
  it('submits the latest committed draft through a previously retained submit callback', async () => {
    const { result } = renderHook(() => useWritingDrafts([prompt('latest')], endpoint));
    const submit = result.current.submit;
    act(() => result.current.setText('latest', 'Die neueste Antwort.'));
    await act(async () => expect(await submit()).toBe(true));
    expect(fetch).toHaveBeenCalledWith(
      `${endpoint}/latest`,
      expect.objectContaining({ body: JSON.stringify({ text: 'Die neueste Antwort.' }) })
    );
    expect(result.current.drafts.latest.submittedText).toBe('Die neueste Antwort.');
  });
  beforeEach(() => {
    endpoint = `/api/test-writing-${++testNumber}/writing`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(graded));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats an already graded answer as nothing to send', () => {
    const { result } = renderHook(() => useWritingDrafts([prompt('p1', 'Fertig.')], endpoint));

    expect(result.current.hasChanges).toBe(false);
    expect(result.current.changedIds).toEqual([]);
  });

  it('sends only the prompt that was edited', async () => {
    const { result } = renderHook(() =>
      useWritingDrafts([prompt('p1', 'Fertig.'), prompt('p2', 'Auch fertig.')], endpoint)
    );

    act(() => result.current.setText('p2', 'Doch nicht fertig.'));
    expect(result.current.changedIds).toEqual(['p2']);

    await act(async () => {
      await result.current.submit();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${endpoint}/p2`, expect.anything());
  });

  it('stops re-sending an answer once it is graded', async () => {
    const { result } = renderHook(() => useWritingDrafts([prompt('p1')], endpoint));

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
      useWritingDrafts([prompt('p1', 'Fertig.'), prompt('p2', 'Auch fertig.')], endpoint)
    );

    await act(async () => {
      await result.current.submit(true);
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores whitespace-only edits', () => {
    const { result } = renderHook(() => useWritingDrafts([prompt('p1', 'Fertig.')], endpoint));

    act(() => result.current.setText('p1', '  Fertig.  '));

    expect(result.current.hasChanges).toBe(false);
  });

  it('hides an earlier grade when its draft changes and restores unsent edits after leaving', () => {
    const hook = renderHook(() => useWritingDrafts([prompt('p1', 'Fertig.')], endpoint));
    act(() => hook.result.current.setText('p1', 'A revised answer'));
    expect(hook.result.current.drafts.p1.result).toBeNull();
    hook.unmount();
    const resumed = renderHook(() => useWritingDrafts([prompt('p1', 'Fertig.')], endpoint));
    expect(resumed.result.current.drafts.p1.text).toBe('A revised answer');
    expect(resumed.result.current.hasChanges).toBe(true);
  });

  it('never sends an empty answer', async () => {
    const { result } = renderHook(() => useWritingDrafts([prompt('p1')], endpoint));

    act(() => result.current.setText('p1', '   '));
    await act(async () => {
      await result.current.submit(true);
    });

    expect(result.current.hasChanges).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('holds back an answer over the route limit', () => {
    const { result } = renderHook(() => useWritingDrafts([prompt('p1')], endpoint));

    act(() => result.current.setText('p1', 'a'.repeat(4001)));

    expect(result.current.isOverLimit).toBe(true);
    expect(result.current.hasChanges).toBe(false);
  });

  it('reports a failed grade and leaves the draft pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Too long' }) })
    );
    const { result } = renderHook(() => useWritingDrafts([prompt('p1')], endpoint));

    act(() => result.current.setText('p1', 'Mein Satz.'));
    let outcome = true;
    await act(async () => {
      outcome = await result.current.submit();
    });

    expect(outcome).toBe(false);
    expect(result.current.error).toBe('Too long');
    expect(result.current.hasChanges).toBe(true);
  });

  it('keeps a returned grade but stops before the next prompt after a class check', async () => {
    let complete: (value: typeof graded) => void = () => {};
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/writing/p1'))
        return new Promise<typeof graded>((resolve) => {
          complete = resolve;
        });
      if (url.endsWith('/writing/p2')) return Promise.resolve(graded);
      return Promise.resolve(Response.json({ progressRevision: 1 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const classEndpoint = '/api/v1/classes/writing-authority';
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    const onGraded = vi.fn();
    const { result } = renderHook(() =>
      useWritingDrafts(
        [prompt('p1'), prompt('p2')],
        `${classEndpoint}/writing`,
        onGraded,
        0,
        '1',
        binding
      )
    );
    act(() => {
      result.current.setText('p1', 'First answer');
      result.current.setText('p2', 'Second answer');
    });
    let outcome: Promise<boolean>;
    act(() => {
      outcome = result.current.submit();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const hold = pauseClassLearningProgress(classEndpoint);
    hold.verify(binding);
    hold();
    await act(async () => {
      complete(graded);
      expect(await outcome).toBe(false);
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/writing/'))).toHaveLength(
      1
    );
    expect(result.current.drafts.p1.result).toBeNull();
    expect(result.current.drafts.p1.submittedText).toBeUndefined();
    expect(result.current.drafts.p2.text).toBe('Second answer');
    expect(result.current.drafts.p2.submittedText).toBeUndefined();
    expect(onGraded).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/class changed/i);
    await act(async () => {
      expect(await result.current.submit()).toBe(true);
    });
    expect(result.current.drafts.p1.result?.feedback).toBe('Better');
    expect(onGraded.mock.calls.filter(([id]) => id === 'p1')).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/writing/p1'))
    ).toHaveLength(1);
  });

  it('keeps an edit made during grading separate from the grade for the older text', async () => {
    let complete: (value: typeof graded) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementationOnce(
        () =>
          new Promise<typeof graded>((resolve) => {
            complete = resolve;
          })
      )
    );
    const { result } = renderHook(() => useWritingDrafts([prompt('p1')], endpoint));
    act(() => result.current.setText('p1', 'First answer'));
    let outcome: Promise<boolean>;
    act(() => {
      outcome = result.current.submit();
    });
    act(() => result.current.setText('p1', 'Edited answer'));
    await act(async () => {
      complete(graded);
      expect(await outcome).toBe(true);
    });
    expect(result.current.drafts.p1).toMatchObject({
      text: 'Edited answer',
      submittedText: 'First answer',
      result: null,
    });
    expect(result.current.hasChanges).toBe(true);
  });

  it('does not publish or repeat an old grade under a different class binding', async () => {
    let complete: (value: typeof graded) => void = () => {};
    const fetchMock = vi.fn().mockImplementationOnce(
      () =>
        new Promise<typeof graded>((resolve) => {
          complete = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const classEndpoint = '/api/v1/classes/writing-changed-authority';
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    const onGraded = vi.fn();
    const { result } = renderHook(() =>
      useWritingDrafts([prompt('p1')], `${classEndpoint}/writing`, onGraded, 0, '1', binding)
    );
    act(() => result.current.setText('p1', 'First answer'));
    let outcome: Promise<boolean>;
    act(() => {
      outcome = result.current.submit();
    });
    const hold = pauseClassLearningProgress(classEndpoint);
    hold.verify({ ...binding, taskMaterialRevision: 'b'.repeat(64) });
    hold();
    await act(async () => {
      complete(graded);
      expect(await outcome).toBe(false);
    });
    await act(async () => {
      expect(await result.current.submit()).toBe(false);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onGraded).not.toHaveBeenCalled();
    expect(result.current.drafts.p1.text).toBe('First answer');
    expect(result.current.drafts.p1.result).toBeNull();
  });

  it('does not attach a retained grade to the same prompt under new material', async () => {
    let complete: (value: typeof graded) => void = () => {};
    const fetchMock = vi.fn().mockImplementationOnce(
      () =>
        new Promise<typeof graded>((resolve) => {
          complete = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const classEndpoint = '/api/v1/classes/writing-retained-new-binding';
    const original = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    const changed = { ...original, taskMaterialRevision: 'b'.repeat(64) };
    const onGraded = vi.fn();
    const hook = renderHook(
      ({ binding }) =>
        useWritingDrafts([prompt('p1')], `${classEndpoint}/writing`, onGraded, 0, '1', binding),
      { initialProps: { binding: original } }
    );
    act(() => hook.result.current.setText('p1', 'First answer'));
    let outcome: Promise<boolean>;
    act(() => {
      outcome = hook.result.current.submit();
    });
    const hold = pauseClassLearningProgress(classEndpoint);
    hold.verify(changed);
    hold();
    await act(async () => {
      complete(graded);
      expect(await outcome).toBe(false);
    });
    hook.rerender({ binding: changed });
    await act(async () => {
      expect(await hook.result.current.submit()).toBe(false);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onGraded).not.toHaveBeenCalled();
    expect(hook.result.current.drafts.p1.result).toBeNull();
    expect(hook.result.current.error).toMatch(/different class material/i);
  });

  it('does not apply a retained grade to an edit batched with replay', async () => {
    let first: (value: typeof graded) => void = () => {};
    let second: (value: typeof graded) => void = () => {};
    let gradingRequests = 0;
    const fetchMock = vi.fn((url: string) => {
      if (!url.endsWith('/writing/p1'))
        return Promise.resolve(Response.json({ progressRevision: 1 }));
      gradingRequests += 1;
      return new Promise<typeof graded>((resolve) => {
        if (gradingRequests === 1) first = resolve;
        else second = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const classEndpoint = '/api/v1/classes/writing-batched-replay';
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    const onGraded = vi.fn();
    const hook = renderHook(() =>
      useWritingDrafts([prompt('p1')], `${classEndpoint}/writing`, onGraded, 0, '1', binding)
    );
    act(() => hook.result.current.setText('p1', 'First answer'));
    let firstOutcome: Promise<boolean>;
    act(() => {
      firstOutcome = hook.result.current.submit();
    });
    const hold = pauseClassLearningProgress(classEndpoint);
    await act(async () => {
      first(graded);
      expect(await firstOutcome).toBe(false);
    });
    hold.verify(binding);
    hold();
    let secondOutcome: Promise<boolean>;
    act(() => {
      hook.result.current.setText('p1', 'Edited answer');
      secondOutcome = hook.result.current.submit();
    });
    expect(onGraded).not.toHaveBeenCalled();
    expect(hook.result.current.drafts.p1.text).toBe('Edited answer');
    expect(hook.result.current.drafts.p1.result).toBeNull();
    await act(async () => {
      second(graded);
      expect(await secondOutcome).toBe(true);
    });
    expect(onGraded).toHaveBeenCalledWith('p1', expect.objectContaining({ text: 'Edited answer' }));
  });

  it('does not send an earlier draft of a later prompt changed during grading', async () => {
    let complete: (value: typeof graded) => void = () => {};
    const fetchMock = vi.fn().mockImplementationOnce(
      () =>
        new Promise<typeof graded>((resolve) => {
          complete = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(() => useWritingDrafts([prompt('p1'), prompt('p2')], endpoint));
    act(() => {
      hook.result.current.setText('p1', 'First');
      hook.result.current.setText('p2', 'Earlier');
    });
    let outcome: Promise<boolean>;
    act(() => {
      outcome = hook.result.current.submit();
    });
    act(() => hook.result.current.setText('p2', 'Revised'));
    await act(async () => {
      complete(graded);
      expect(await outcome).toBe(false);
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/writing/'))).toHaveLength(
      1
    );
    expect(hook.result.current.drafts.p2.text).toBe('Revised');
    expect(hook.result.current.drafts.p2.result).toBeNull();
    expect(hook.result.current.error).toMatch(/writing changed/i);
  });

  it('does not submit the same prompt twice before React commits', async () => {
    let complete: (value: typeof graded) => void = () => {};
    const fetchMock = vi.fn().mockImplementationOnce(
      () =>
        new Promise<typeof graded>((resolve) => {
          complete = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(() => useWritingDrafts([prompt('p1')], endpoint));
    act(() => hook.result.current.setText('p1', 'First'));
    let first: Promise<boolean>;
    let second: Promise<boolean>;
    act(() => {
      first = hook.result.current.submit();
      second = hook.result.current.submit();
    });
    expect(await second!).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete(graded);
      expect(await first).toBe(true);
    });
  });

  it('does not resend a retained grade when replay is requested twice in one batch', async () => {
    let complete: (value: typeof graded) => void = () => {};
    const fetchMock = vi.fn((url: string) =>
      url.endsWith('/writing/p1')
        ? new Promise<typeof graded>((resolve) => {
            complete = resolve;
          })
        : Promise.resolve(Response.json({ progressRevision: 1 }))
    );
    vi.stubGlobal('fetch', fetchMock);
    const classEndpoint = '/api/v1/classes/writing-double-replay';
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    const onGraded = vi.fn();
    const hook = renderHook(() =>
      useWritingDrafts([prompt('p1')], `${classEndpoint}/writing`, onGraded, 0, '1', binding)
    );
    act(() => hook.result.current.setText('p1', 'First'));
    let initial: Promise<boolean>;
    act(() => {
      initial = hook.result.current.submit();
    });
    const hold = pauseClassLearningProgress(classEndpoint);
    await act(async () => {
      complete(graded);
      expect(await initial).toBe(false);
    });
    hold.verify(binding);
    hold();
    let first: Promise<boolean>;
    let second: Promise<boolean>;
    act(() => {
      first = hook.result.current.submit();
      second = hook.result.current.submit();
    });
    expect(await first!).toBe(true);
    expect(await second!).toBe(true);
    expect(onGraded).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/writing/p1'))
    ).toHaveLength(1);
  });
});
