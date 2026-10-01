import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningSaveRecovery } from '@/components/learn/progress/LearningSaveRecovery';
import { useLearningProgress } from '@/components/learn/progress/useLearningProgress';

afterEach(() => vi.unstubAllGlobals());
describe('learning save recovery controls', () => {
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
