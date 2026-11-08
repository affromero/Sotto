import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const recorder = vi.hoisted(() => ({ blob: null as Blob | null, reset: vi.fn() }));
vi.mock('@/lib/hooks/useAudioRecorder', () => ({
  useAudioRecorder: () => ({
    isRecording: false,
    recordedBlob: recorder.blob,
    error: null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    reset: recorder.reset,
  }),
}));

import { ClassAssessment } from '@/components/learn/assessment/ClassAssessment';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('assessment speaking recovery', () => {
  it('keeps an unsaved recording mounted while focus revalidation fails', async () => {
    recorder.blob = new Blob(['audio'], { type: 'audio/webm' });
    const revision = 'a'.repeat(64);
    let unavailable = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status'))
          return unavailable
            ? new Response(null, { status: 503 })
            : Response.json({
                status: 'READY',
                classAttempt: 1,
                assessmentId: 'assessment',
                revision,
              });
        if (url.endsWith('/speaking/s1')) return Response.json({ status: 'NOT_STARTED' });
        if (url.endsWith('/assessment/assessment'))
          return Response.json({
            id: 'assessment',
            classAttempt: 1,
            assessmentAttempt: 1,
            sections: [
              {
                id: 'speaking',
                skill: 'SPEAKING',
                items: [
                  {
                    id: 's1',
                    task: 'Read aloud',
                    mode: 'READ_ALOUD',
                    referenceAudioAvailable: false,
                  },
                ],
              },
            ],
          });
        return new Response(null, { status: 503 });
      })
    );
    const back = vi.fn();
    render(<ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={back} />);
    const download = await screen.findByRole('link', { name: 'Download recording' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled()
    );
    unavailable = true;
    fireEvent.focus(window);
    await screen.findByRole('alert');
    expect(screen.getByText('Download recording')).toBe(download);
    expect(download).toBeVisible();
    expect(screen.queryByText('Submit assessment')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to practice' }));
    expect(back).not.toHaveBeenCalled();
    expect(recorder.reset).not.toHaveBeenCalled();
  });

  it('allows submission only after speaking completion is verified', async () => {
    recorder.blob = null;
    let speakingStatus = 'RUNNING';
    const requestId = '10000000-0000-4000-8000-000000000001';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status'))
          return Response.json({
            status: 'READY',
            classAttempt: 1,
            assessmentId: 'assessment',
            revision: 'a'.repeat(64),
          });
        if (url.endsWith('/speaking/s1'))
          return Response.json({ status: speakingStatus, requestId });
        if (url.endsWith('/assessment/assessment'))
          return Response.json({
            id: 'assessment',
            classAttempt: 1,
            assessmentAttempt: 1,
            sections: [
              {
                id: 'speaking',
                skill: 'SPEAKING',
                items: [
                  {
                    id: 's1',
                    task: 'Read aloud',
                    mode: 'READ_ALOUD',
                    referenceAudioAvailable: false,
                  },
                ],
              },
            ],
          });
        throw new Error('Unexpected request');
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    await screen.findByText('Checking your recording…');
    expect(screen.getByRole('button', { name: 'Submit assessment' })).toBeDisabled();
    speakingStatus = 'COMPLETED';
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Submit assessment' })).toBeEnabled(),
      { timeout: 5000 }
    );
  });

  it('hides the saved assessment while the active profile is being rechecked', async () => {
    recorder.blob = new Blob(['audio'], { type: 'audio/webm' });
    let pauseOwner = false;
    let resolveOwner: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/users/me')
          return pauseOwner
            ? new Promise<Response>((resolve) => {
                resolveOwner = resolve;
              })
            : Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status'))
          return Response.json({
            status: 'READY',
            classAttempt: 1,
            assessmentId: 'assessment',
            revision: 'a'.repeat(64),
          });
        if (url.endsWith('/speaking/s1')) return Response.json({ status: 'NOT_STARTED' });
        if (url.endsWith('/assessment/assessment'))
          return Response.json({
            id: 'assessment',
            classAttempt: 1,
            assessmentAttempt: 1,
            sections: [
              {
                id: 'speaking',
                skill: 'SPEAKING',
                items: [
                  {
                    id: 's1',
                    task: 'Read aloud',
                    mode: 'READ_ALOUD',
                    referenceAudioAvailable: false,
                  },
                ],
              },
            ],
          });
        throw new Error('Unexpected request');
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    const download = await screen.findByRole('link', { name: 'Download recording' });
    pauseOwner = true;
    fireEvent.focus(window);
    expect(download).not.toBeVisible();
    await waitFor(() => expect(resolveOwner).toBeDefined());
    pauseOwner = false;
    resolveOwner!(Response.json({ id: 'owner' }));
    await waitFor(() => expect(download).toBeVisible());
    expect(recorder.reset).not.toHaveBeenCalled();
  });

  it.each(['revision', 'attempt', 'submitted'] as const)(
    'offers the original owner recording recovery after %s changes',
    async (change) => {
      recorder.blob = new Blob(['audio'], { type: 'audio/webm' });
      let changed = false;
      const complete = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
          if (url.endsWith('/assessment/status') && changed && change === 'submitted')
            return new Response(null, { status: 409 });
          if (url.endsWith('/assessment/status'))
            return Response.json({
              status: 'READY',
              classAttempt: changed && change === 'attempt' ? 2 : 1,
              assessmentId: 'assessment',
              revision: (changed && change === 'revision' ? 'b' : 'a').repeat(64),
            });
          if (url.endsWith('/speaking/s1')) return Response.json({ status: 'NOT_STARTED' });
          if (url.endsWith('/assessment/assessment'))
            return Response.json({
              id: 'assessment',
              classAttempt: 1,
              assessmentAttempt: 1,
              sections: [
                {
                  id: 'speaking',
                  skill: 'SPEAKING',
                  items: [
                    {
                      id: 's1',
                      task: 'Read aloud',
                      mode: 'READ_ALOUD',
                      referenceAudioAvailable: false,
                    },
                  ],
                },
              ],
            });
          throw new Error('Unexpected request');
        })
      );
      render(
        <ClassAssessment classId="class" classAttempt={1} onComplete={complete} onBack={vi.fn()} />
      );
      await screen.findByRole('link', { name: 'Download recording' });
      changed = true;
      fireEvent.focus(window);
      expect(await screen.findByRole('alert')).toHaveTextContent('Download or discard');
      expect(screen.getByRole('link', { name: 'Download recording' })).toBeVisible();
      expect(screen.queryByText('Read aloud')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Discard recording' })).toBeEnabled();
      expect(complete).not.toHaveBeenCalled();
    }
  );
});
