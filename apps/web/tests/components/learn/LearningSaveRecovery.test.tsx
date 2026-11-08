import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LearningSaveRecovery,
  RetainedClassWork,
} from '@/components/learn/progress/LearningSaveRecovery';
import {
  retainedLearningProgress,
  useLearningProgress,
} from '@/components/learn/progress/useLearningProgress';

afterEach(() => vi.unstubAllGlobals());
describe('learning save recovery controls', () => {
  it('shows copyable drafts from an earlier class attempt after reload', () => {
    const endpoint = '/api/v1/classes/reloaded-earlier-attempt';
    sessionStorage.setItem(
      `learning:${endpoint}/1`,
      JSON.stringify({
        revision: 2,
        pending: {
          writingDrafts: { w1: 'An earlier draft\nwith a second line' },
          answers: { q1: 1 },
        },
        answerContext: { q1: { question: 'How do you greet Ana?', option: 'Hola, Ana' } },
      })
    );
    render(<RetainedClassWork endpoint={endpoint} attempt="2" />);
    const region = screen.getByRole('region', { name: 'Retained class work' });
    expect(region).toHaveTextContent('Class attempt 1');
    expect(region).toHaveTextContent('How do you greet Ana?: Hola, Ana');
    expect(region).toHaveTextContent('An earlier draft with a second line');
  });
  it('keeps an explicit copy before allowing work on changed class material', () => {
    const endpoint = '/api/v1/classes/archive-unverified-work';
    sessionStorage.setItem(
      `learning:${endpoint}/2`,
      JSON.stringify({
        revision: 2,
        pending: { writingDrafts: { w1: 'Keep this draft' } },
      })
    );
    retainedLearningProgress(endpoint, {}, 2, '2', {
      expectedAttempt: 2,
      taskMaterialRevision: 'a'.repeat(64),
    });
    const archived = vi.fn();
    const view = render(
      <RetainedClassWork endpoint={endpoint} attempt="2" onArchived={archived} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue with current class' }));
    expect(archived).not.toHaveBeenCalled();
    expect(screen.getByText(/A copy will remain in this browser tab/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep copy and continue' }));
    expect(archived).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(`learning:${endpoint}/2`)).toBeNull();
    view.rerender(<RetainedClassWork endpoint={endpoint} attempt="2" onArchived={archived} />);
    expect(screen.getByText('Keep this draft')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with current class' })).toBeNull();
  });
  it('requires explicit deletion after copying when local storage cannot archive work', () => {
    const endpoint = '/api/v1/classes/archive-storage-failure';
    sessionStorage.setItem(
      `learning:${endpoint}/2`,
      JSON.stringify({
        revision: 2,
        pending: { writingDrafts: { w1: 'Copy this draft' } },
      })
    );
    retainedLearningProgress(endpoint, {}, 2, '2', {
      expectedAttempt: 2,
      taskMaterialRevision: 'a'.repeat(64),
    });
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage full');
    });
    const resumed = vi.fn();
    render(<RetainedClassWork endpoint={endpoint} attempt="2" onArchived={resumed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with current class' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep copy and continue' }));
    expect(resumed).not.toHaveBeenCalled();
    expect(screen.getByText('Copy this draft')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'I copied my work' }));
    expect(screen.getByText(/removes the current copy permanently/i)).toBeVisible();
    expect(resumed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete copy and continue' }));
    expect(resumed).toHaveBeenCalledOnce();
    storage.mockRestore();
  });
  it('allows confirmed recovery when all browser storage access is disabled', () => {
    const endpoint = '/api/v1/classes/archive-storage-disabled';
    sessionStorage.setItem(
      `learning:${endpoint}/2`,
      JSON.stringify({
        revision: 2,
        pending: { writingDrafts: { w1: 'Copied draft' } },
      })
    );
    retainedLearningProgress(endpoint, {}, 2, '2', {
      expectedAttempt: 2,
      taskMaterialRevision: 'a'.repeat(64),
    });
    const fail = () => {
      throw new DOMException('Storage disabled', 'SecurityError');
    };
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(fail);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(fail);
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(fail);
    const resumed = vi.fn();
    render(<RetainedClassWork endpoint={endpoint} attempt="2" onArchived={resumed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with current class' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep copy and continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'I copied my work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete copy and continue' }));
    expect(resumed).toHaveBeenCalledOnce();
    set.mockRestore();
    get.mockRestore();
    remove.mockRestore();
  });
  it('checks competing edits before the learner explicitly replaces them', async () => {
    const writes: unknown[] = [];
    const endpoint = '/api/v1/practice/visible-save-recovery';
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init)
        return Response.json({
          status: 'ready_writing',
          progressRevision: 8,
          writingDrafts: { w1: 'Another client' },
          prompts: [{ id: 'w1' }],
        });
      writes.push(JSON.parse(String(init.body)));
      return writes.length === 1
        ? Response.json({ error: 'A newer revision exists' }, { status: 409 })
        : Response.json({ progressRevision: 9 });
    });
    const hook = renderHook(
      ({ text }) => useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 7),
      { initialProps: { text: '' } }
    );
    hook.rerender({ text: 'My retained draft' });
    await waitFor(() => expect(hook.result.current).toMatch(/newer revision/));
    const view = render(<LearningSaveRecovery endpoint={endpoint} error={hook.result.current} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check saved progress' }));
    await screen.findByRole('button', { name: 'Save my local edits' });
    expect(screen.getByRole('alert').textContent).toMatch(/replace the competing values/);
    expect(writes).toEqual([{ expectedRevision: 7, writingDrafts: { w1: 'My retained draft' } }]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save my local edits' }));
    });
    await waitFor(() => expect(hook.result.current).toBe(''));
    expect(writes[1]).toEqual({ expectedRevision: 8, writingDrafts: { w1: 'My retained draft' } });
    view.rerender(<LearningSaveRecovery endpoint={endpoint} error={hook.result.current} />);
    expect(screen.queryByRole('alert')).toBeNull();
    hook.unmount();
  });
});
