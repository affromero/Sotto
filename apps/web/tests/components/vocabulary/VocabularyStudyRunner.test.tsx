import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VocabularyStudySession } from '@sotto/shared';
import { VocabularyStudyRunner } from '@/components/learn/vocabulary/VocabularyStudyRunner';

const fetchMock = vi.fn<typeof fetch>();
function session(mode: VocabularyStudySession['mode'] = 'MEANING_RECALL'): VocabularyStudySession {
  return {
    status: 'ready_vocabulary',
    kind: 'VOCAB',
    sessionId: crypto.randomUUID(),
    courseId: 'german',
    mode,
    nativeLang: 'en',
    targetLang: 'de',
    progressRevision: 0,
    writingDrafts: {},
    receipt: null,
    cards: [
      {
        id: crypto.randomUUID(),
        prompt:
          mode === 'LISTENING_RECALL'
            ? 'Listen, then write its meaning.'
            : mode === 'WORD_RECALL'
              ? 'station'
              : 'Bahnhof',
        feedback: null,
      },
    ],
  };
}
function feedback(
  start: VocabularyStudySession,
  outcome: 'STUDIED' | 'ANSWERED' = 'ANSWERED'
): VocabularyStudySession {
  return {
    ...start,
    progressRevision: 2,
    cards: start.cards.map((card) => ({
      ...card,
      feedback: {
        outcome,
        lemma: 'Bahnhof',
        meaning: 'station',
        acceptedMeanings: ['train station'],
        answer: outcome === 'ANSWERED' ? 'station' : '',
        correct: outcome === 'ANSWERED' ? true : null,
        reviewedAt: new Date().toISOString(),
      },
    })),
  };
}
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('dictionary recall and study', () => {
  it('keeps meanings private until the learner retrieves and checks an answer', async () => {
    const start = session();
    fetchMock.mockImplementation(async (_url, options) =>
      Response.json(options?.method === 'PATCH' ? { progressRevision: 1 } : feedback(start))
    );
    const user = userEvent.setup();
    render(<VocabularyStudyRunner start={start} onDone={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Bahnhof' })).toBeInTheDocument();
    expect(screen.queryByText('station')).not.toBeInTheDocument();
    expect(screen.queryByText('train station')).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Its meaning' }), 'station');
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(await screen.findByText('Recalled')).toBeInTheDocument();
    expect(screen.getByText('station')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('retries the same frozen response after a lost acknowledgement', async () => {
    const start = session();
    let lost = true;
    const attempts: unknown[] = [];
    fetchMock.mockImplementation(async (_url, options) => {
      if (options?.method === 'PATCH') return Response.json({ progressRevision: 1 });
      attempts.push(JSON.parse(String(options?.body)));
      if (lost) {
        lost = false;
        throw new Error('Acknowledgement lost');
      }
      return Response.json(feedback(start));
    });
    const user = userEvent.setup();
    render(<VocabularyStudyRunner start={start} onDone={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Its meaning' }), 'station');
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry saved response' }));
    expect(await screen.findByText('Recalled')).toBeInTheDocument();
    expect(attempts).toEqual([
      { action: 'ANSWER', expectedRevision: 1, itemId: start.cards[0]!.id, answer: 'station' },
      { action: 'ANSWER', expectedRevision: 1, itemId: start.cards[0]!.id, answer: 'station' },
    ]);
  });

  it('finishes flashcard study without a score or a claimed successful recall', async () => {
    const start = session('FLASHCARDS');
    fetchMock.mockImplementation(async (_url, options) => {
      const input = JSON.parse(String(options?.body));
      const studied = feedback(start, 'STUDIED');
      return Response.json(
        input.action === 'COMPLETE'
          ? {
              ...studied,
              progressRevision: 3,
              receipt: {
                version: 1,
                type: 'VOCABULARY_STUDY',
                mode: 'FLASHCARDS',
                score: null,
                correct: 0,
                total: 1,
                reviewed: 0,
                studied: 1,
                completedAt: new Date().toISOString(),
              },
            }
          : studied
      );
    });
    const user = userEvent.setup();
    render(<VocabularyStudyRunner start={start} onDone={vi.fn()} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reveal meaning' }));
    expect(await screen.findByText('station')).toBeInTheDocument();
    expect(screen.queryByText('Recalled')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finish session' }));
    expect(await screen.findByText(/1 word studied/)).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('keeps listening words hidden and withholds word-recall pronunciation before feedback', () => {
    const first = render(
      <VocabularyStudyRunner start={session('LISTENING_RECALL')} onDone={vi.fn()} />
    );
    expect(screen.queryByText('Bahnhof')).not.toBeInTheDocument();
    expect(screen.queryByText('station')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play local pronunciation' })).toBeInTheDocument();
    first.unmount();
    render(<VocabularyStudyRunner start={session('WORD_RECALL')} onDone={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'station' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Play local pronunciation' })
    ).not.toBeInTheDocument();
  });

  it('retains a resumed draft and flushes the latest edit before leaving', async () => {
    const start = session();
    start.writingDrafts[start.cards[0]!.id] = 'train';
    const done = vi.fn();
    let saved: unknown;
    fetchMock.mockImplementation(async (_url, options) => {
      saved = JSON.parse(String(options?.body));
      return Response.json({ progressRevision: 1 });
    });
    const user = userEvent.setup();
    render(<VocabularyStudyRunner start={start} onDone={done} />);
    expect(screen.getByRole('textbox')).toHaveValue('train');
    await user.type(screen.getByRole('textbox'), ' station');
    await user.click(screen.getByRole('button', { name: 'Save and leave' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(saved).toEqual({
      writingDrafts: { [start.cards[0]!.id]: 'train station' },
      expectedRevision: 0,
    });
  });
});
