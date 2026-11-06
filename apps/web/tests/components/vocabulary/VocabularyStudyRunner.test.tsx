import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    profileId: 'learner-1',
    mode,
    selfRatingSupported: true,
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
  localStorage.clear();
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

  it('treats revealing a flashcard as still learning and finishes the session', async () => {
    const start = session('FLASHCARDS');
    fetchMock.mockImplementation(async (_url, options) => {
      const input = JSON.parse(String(options?.body));
      const studied = feedback(start, 'STUDIED');
      studied.cards[0]!.feedback!.selfRating = 'UNKNOWN';
      studied.ratingSummary = { known: 0, unknown: 1, studied: 0 };
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
    expect(screen.getByRole('progressbar', { name: 'Words reviewed' })).toHaveValue(0);
    expect(screen.queryByText('station')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reveal meaning' }));
    expect(await screen.findByText('station')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Words reviewed' })).toHaveValue(1);
    expect(screen.queryByText('Recalled')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finish session' }));
    expect(await screen.findByText(/0 known · 1 still learning/)).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('rates a right swipe as known', async () => {
    const start = session('FLASHCARDS');
    fetchMock.mockImplementation(async (_url, options) => {
      const input = JSON.parse(String(options?.body));
      const rated = feedback(start, 'STUDIED');
      rated.cards[0]!.feedback!.selfRating = input.rating;
      return Response.json(rated);
    });
    render(<VocabularyStudyRunner start={start} onDone={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Know it' })).toBeEnabled());
    const card = screen.getByRole('heading', { name: 'Bahnhof' }).parentElement!;
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 160, clientY: 25 });
    await screen.findByText('Known');
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      action: 'RATE',
      rating: 'KNOWN',
    });
  });

  it('does not silently use unassessed flashcards on an older server', () => {
    const start = session('FLASHCARDS');
    delete start.selfRatingSupported;
    render(<VocabularyStudyRunner start={start} onDone={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Know it' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Update your Sotto server');
  });

  it('reloads the saved card after a conflicting rating from another device', async () => {
    const start = session('FLASHCARDS');
    const saved = feedback(start, 'STUDIED');
    saved.cards[0]!.feedback!.selfRating = 'UNKNOWN';
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Study changed.' }, { status: 409 }));
    fetchMock.mockResolvedValueOnce(Response.json(saved));
    const user = userEvent.setup();
    render(<VocabularyStudyRunner start={start} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Know it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Study changed.');
    await user.click(screen.getByRole('button', { name: 'Check saved progress' }));
    expect(await screen.findByText('Still learning')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry saved response' })).not.toBeInTheDocument();
  });

  it('retains an unconfirmed rating across a browser reload and retries the exact choice', async () => {
    const start = session('FLASHCARDS');
    fetchMock.mockRejectedValueOnce(new Error('Connection lost'));
    const user = userEvent.setup();
    const rendered = render(<VocabularyStudyRunner start={start} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Know it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    const first = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(screen.getByRole('button', { name: 'Save and leave' })).toBeDisabled();
    rendered.unmount();
    const saved = feedback(start, 'STUDIED');
    saved.cards[0]!.feedback!.selfRating = 'KNOWN';
    fetchMock.mockResolvedValueOnce(Response.json(saved));
    render(<VocabularyStudyRunner start={start} onDone={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Retry saved response' }));
    expect(await screen.findByText('Known')).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual(first);
  });

  it('keeps a rating for retry if the response belongs to another session', async () => {
    const start = session('FLASHCARDS');
    const wrong = feedback(start, 'STUDIED');
    wrong.sessionId = crypto.randomUUID();
    wrong.cards[0]!.feedback!.selfRating = 'KNOWN';
    fetchMock.mockResolvedValueOnce(Response.json(wrong));
    const user = userEvent.setup();
    render(<VocabularyStudyRunner start={start} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Know it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified');
    expect(screen.getByRole('button', { name: 'Retry saved response' })).toBeEnabled();
    expect(screen.queryByText('Known')).not.toBeInTheDocument();
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
