// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourseAnalysisPanel } from '@/components/learn/course-materials/CourseAnalysisPanel';
import { MaterialUploader } from '@/components/learn/course-materials/MaterialUploader';
import { createMaterialUploadClientState } from '@/lib/course-materials/client/uploads';
import {
  saveBrowserUploadCheckpoint,
  readBrowserUploadCheckpoint,
} from '@/lib/course-materials/client/browser-checkpoint';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const courseId = 'course-1';
const profileId = 'owner-1';
const analysisKey = `sotto.source-analysis.v1:${profileId}:${courseId}`;
const analysis = (analysisId = id(1), status = 'RUNNING') => ({
  analysisId,
  analysisRevision: 1,
  status,
  resultDigest: null,
  summary: null,
  coverage: null,
  stale: false,
});
function checkpoint(deadline = Date.now() + 7_200_000) {
  const value = {
    profileId,
    courseId,
    requestId: id(2),
    materialIds: [id(3)],
    includeCourseNote: false,
    analysisId: id(1),
    pollDeadlineAt: deadline,
  };
  localStorage.setItem(analysisKey, JSON.stringify(value));
  return value;
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('course source receipt ownership and recovery', () => {
  const props = {
    courseId,
    nativeLang: 'en',
    targetLang: 'de',
    materials: [
      { id: id(3), name: 'Earlier source' },
      { id: id(4), name: 'Current source' },
    ],
  };
  it('requires an explicit reset after a removed saved analysis and starts current sources with a new request identity', async () => {
    const old = checkpoint();
    const admissions: unknown[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/users/me') return Response.json({ id: profileId });
      if (init?.method === 'POST') {
        expect(new Headers(init.headers).get('x-sotto-expected-profile-id')).toBe(profileId);
        admissions.push(JSON.parse(String(init.body)));
        return Response.json(analysis(id(5), 'COMPLETE'));
      }
      if (url.endsWith(id(1)))
        return Response.json({ error: 'Analysis not found.' }, { status: 404 });
      if (url.endsWith(id(5))) return Response.json(analysis(id(5), 'COMPLETE'));
      throw new Error(`Unexpected source request ${url}`);
    });
    render(<CourseAnalysisPanel {...props} />);
    expect(
      await screen.findByText(
        'The saved analysis is unavailable. Its request has not been replaced.'
      )
    ).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(analysisKey)!).requestId).toBe(old.requestId);
    expect(admissions).toEqual([]);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Clear unavailable receipt and choose current sources',
      })
    );
    await waitFor(() => expect(localStorage.getItem(analysisKey)).toBeNull());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Current source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analyze teaching focuses' }));
    await screen.findByText(/Source analysis: complete/);
    expect(admissions).toEqual([
      expect.objectContaining({
        materialIds: [id(4)],
        requestId: expect.not.stringMatching(old.requestId),
      }),
    ]);
  });
  it('discards an old resolved status read after the learner changes the source selection', async () => {
    checkpoint();
    const pending = Promise.withResolvers<Response>();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
      String(input) === '/api/v1/users/me' ? Response.json({ id: profileId }) : pending.promise
    );
    render(<CourseAnalysisPanel {...props} />);
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Earlier source' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Earlier source' }));
    await act(async () => {
      pending.resolve(Response.json(analysis(id(1), 'COMPLETE')));
    });
    expect(screen.queryByText(/Source analysis: complete/)).toBeNull();
    expect(localStorage.getItem(analysisKey)).toBeNull();
  });
  it('pauses automatic checks after two hours and checks the same receipt only on explicit request', async () => {
    vi.useFakeTimers();
    checkpoint(Date.now() - 1);
    const reads: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/users/me') return Response.json({ id: profileId });
      reads.push(url);
      return Response.json(analysis());
    });
    await act(async () => {
      render(<CourseAnalysisPanel {...props} />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText(/Automatic checks paused after two hours/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_200_000);
    });
    expect(reads).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open or resume saved analysis' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads).toEqual([
      `/api/v1/material-analyses/${id(1)}`,
      `/api/v1/material-analyses/${id(1)}`,
    ]);
  });
  it('retains the unresolved upload checkpoint when cancellation returns a different valid receipt', async () => {
    const state = createMaterialUploadClientState(
      [
        {
          clientId: id(10),
          file: new File(['abc'], 'source.txt', { type: 'text/plain' }),
        },
      ],
      { courseId, expectedProfileId: profileId }
    );
    const upload = {
      schemaVersion: 1 as const,
      batchId: id(11),
      uploadId: id(12),
      materialId: id(13),
      limitsVersion: 1 as const,
      file: state.request.files[0],
      status: 'UPLOADING' as const,
      revision: 0,
      expiresAt: '2099-01-01T00:00:00.000Z',
      parts: [],
      original: null,
      failureReason: null,
    };
    state.batch = {
      schemaVersion: 1,
      batchId: id(11),
      requestId: state.request.requestId,
      uploads: [upload],
    };
    saveBrowserUploadCheckpoint(profileId, `course:${courseId}`, state);
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      return url === '/api/v1/users/me'
        ? Response.json({ id: profileId })
        : Response.json({ ...upload, uploadId: id(99) });
    });
    render(
      <MaterialUploader
        courseId={courseId}
        onComplete={() => {
          throw new Error('The upload was not resolved.');
        }}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel unfinished uploads' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'different or stale upload identity'
    );
    expect(readBrowserUploadCheckpoint(profileId, `course:${courseId}`)).toEqual(state);
    expect(requests.some((request) => request.startsWith('DELETE'))).toBe(false);
  });
});
