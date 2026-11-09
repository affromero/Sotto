import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recorder = vi.hoisted(() => ({
  blob: null as Blob | null,
  reset: vi.fn(),
}));
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

import { AssessmentSpeakingPrompt } from '@/components/learn/assessment/AssessmentSpeakingPrompt';

const requestId = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const key = 'speaking:owner:class:assessment:prompt';

function renderPrompt(onStatus = vi.fn()) {
  return render(
    <AssessmentSpeakingPrompt
      task="Read hello"
      url="/speaking"
      storageKey={key}
      ownerId="owner"
      disabled={false}
      suspended={false}
      recoveryOnly={false}
      onStatus={onStatus}
      onHeld={vi.fn()}
    />
  );
}

describe('assessment speaking recording', () => {
  beforeEach(() => {
    sessionStorage.clear();
    recorder.blob = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: 'audio/webm' });
    recorder.reset.mockReset();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retains exact audio and request ID across an uncertain upload and replay', async () => {
    recorder.blob = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], {
      type: 'audio/webm;codecs=opus',
    });
    let sent = false;
    const ids: FormDataEntryValue[] = [];
    const audioTypes: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (init?.method === 'POST') {
          ids.push((init.body as FormData).get('requestId')!);
          audioTypes.push(((init.body as FormData).get('audio') as File).type);
          if (!sent) {
            sent = true;
            throw new Error('Connection lost');
          }
          return Response.json({ status: 'RUNNING', requestId });
        }
        return Response.json(
          ids.length > 1 ? { status: 'RUNNING', requestId } : { status: 'NOT_STARTED' }
        );
      })
    );
    const first = renderPrompt();
    fireEvent.click(await screen.findByRole('button', { name: 'Save recording' }));
    await screen.findByRole('alert');
    expect(sessionStorage.getItem(key)).toContain(requestId);
    first.unmount();
    renderPrompt();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry this recording' }));
    await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
    expect(ids).toEqual([requestId, requestId]);
    expect(audioTypes).toEqual(['audio/webm;codecs=opus', 'audio/webm;codecs=opus']);
  });

  it('keeps a different local recording when another tab completed the task', async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({ requestId, data: 'data:audio/webm;base64,GkXfow==' })
    );
    const onStatus = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/v1/users/me'
          ? Response.json({ id: 'owner' })
          : Response.json({ status: 'COMPLETED', requestId: otherId })
      )
    );
    renderPrompt(onStatus);
    expect(await screen.findByText('Recording saved.')).toBeInTheDocument();
    expect(sessionStorage.getItem(key)).toContain(requestId);
    expect(onStatus).not.toHaveBeenCalledWith(true);
    expect(screen.getByRole('link', { name: 'Download recording' })).toBeInTheDocument();
  });

  it('does not upload when the browser cannot retain the recording', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({})
        : String(input) === '/api/v1/users/me'
          ? Response.json({ id: 'owner' })
          : Response.json({ status: 'NOT_STARTED' })
    );
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    renderPrompt();
    fireEvent.click(await screen.findByRole('button', { name: 'Save recording' }));
    await screen.findByRole('alert');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(screen.getByRole('link', { name: 'Download recording' })).toBeInTheDocument();
  });
});
