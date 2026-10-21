import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayNotebook } from '@/components/play/PlayNotebook';
import { PhraseCapture } from '@/components/play/PhraseCapture';
import { createPlayRounds } from '@/lib/play/engine';
import { projectPlayRound } from '@/lib/play/projection';

const settings = { nativeLang: 'en', targetLang: 'de', level: 'A1' } as const;
const instant = new Date().toISOString();
const phrase = {
  id: 'phrase',
  roomId: 'game',
  roundId: 'round',
  kind: 'WORD',
  text: 'Apfel',
  contextText: null,
  targetLang: 'de',
  createdAt: instant,
};
const course = {
  id: 'german-course',
  nativeLang: 'en',
  targetLang: 'de',
  currentLevel: 'A1',
  startLevel: 'A1',
  placementSource: null,
  activeClassId: null,
  curriculum: { title: 'German' },
  placement: null,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('private phrase notebook and explicit study selection', () => {
  it('shows private phrases without creating study targets until a matching course is explicitly chosen', async () => {
    const writes: { path: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        writes.push({ path, body });
        return Response.json({
          ...body,
          id: 'target',
          courseId: course.id,
          normalizedText: 'apfel',
          userMarkedDifficulty: 0,
          priorityBoost: 0,
          visualCueUrl: null,
          visualCueAlt: null,
          visualCueAttribution: null,
          visualCueProvider: null,
          pronunciationAudioUrl: null,
          lastSelectedAt: instant,
          lastPracticedAt: null,
        });
      }
      if (path === '/api/v1/courses')
        return Response.json({
          courses: [
            course,
            { ...course, id: 'spanish-course', targetLang: 'es', curriculum: { title: 'Spanish' } },
          ],
        });
      return Response.json({ phrases: [phrase], nextCursor: null });
    });
    render(<PlayNotebook />);
    await screen.findByText('Apfel');
    expect(writes).toEqual([]);
    const details = screen.getByText('Add to study').closest('details')!;
    await act(async () => {
      details.open = true;
      fireEvent(details, new Event('toggle'));
    });
    const choose = await screen.findByLabelText('Choose your course');
    expect(screen.queryByRole('option', { name: /Spanish/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add this phrase' })).toBeDisabled();
    fireEvent.change(choose, { target: { value: course.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this phrase' }));
    await screen.findByText('Added to your course.');
    expect(writes).toEqual([
      {
        path: '/api/v1/courses/german-course/learning-targets',
        body: {
          text: 'Apfel',
          kind: 'WORD',
          contextText: null,
          sourceType: 'MANUAL',
          sourceId: 'phrase',
          sourceLabel: 'Partner play',
        },
      },
    ]);
    expect(screen.getByRole('button', { name: 'Added to study' })).toBeDisabled();
  });

  it('clears cached private phrases when a refresh loses admission', async () => {
    let revoked = false;
    vi.stubGlobal('fetch', async () =>
      revoked
        ? Response.json({ error: 'unauthorized' }, { status: 401 })
        : Response.json({ phrases: [phrase], nextCursor: 'phrase' })
    );
    render(<PlayNotebook />);
    await screen.findByText('Apfel');
    revoked = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh notebook' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Apfel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older phrases' })).not.toBeInTheDocument();
  });

  it('saves only an explicit visible selection and keeps private target cards out of the partner form', async () => {
    const privateRound = createPlayRounds({
      kind: 'DESCRIBE',
      theme: 'FOOD',
      players: { HOST: settings, GUEST: settings },
    })[0];
    const learner = { ...projectPlayRound(privateRound, 'HOST'), id: 'round', order: 0 };
    const partner = { ...projectPlayRound(privateRound, 'GUEST'), id: 'round', order: 0 };
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', async (_path: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      writes.push(body);
      return Response.json({ ...phrase, ...body });
    });
    const form = render(<PhraseCapture roomId="game" round={partner} />);
    expect(screen.queryByText('Keep a word or sentence')).not.toBeInTheDocument();
    form.rerender(<PhraseCapture roomId="game" round={learner} />);
    fireEvent.change(screen.getByLabelText('Choose visible text'), { target: { value: 'Apfel' } });
    fireEvent.change(screen.getByLabelText('Keep the whole line or a part of it'), {
      target: { value: 'not on the card' },
    });
    expect(screen.getByRole('button', { name: 'Save to notebook' })).toBeDisabled();
    expect(writes).toEqual([]);
    fireEvent.change(screen.getByLabelText('Keep the whole line or a part of it'), {
      target: { value: 'Apfel' },
    });
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'WORD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to notebook' }));
    await screen.findByText('Saved to your private notebook.');
    expect(writes).toEqual([
      { roomId: 'game', roundId: 'round', text: 'Apfel', kind: 'WORD', contextText: null },
    ]);
  });
});
