import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SpeakingExercise } from '@/components/class/SpeakingExercise';
import { SpeakingSection } from '@/components/learn/SpeakingSection';

interface SpeakingFeedbackContext {
  microphone: { blob: Blob | null };
  testBinding: { expectedAttempt: number; taskMaterialRevision: string };
}

export function registerSpeakingFeedbackCases({
  microphone,
  testBinding,
}: SpeakingFeedbackContext) {
  it('reports feedback with the exact recording identity', async () => {
    const onFeedback = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          recordingId: 'expected',
          status: 'SCORED',
          overallScore: 0.9,
          feedback: 'Bien',
        })
      )
    );
    render(
      <SpeakingSection
        endpointBase="/api/v1/classes/poll-match/speaking"
        classBinding={testBinding}
        prompts={[
          {
            id: 'p1',
            order: 1,
            targetPhrase: 'Hola',
            translation: 'Hello',
            latestRecording: { id: 'expected', status: 'GRADING', overallScore: null },
          },
        ]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onFeedback={onFeedback}
        onContinue={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'expected' }))
    );
  });

  it('does not restart a poll when its response arrives after unmount', async () => {
    vi.useFakeTimers();
    try {
      let complete: (value: Response) => void = () => {};
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          })
      );
      vi.stubGlobal('fetch', fetchMock);
      const view = render(
        <SpeakingSection
          endpointBase="/api/v1/classes/poll-unmounted/speaking"
          classBinding={testBinding}
          prompts={[
            {
              id: 'p1',
              order: 1,
              targetPhrase: 'Hola',
              translation: 'Hello',
              latestRecording: { id: 'expected', status: 'GRADING', overallScore: null },
            },
          ]}
          gate={70}
          nextName={null}
          onScore={vi.fn()}
          onContinue={vi.fn()}
        />
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      view.unmount();
      await act(async () => {
        complete(Response.json({ recordingId: 'expected', status: 'GRADING' }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('preserves an unresolved saved recording and prevents another upload', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <SpeakingSection
        endpointBase="/api/v1/classes/c/speaking"
        classBinding={testBinding}
        prompts={[
          {
            id: 'p1',
            order: 1,
            targetPhrase: 'Hola',
            translation: 'Hello',
            latestRecording: { id: 'r1', status: 'UNRESOLVED', overallScore: null },
          },
        ]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onContinue={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Your recording is saved');
    expect(screen.queryByRole('button', { name: 'Start recording your pronunciation' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires explicit charge acknowledgment before offering a new class attempt', async () => {
    const fetchMock = vi.fn(async () => Response.json({ acknowledged: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <SpeakingSection
        endpointBase="/api/v1/classes/c/speaking"
        classBinding={testBinding}
        prompts={[
          {
            id: 'p1',
            order: 1,
            targetPhrase: 'Hola',
            translation: 'Hello',
            latestRecording: { id: 'r1', status: 'UNRESOLVED', overallScore: null },
          },
        ]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onContinue={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review another attempt' }));
    expect(screen.getByText(/may still complete or incur a charge/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'I understand, continue' }));
    await screen.findByRole('button', { name: 'Start a new attempt' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/classes/c/speaking/p1/recovery',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ recordingId: 'r1', acknowledgePossibleCharges: true }),
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start a new attempt' }));
    expect(
      screen.getByRole('button', { name: 'Start recording your pronunciation' })
    ).toBeInTheDocument();
  });
  it('checks the saved acknowledgment after a lost recovery response', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('Lost response');
      return Response.json({ status: 'UNRESOLVED', recoveryAcknowledged: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <SpeakingSection
        endpointBase="/api/v1/classes/c/speaking"
        classBinding={testBinding}
        prompts={[
          {
            id: 'p1',
            order: 1,
            targetPhrase: 'Hola',
            translation: 'Hello',
            latestRecording: { id: 'r1', status: 'UNRESOLVED', overallScore: null },
          },
        ]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onContinue={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review another attempt' }));
    fireEvent.click(screen.getByRole('button', { name: 'I understand, continue' }));
    await screen.findByText('The acknowledgment could not be confirmed. Check saved recording.');
    expect(screen.queryByRole('button', { name: 'Start a new attempt' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved recording' }));
    await screen.findByRole('button', { name: 'Start a new attempt' });
  });
  it('shows unresolved saved practice without offering another upload', () => {
    render(
      <SpeakingExercise
        endpointBase="/api/v1/practice/p/speaking"
        prompts={[
          {
            id: 'p1',
            targetPhrase: 'Hola',
            translation: 'Hello',
            latestRecording: { recordingId: 'r1', status: 'UNRESOLVED', overallScore: null },
          },
        ]}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Your recording is saved');
    expect(screen.queryByRole('button', { name: 'Start recording your pronunciation' })).toBeNull();
  });
  it('shows the native instruction beside the correct communicative speaking task', () => {
    render(
      <SpeakingSection
        endpointBase="/api/v1/classes/c/speaking"
        classBinding={testBinding}
        sectionId="s1"
        prompts={[
          {
            id: 'p1',
            order: 1,
            targetPhrase: 'Pide una bebida.',
            translation: 'Sé cortés.',
            taskMode: 'COMMUNICATIVE',
          },
        ]}
        prerequisiteDirections={{
          classId: 'c',
          sourceHash: 'a'.repeat(64),
          nativeLang: 'es',
          directions: {
            guided: 'Inténtalo.',
            tasks: [
              {
                sectionId: 's1',
                taskId: 'p1',
                kind: 'speaking',
                instruction: 'Haz la petición con tus propias palabras.',
              },
            ],
          },
        }}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onContinue={vi.fn()}
      />
    );
    const card = screen.getByRole('article', { name: 'Speaking prompt 1 of 1' });
    expect(card).toHaveAccessibleDescription('Haz la petición con tus propias palabras.');
    expect(screen.getByText('Haz la petición con tus propias palabras.')).toHaveAttribute(
      'lang',
      'es'
    );
  });
  it.each(['practice', 'class'] as const)(
    'presents an independent %s response task without read-aloud guidance',
    async (kind) => {
      const prompt = {
        id: 'free-task',
        order: 1,
        targetPhrase: 'Request a vegetarian meal and explain your dietary constraint.',
        translation: 'Address the server politely.',
        taskMode: 'COMMUNICATIVE' as const,
        assessmentScope: 'PRIVATE_SOURCE' as const,
        ipa: 'answer pronunciation',
        referenceTtsUrl: '/forbidden-answer.mp3',
      };
      render(
        kind === 'class' ? (
          <SpeakingSection
            endpointBase="/api/v1/classes/free/speaking"
            classBinding={testBinding}
            prompts={[prompt]}
            gate={70}
            nextName={null}
            onScore={() => {}}
            onContinue={() => {}}
          />
        ) : (
          <SpeakingExercise endpointBase="/api/v1/practice/free/speaking" prompts={[prompt]} />
        )
      );
      expect(
        await screen.findByRole('button', { name: 'Start recording your response' })
      ).toBeTruthy();
      expect(screen.getByText(prompt.targetPhrase)).toBeTruthy();
      expect(
        screen.getByText(
          'Private source feedback. This practice does not count toward level mastery.'
        )
      ).toBeTruthy();
      expect(screen.getByText(/communicative goal/)).toBeTruthy();
      expect(screen.queryByText('Say this')).toBeNull();
      expect(screen.queryByText('answer pronunciation')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Play reference pronunciation' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Start recording your pronunciation' })
      ).toBeNull();
    }
  );
  it.each(['practice', 'class'] as const)(
    'retains an unknown %s upload when another recording appears',
    async (kind) => {
      const endpoint = `/api/v1/${kind === 'class' ? 'classes' : 'practice'}/unknown-${kind}/speaking`;
      const uploads: string[] = [];
      let recordingId = 'earlier-score';
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          uploads.push(String(input));
          throw new Error('Lost acknowledgement');
        }
        const latestRecording = {
          recordingId,
          id: recordingId,
          status: 'SCORED',
          overallScore: 0.8,
          transcript: 'Hallo Mia',
          feedback: 'Both words recognized.',
        };
        return Response.json(
          kind === 'class'
            ? {
                id: 'unknown-class',
                attempt: 1,
                taskMaterialRevision: 'a'.repeat(64),
                sections: [{ prompts: [{ id: 's0', latestRecording }] }],
              }
            : { speakingPrompts: [{ id: 's0', latestRecording }] }
        );
      });
      const old = {
        recordingId: 'earlier-score',
        id: 'earlier-score',
        status: 'SCORED' as const,
        overallScore: 0.9,
      };
      const prompt = {
        id: 's0',
        order: 1,
        targetPhrase: 'Hallo Mia',
        translation: 'Hello Mia',
        latestRecording: old,
      };
      const display = () =>
        kind === 'class' ? (
          <SpeakingSection
            endpointBase={endpoint}
            classBinding={{ expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) }}
            prompts={[prompt]}
            gate={70}
            nextName={null}
            onScore={() => {}}
            onContinue={() => {}}
          />
        ) : (
          <SpeakingExercise endpointBase={endpoint} prompts={[prompt]} />
        );
      const first = render(display());
      fireEvent.click(
        screen.getByRole('button', { name: kind === 'class' ? /Re-record/ : /Record again/ })
      );
      microphone.blob = new Blob(['recorded audio'], { type: 'audio/webm' });
      first.rerender(display());
      await screen.findByRole('button', { name: 'Check saved recording' });
      expect(
        screen.queryByRole('button', { name: 'Start recording your pronunciation' })
      ).toBeNull();
      first.unmount();
      microphone.blob = null;
      render(display());
      fireEvent.click(screen.getByRole('button', { name: 'Check saved recording' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/still unknown/));
      recordingId = 'new-saved-upload';
      fireEvent.click(screen.getByRole('button', { name: 'Check saved recording' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/still unknown/));
      expect(uploads).toEqual([`${endpoint}/s0`]);
      expect(sessionStorage.getItem(`speaking-upload:${endpoint}/s0`)).not.toBeNull();
    }
  );
}
