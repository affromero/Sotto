import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VocabularyRefill } from '@/components/learn/vocabulary/VocabularyRefill';

const fetchMock = vi.fn<typeof fetch>();
const id = '00000000-0000-4000-8000-000000000001';
const ready = { status: 'READY', canRetry: false, added: 1, nextSessionId: id, wordIds: ['word'] };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('new vocabulary', () => {
  it('automatically starts generation when the learner runs out', async () => {
    const request = {
      operationId: id,
      generation: 1,
      triggerSessionId: null,
      sourceHash: 'a'.repeat(64),
    };
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: 'AVAILABLE', canRetry: false, request })
    );
    fetchMock.mockResolvedValueOnce(Response.json(ready));
    render(<VocabularyRefill courseId="course" profileId="learner" onContinue={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Continue with new words' })).toBeEnabled();
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(request),
    });
  });

  it('does not reopen practice after leaving during continuation', async () => {
    let resolve: (response: Response) => void = () => {};
    fetchMock.mockResolvedValueOnce(Response.json(ready));
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        })
    );
    const onContinue = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <VocabularyRefill courseId="course" profileId="learner" onContinue={onContinue} />
    );
    await user.click(await screen.findByRole('button', { name: 'Continue with new words' }));
    view.unmount();
    await act(async () => {
      resolve(
        Response.json({
          status: 'ready_vocabulary',
          kind: 'VOCAB',
          sessionId: id,
          courseId: 'course',
          profileId: 'learner',
          mode: 'FLASHCARDS',
          nativeLang: 'en',
          targetLang: 'de',
          progressRevision: 0,
          writingDrafts: {},
          receipt: null,
          cards: [{ id, prompt: 'Haus', feedback: null }],
        })
      );
    });
    expect((fetchMock.mock.calls[1]![1]?.signal as AbortSignal).aborted).toBe(true);
    expect(onContinue).not.toHaveBeenCalled();
  });
});
