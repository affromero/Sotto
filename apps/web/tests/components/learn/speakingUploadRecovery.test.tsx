import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeakingExercise } from '@/components/class/SpeakingExercise';
import { SpeakingSection } from '@/components/learn/SpeakingSection';

const microphone = vi.hoisted(() => ({ blob: null as Blob | null }));
vi.mock('@/lib/hooks/useAudioRecorder', () => ({
  useAudioRecorder: () => ({
    recordedBlob: microphone.blob,
    duration: 0,
    error: null,
    reset: () => {
      microphone.blob = null;
    },
    startRecording: async () => {},
    stopRecording: () => {},
  }),
}));
afterEach(() => {
  microphone.blob = null;
  vi.unstubAllGlobals();
});

describe('speaking upload recovery', () => {
  it.each(['practice', 'class'] as const)(
    'retains an unknown %s upload across remount and resumes only new saved evidence',
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
            ? { sections: [{ prompts: [{ id: 's0', latestRecording }] }] }
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
      await screen.findByText('Both words recognized.');
      expect(uploads).toEqual([`${endpoint}/s0`]);
      expect(sessionStorage.getItem(`speaking-upload:${endpoint}/s0`)).toBeNull();
    }
  );
});
