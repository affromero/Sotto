// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeakingExercise } from '@/components/class/SpeakingExercise';
import { SpeakingSection } from '@/components/learn/SpeakingSection';
import { registerSpeakingFeedbackCases } from './speaking-upload/feedback-cases';
import {
  captureLearningAuthority,
  learningAuthorityIsCurrent,
  pauseClassLearningProgress,
} from '@/components/learn/progress/useLearningProgress';
import {
  clearSpeakingUpload,
  pendingSpeakingUpload,
  readSpeakingUploadRecovery,
  rememberSpeakingUploadReceipt,
  retainSpeakingUpload,
} from '@/components/learn/speaking/speakingUploadRecovery';

const microphone = vi.hoisted(() => ({ blob: null as Blob | null }));
const testBinding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
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
  cleanup();
  microphone.blob = null;
  vi.unstubAllGlobals();
});

describe('speaking upload recovery', () => {
  it('does not replace an unresolved upload or accept a late receipt for a later one', () => {
    const endpoint = '/api/v1/practice/fence-identity/speaking';
    const original = retainSpeakingUpload(endpoint, 'p1', null);
    expect(() => retainSpeakingUpload(endpoint, 'p1', null)).toThrow(/earlier upload/);
    expect(pendingSpeakingUpload(endpoint, 'p1')).toBe(original);
    expect(clearSpeakingUpload(endpoint, 'p1', original)).toBe(true);
    const later = retainSpeakingUpload(endpoint, 'p1', null);
    expect(later.nonce).not.toBe(original.nonce);
    expect(() => rememberSpeakingUploadReceipt(endpoint, 'p1', 'old-receipt', original)).toThrow();
    expect(clearSpeakingUpload(endpoint, 'p1', original)).toBe(false);
    expect(pendingSpeakingUpload(endpoint, 'p1')).toBe(later);
    expect(clearSpeakingUpload(endpoint, 'p1', later)).toBe(true);
  });
  it('does not send a second recording when two practice cards start together', async () => {
    const endpoint = '/api/v1/practice/two-cards/speaking';
    let complete: (response: Response) => void = () => {};
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise<Response>((resolve) => {
            complete = resolve;
          })
        : new Promise<Response>(() => {})
    );
    vi.stubGlobal('fetch', fetchMock);
    const prompt = { id: 'p1', targetPhrase: 'Hola', translation: 'Hello' };
    const display = () => (
      <>
        <SpeakingExercise endpointBase={endpoint} prompts={[prompt]} />
        <SpeakingExercise endpointBase={endpoint} prompts={[prompt]} />
      </>
    );
    const view = render(display());
    for (const button of screen.getAllByRole('button', {
      name: 'Start recording your pronunciation',
    }))
      fireEvent.click(button);
    microphone.blob = new Blob(['audio'], { type: 'audio/webm' });
    view.rerender(display());
    await screen.findByText('Uploading your recording');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Download recording' })).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toMatch(/cannot be sent safely/);
    await act(async () =>
      complete(Response.json({ recordingId: 'first-receipt' }, { status: 201 }))
    );
    expect(screen.getByRole('button', { name: 'Download recording' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload this recording' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check saved recording' })).toBeNull();
  });

  it('does not start an upload if the recovery fence cannot be persisted', () => {
    const endpoint = '/api/v1/practice/storage-failure/speaking';
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    try {
      expect(() => retainSpeakingUpload(endpoint, 'p1', null)).toThrow('storage unavailable');
      expect(pendingSpeakingUpload(endpoint, 'p1')).toBeNull();
    } finally {
      storage.mockRestore();
    }
  });

  it('keeps an exact receipt in memory when updating storage fails', async () => {
    const endpoint = '/api/v1/practice/receipt-storage-failure/speaking';
    const original = retainSpeakingUpload(endpoint, 'p1', null);
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    try {
      const receipt = rememberSpeakingUploadReceipt(endpoint, 'p1', 'saved', original);
      expect(receipt.persisted).toBe(false);
      expect(pendingSpeakingUpload(endpoint, 'p1')?.acknowledgedRecordingId).toBe('saved');
    } finally {
      storage.mockRestore();
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          speakingPrompts: [
            { id: 'p1', latestRecording: { id: 'saved', status: 'SCORED', overallScore: 0.8 } },
          ],
        })
      )
    );
    const candidate = await readSpeakingUploadRecovery(endpoint, 'p1');
    expect(candidate.evidence.recordingId).toBe('saved');
    candidate.commit();
  });

  it('lets a learner retry a retained practice recording after storage recovers', async () => {
    const endpoint = '/api/v1/practice/retained-retry/speaking';
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    try {
      const prompt = { id: 'p1', targetPhrase: 'Hola', translation: 'Hello' };
      const view = render(<SpeakingExercise endpointBase={endpoint} prompts={[prompt]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Start recording your pronunciation' }));
      microphone.blob = new Blob(['audio'], { type: 'audio/webm' });
      view.rerender(<SpeakingExercise endpointBase={endpoint} prompts={[prompt]} />);
      await screen.findByRole('button', { name: 'Download recording' });
      expect(fetchMock).not.toHaveBeenCalled();
      storage.mockRestore();
      fireEvent.click(screen.getByRole('button', { name: 'Upload this recording' }));
      await screen.findByText('Uploading your recording');
    } finally {
      storage.mockRestore();
    }
  });

  it('ignores a late class upload error after its fence is replaced', async () => {
    const endpoint = '/api/v1/classes/stale-upload-error/speaking';
    let complete: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          })
      )
    );
    const prompt = { id: 'p1', order: 1, targetPhrase: 'Hola', translation: 'Hello' };
    const display = () => (
      <SpeakingSection
        endpointBase={endpoint}
        classBinding={testBinding}
        prompts={[prompt]}
        gate={70}
        nextName={null}
        onScore={() => {}}
        onContinue={() => {}}
      />
    );
    const view = render(display());
    fireEvent.click(screen.getByRole('button', { name: 'Start recording your pronunciation' }));
    microphone.blob = new Blob(['audio'], { type: 'audio/webm' });
    view.rerender(display());
    const original = await waitFor(() => {
      const fence = pendingSpeakingUpload(endpoint, 'p1');
      expect(fence).not.toBeNull();
      return fence!;
    });
    expect(clearSpeakingUpload(endpoint, 'p1', original)).toBe(true);
    const later = retainSpeakingUpload(endpoint, 'p1', null, testBinding);
    await act(async () =>
      complete(Response.json({ error: 'stale server error' }, { status: 500 }))
    );
    expect(screen.queryByText('stale server error')).toBeNull();
    expect(pendingSpeakingUpload(endpoint, 'p1')).toBe(later);
    expect(clearSpeakingUpload(endpoint, 'p1', later)).toBe(true);
  });
  it('retains a practice receipt that arrives after the card is left', async () => {
    const endpoint = '/api/v1/practice/late-receipt/speaking';
    let complete: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          })
      )
    );
    const prompt = { id: 'late', targetPhrase: 'Hola', translation: 'Hello' };
    const view = render(<SpeakingExercise endpointBase={endpoint} prompts={[prompt]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start recording your pronunciation' }));
    microphone.blob = new Blob(['audio'], { type: 'audio/webm' });
    view.rerender(<SpeakingExercise endpointBase={endpoint} prompts={[prompt]} />);
    await waitFor(() =>
      expect(sessionStorage.getItem(`speaking-upload:${endpoint}/late`)).not.toBeNull()
    );
    view.unmount();
    await act(async () => complete(Response.json({ recordingId: 'receipt' }, { status: 201 })));
    expect(
      JSON.parse(sessionStorage.getItem(`speaking-upload:${endpoint}/late`)!)
        .acknowledgedRecordingId
    ).toBe('receipt');
  });
  it('requires the exact acknowledged recording and rejects conflicting identifiers', async () => {
    const endpoint = '/api/v1/practice/exact-receipt/speaking';
    let latestRecording = {
      id: 'other',
      recordingId: 'receipt',
      status: 'SCORED',
      overallScore: 0.8,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          speakingPrompts: [{ id: 'p1', latestRecording }],
        })
      )
    );
    await expect(readSpeakingUploadRecovery(endpoint, 'p1')).rejects.toThrow(/still unknown/);
    const fence = retainSpeakingUpload(endpoint, 'p1', null);
    await expect(readSpeakingUploadRecovery(endpoint, 'p1')).rejects.toThrow(/still unknown/);
    rememberSpeakingUploadReceipt(endpoint, 'p1', 'receipt', fence);
    await expect(readSpeakingUploadRecovery(endpoint, 'p1')).rejects.toThrow(/still unknown/);
    latestRecording = { ...latestRecording, id: 'receipt' };
    const candidate = await readSpeakingUploadRecovery(endpoint, 'p1');
    expect(candidate.evidence.recordingId).toBe('receipt');
    candidate.commit();
    expect(sessionStorage.getItem(`speaking-upload:${endpoint}/p1`)).toBeNull();
  });
  it('does not clear an upload fence when recovery finishes after the card is left', async () => {
    const parent = '/api/v1/classes/recovery-left';
    const endpoint = `${parent}/speaking`;
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    retainSpeakingUpload(endpoint, 'p1', 'old', binding);
    let complete: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          })
      )
    );
    const onFeedback = vi.fn();
    const view = render(
      <SpeakingSection
        endpointBase={endpoint}
        classBinding={binding}
        prompts={[
          {
            id: 'p1',
            order: 1,
            targetPhrase: 'Hola',
            translation: 'Hello',
            latestRecording: { id: 'old', status: 'SCORED', overallScore: 0.8 },
          },
        ]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onFeedback={onFeedback}
        onContinue={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check saved recording' }));
    view.unmount();
    await act(async () =>
      complete(
        Response.json({
          id: 'recovery-left',
          attempt: 1,
          taskMaterialRevision: binding.taskMaterialRevision,
          sections: [
            {
              prompts: [
                {
                  id: 'p1',
                  latestRecording: {
                    id: 'new',
                    status: 'SCORED',
                    overallScore: 0.9,
                    transcript: 'Hola',
                    feedback: 'Bien',
                  },
                },
              ],
            },
          ],
        })
      )
    );
    expect(sessionStorage.getItem(`speaking-upload:${endpoint}/p1`)).not.toBeNull();
    expect(onFeedback).not.toHaveBeenCalled();
  });

  it('keeps an exact successful upload receipt when its card is left before acknowledgment', async () => {
    const parent = '/api/v1/classes/upload-left';
    const endpoint = `${parent}/speaking`;
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    let complete: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const display = () => (
      <SpeakingSection
        endpointBase={endpoint}
        classBinding={binding}
        prompts={[{ id: 'p1', order: 1, targetPhrase: 'Hola', translation: 'Hello' }]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onContinue={vi.fn()}
      />
    );
    const view = render(display());
    fireEvent.click(screen.getByRole('button', { name: 'Start recording your pronunciation' }));
    microphone.blob = new Blob(['audio'], { type: 'audio/webm' });
    view.rerender(display());
    await screen.findByText('Uploading your recording');
    view.unmount();
    await act(async () =>
      complete(Response.json({ recordingId: 'new-recording', status: 'PENDING' }, { status: 201 }))
    );
    expect(
      JSON.parse(sessionStorage.getItem(`speaking-upload:${endpoint}/p1`)!).acknowledgedRecordingId
    ).toBe('new-recording');
  });
  it('keeps the upload fence if authority changes before recovery is committed', async () => {
    const parent = '/api/v1/classes/recovery-handoff';
    const endpoint = `${parent}/speaking`;
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    const fence = retainSpeakingUpload(endpoint, 'p1', 'old', binding);
    rememberSpeakingUploadReceipt(endpoint, 'p1', 'new', fence);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          id: 'recovery-handoff',
          attempt: 1,
          taskMaterialRevision: binding.taskMaterialRevision,
          sections: [
            {
              prompts: [
                {
                  id: 'p1',
                  latestRecording: {
                    id: 'new',
                    status: 'SCORED',
                    overallScore: 0.9,
                    transcript: 'Hola',
                    feedback: 'Bien',
                  },
                },
              ],
            },
          ],
        })
      )
    );
    const generation = captureLearningAuthority(parent)!;
    const candidate = await readSpeakingUploadRecovery(endpoint, 'p1', {
      classId: 'recovery-handoff',
      binding,
      isCurrent: () => learningAuthorityIsCurrent(parent, generation),
    });
    const hold = pauseClassLearningProgress(parent);
    expect(() => candidate.commit()).toThrow(/recording check changed/i);
    expect(sessionStorage.getItem(`speaking-upload:${endpoint}/p1`)).not.toBeNull();
    hold.verify(binding);
    hold();
  });
  it.each([undefined, null])(
    'does not poll a class recording without its material binding (%s)',
    async (binding) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <SpeakingSection
          endpointBase="/api/v1/classes/missing-binding/speaking"
          classBinding={binding}
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
      expect(await screen.findByRole('alert')).toHaveTextContent('Check the class status');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('retains the exact upload receipt when authority changes before acknowledgment', async () => {
    const parent = '/api/v1/classes/upload-late-ack';
    const endpoint = `${parent}/speaking`;
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    let complete: (value: Response) => void = () => {};
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST')
        return new Promise<Response>((resolve) => {
          complete = resolve;
        });
      if (String(input) === parent)
        return Promise.resolve(
          Response.json({
            id: 'upload-late-ack',
            attempt: 1,
            taskMaterialRevision: binding.taskMaterialRevision,
            sections: [
              {
                prompts: [
                  {
                    id: 'p1',
                    latestRecording: {
                      id: 'new-recording',
                      status: 'SCORED',
                      overallScore: 0.9,
                      transcript: 'Hola',
                      feedback: 'Bien',
                    },
                  },
                ],
              },
            ],
          })
        );
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onFeedback = vi.fn();
    const display = () => (
      <SpeakingSection
        endpointBase={endpoint}
        classBinding={binding}
        prompts={[{ id: 'p1', order: 1, targetPhrase: 'Hola', translation: 'Hello' }]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onFeedback={onFeedback}
        onContinue={vi.fn()}
      />
    );
    const view = render(display());
    fireEvent.click(screen.getByRole('button', { name: 'Start recording your pronunciation' }));
    microphone.blob = new Blob(['audio'], { type: 'audio/webm' });
    view.rerender(display());
    await screen.findByText('Uploading your recording');
    const hold = pauseClassLearningProgress(parent);
    hold.verify(binding);
    hold();
    await act(async () =>
      complete(Response.json({ recordingId: 'new-recording', status: 'PENDING' }, { status: 201 }))
    );
    expect(
      await screen.findByRole('button', { name: 'Check saved recording' })
    ).toBeInTheDocument();
    expect(
      JSON.parse(sessionStorage.getItem(`speaking-upload:${endpoint}/p1`)!).acknowledgedRecordingId
    ).toBe('new-recording');
    expect(onFeedback).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved recording' }));
    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ id: 'new-recording' })
      )
    );
    expect(sessionStorage.getItem(`speaking-upload:${endpoint}/p1`)).toBeNull();
  });
  it('keeps a recording finished during a class check until explicitly uploaded', async () => {
    const parent = '/api/v1/classes/held-recording';
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ recordingId: 'new-recording', status: 'PENDING' }, { status: 201 })
        : Response.json({ recordingId: 'new-recording', status: 'GRADING' })
    );
    vi.stubGlobal('fetch', fetchMock);
    const display = () => (
      <SpeakingSection
        endpointBase={`${parent}/speaking`}
        classBinding={binding}
        prompts={[{ id: 'p1', order: 1, targetPhrase: 'Hola', translation: 'Hello' }]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onContinue={vi.fn()}
      />
    );
    const view = render(display());
    fireEvent.click(screen.getByRole('button', { name: 'Start recording your pronunciation' }));
    const hold = pauseClassLearningProgress(parent);
    microphone.blob = new Blob(['audio'], { type: 'audio/webm' });
    view.rerender(display());
    expect(await screen.findByRole('button', { name: 'Download recording' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    hold.verify(binding);
    hold();
    fireEvent.click(screen.getByRole('button', { name: 'Upload this recording' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    );
    const sent = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]
      ?.body as FormData;
    expect(sent.get('expectedAttempt')).toBe('1');
    expect(sent.get('taskMaterialRevision')).toBe(binding.taskMaterialRevision);
  });

  it.each([
    { status: 409, code: 'CLASS_MATERIAL_CHANGED' },
    { status: 404, code: 'CLASS_RECORDING_REJECTED' },
  ])('keeps the recording downloadable after a definite rejection', async ({ status, code }) => {
    const parent = `/api/v1/classes/upload-conflict-${status}`;
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ code }, { status }))
    );
    const display = () => (
      <SpeakingSection
        endpointBase={`${parent}/speaking`}
        classBinding={binding}
        prompts={[{ id: 'p1', order: 1, targetPhrase: 'Hola', translation: 'Hello' }]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onContinue={vi.fn()}
      />
    );
    const view = render(display());
    fireEvent.click(screen.getByRole('button', { name: 'Start recording your pronunciation' }));
    microphone.blob = new Blob(['audio'], { type: 'audio/webm' });
    view.rerender(display());
    expect(await screen.findByRole('button', { name: 'Download recording' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('before this recording was accepted');
    expect(sessionStorage.getItem(`speaking-upload:${parent}/speaking/p1`)).toBeNull();
  });

  it('keeps a copy and requires recovery for an unclassified upload conflict', async () => {
    const parent = '/api/v1/classes/upload-unknown-conflict';
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Conflict' }, { status: 409 }))
    );
    const display = () => (
      <SpeakingSection
        endpointBase={`${parent}/speaking`}
        classBinding={binding}
        prompts={[{ id: 'p1', order: 1, targetPhrase: 'Hola', translation: 'Hello' }]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onContinue={vi.fn()}
      />
    );
    const view = render(display());
    fireEvent.click(screen.getByRole('button', { name: 'Start recording your pronunciation' }));
    microphone.blob = new Blob(['audio'], { type: 'audio/webm' });
    view.rerender(display());
    expect(
      await screen.findByRole('button', { name: 'Check saved recording' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download recording' })).toBeInTheDocument();
    expect(sessionStorage.getItem(`speaking-upload:${parent}/speaking/p1`)).not.toBeNull();
  });

  it('does not upload a held recording after the class binding changes', async () => {
    const parent = '/api/v1/classes/held-recording-changed';
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const display = () => (
      <SpeakingSection
        endpointBase={`${parent}/speaking`}
        classBinding={binding}
        prompts={[{ id: 'p1', order: 1, targetPhrase: 'Hola', translation: 'Hello' }]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onContinue={vi.fn()}
      />
    );
    const view = render(display());
    fireEvent.click(screen.getByRole('button', { name: 'Start recording your pronunciation' }));
    const hold = pauseClassLearningProgress(parent);
    microphone.blob = new Blob(['audio'], { type: 'audio/webm' });
    view.rerender(display());
    await screen.findByRole('button', { name: 'Download recording' });
    hold.verify({ ...binding, taskMaterialRevision: 'b'.repeat(64) });
    hold();
    fireEvent.click(screen.getByRole('button', { name: 'Upload this recording' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download recording' })).toBeInTheDocument();
  });
  it('retains an unknown upload fence when authority changes during recovery', async () => {
    const parent = '/api/v1/classes/recovery-held';
    const endpoint = `${parent}/speaking`;
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    retainSpeakingUpload(endpoint, 'p1', 'old', binding);
    let complete: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          })
      )
    );
    const onFeedback = vi.fn();
    render(
      <SpeakingSection
        endpointBase={endpoint}
        classBinding={binding}
        prompts={[
          {
            id: 'p1',
            order: 1,
            targetPhrase: 'Hola',
            translation: 'Hello',
            latestRecording: { id: 'old', status: 'SCORED', overallScore: 0.8 },
          },
        ]}
        gate={70}
        nextName={null}
        onScore={vi.fn()}
        onFeedback={onFeedback}
        onContinue={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check saved recording' }));
    const hold = pauseClassLearningProgress(parent);
    hold.verify(binding);
    hold();
    await act(async () =>
      complete(
        Response.json({
          id: 'recovery-held',
          attempt: 1,
          taskMaterialRevision: binding.taskMaterialRevision,
          sections: [
            {
              prompts: [
                {
                  id: 'p1',
                  latestRecording: {
                    id: 'new',
                    status: 'SCORED',
                    overallScore: 0.9,
                    transcript: 'Hola',
                    feedback: 'Bien',
                  },
                },
              ],
            },
          ],
        })
      )
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('class changed');
    expect(sessionStorage.getItem(`speaking-upload:${endpoint}/p1`)).not.toBeNull();
    expect(onFeedback).not.toHaveBeenCalled();
  });
  it('holds a late score until the original class is reverified and checked again', async () => {
    const endpoint = '/api/v1/classes/poll-held';
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    let complete: (value: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          })
      )
      .mockResolvedValue(
        Response.json({
          recordingId: 'expected',
          status: 'SCORED',
          overallScore: 0.9,
          feedback: 'Bien',
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    const onScore = vi.fn();
    const onFeedback = vi.fn();
    render(
      <SpeakingSection
        endpointBase={`${endpoint}/speaking`}
        classBinding={binding}
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
        onScore={onScore}
        onFeedback={onFeedback}
        onContinue={vi.fn()}
      />
    );
    await screen.findByText('Grading your speaking');
    const hold = pauseClassLearningProgress(endpoint);
    await act(async () =>
      complete(
        Response.json({
          recordingId: 'expected',
          status: 'SCORED',
          overallScore: 0.9,
          feedback: 'Bien',
        })
      )
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the class status');
    expect(onFeedback).not.toHaveBeenCalled();
    expect(onScore.mock.calls.some(([score]) => score === 90)).toBe(false);
    hold.verify(binding);
    hold();
    fireEvent.click(screen.getByRole('button', { name: 'Check recording status' }));
    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'expected' }))
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not publish an old recording score after a different class is verified', async () => {
    const endpoint = '/api/v1/classes/poll-changed';
    const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    let complete: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const onFeedback = vi.fn();
    render(
      <SpeakingSection
        endpointBase={`${endpoint}/speaking`}
        classBinding={binding}
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
    await screen.findByText('Grading your speaking');
    const hold = pauseClassLearningProgress(endpoint);
    hold.verify({ ...binding, taskMaterialRevision: 'b'.repeat(64) });
    hold();
    await act(async () =>
      complete(Response.json({ recordingId: 'expected', status: 'SCORED', overallScore: 0.9 }))
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Check recording status' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the class status');
    expect(onFeedback).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not publish a pending score after the mounted prompt changes material', async () => {
    const endpoint = '/api/v1/classes/poll-rebound';
    const original = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
    const changed = { ...original, taskMaterialRevision: 'b'.repeat(64) };
    let complete: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          })
      )
    );
    const onFeedback = vi.fn();
    const display = (binding: typeof original) => (
      <SpeakingSection
        endpointBase={`${endpoint}/speaking`}
        classBinding={binding}
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
    const view = render(display(original));
    view.rerender(display(changed));
    await act(async () =>
      complete(Response.json({ recordingId: 'expected', status: 'SCORED', overallScore: 0.9 }))
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the class status');
    expect(onFeedback).not.toHaveBeenCalled();
  });
  it('does not apply a score returned for a different recording', async () => {
    const onScore = vi.fn();
    const onFeedback = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          recordingId: 'different',
          status: 'SCORED',
          overallScore: 0.9,
          feedback: 'Wrong record',
        })
      )
    );
    render(
      <SpeakingSection
        endpointBase="/api/v1/classes/poll-mismatch/speaking"
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
        onScore={onScore}
        onFeedback={onFeedback}
        onContinue={vi.fn()}
      />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'recording status could not be verified'
    );
    expect(onScore.mock.calls.some(([score]) => score === 90)).toBe(false);
    expect(onFeedback).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Check recording status' })).toBeInTheDocument();
  });

  registerSpeakingFeedbackCases({ microphone, testBinding });
});
