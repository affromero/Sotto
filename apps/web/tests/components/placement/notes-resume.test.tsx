import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NotesPlacement } from '@/components/placement/NotesPlacement';
import {
  materialPlacementContentHash,
  saveMaterialPlacement,
} from '@/lib/course-materials/client/placement-checkpoint';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const analysisId = '6ab93738-760d-4666-9e7c-f130628f0491';
const requestId = '23f85cf9-a68b-4d30-837d-1196dcdb11bc';
const result = {
  native: 'en',
  target: 'de',
  analysisId,
  analysisRevision: 1,
  identityDigest: 'a'.repeat(64),
  resultDigest: 'b'.repeat(64),
  status: 'COMPLETE',
  summary: {
    focusCount: 2,
    inference: { level: 'A2', rationale: 'Original saved sources.', confidence: 0.7 },
  },
};

beforeEach(async () => {
  push.mockClear();
  window.localStorage.clear();
  saveMaterialPlacement(
    {
      profileId: 'learner-1',
      native: 'en',
      target: 'de',
      requestId,
      content: 'Private original',
      files: [],
      upload: null,
      analysisId,
    },
    await materialPlacementContentHash('Private original')
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('reopening source placement after closing the page', () => {
  it('explicitly clears a corrupt browser record and permits a fresh analysis without claiming server cancellation', async () => {
    window.localStorage.setItem(window.localStorage.key(0)!, '{corrupt');
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id: 'learner-1' }));
    vi.stubGlobal('fetch', fetch);
    render(<NotesPlacement native="en" target="de" onVerify={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open saved analysis' }));
    const reset = await screen.findByRole('button', { name: /clear this browser/i });
    expect(screen.getByText(/background work stay on the server/i)).toBeInTheDocument();
    fetch.mockResolvedValueOnce(Response.json({ id: 'learner-1' }));
    fireEvent.click(reset);
    const input = await screen.findByLabelText(/paste notes/i);
    fireEvent.change(input, { target: { value: 'Fresh input' } });
    fetch
      .mockResolvedValueOnce(Response.json({ id: 'learner-1' }))
      .mockResolvedValueOnce(Response.json({ id: 'learner-1' }))
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json(result));
    fireEvent.click(screen.getByRole('button', { name: /find my level/i }));
    expect(await screen.findByText('Original saved sources.')).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  });
  it('replays a lost confirmation after reload without reselecting files or admitting source analysis again', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'learner-1' }))
      .mockResolvedValueOnce(Response.json(result))
      .mockRejectedValueOnce(new TypeError('Synthetic lost committed confirmation'));
    vi.stubGlobal('fetch', fetch);
    const first = render(<NotesPlacement native="en" target="de" onVerify={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open saved analysis' }));
    await screen.findByText('Original saved sources.');
    fireEvent.click(screen.getByRole('button', { name: 'Start here' }));
    await screen.findByRole('button', { name: 'Retry course confirmation' });
    first.unmount();
    fetch
      .mockResolvedValueOnce(Response.json({ id: 'learner-1' }))
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(
        Response.json({ courseId: 'course', level: 'A2', addedVocabulary: 0 })
      );
    render(<NotesPlacement native="en" target="de" onVerify={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open saved analysis' }));
    await screen.findByText('Original saved sources.');
    fireEvent.click(screen.getByRole('button', { name: 'Start here' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/learn'));
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts.map(([url]) => url)).toEqual([
      '/api/v1/placement/from-notes/confirm',
      '/api/v1/placement/from-notes/confirm',
    ]);
    expect(posts[0][1]?.body).toBe(posts[1][1]?.body);
  });

  it('never opens the previous learner sources after switching profiles', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id: 'learner-2' }));
    vi.stubGlobal('fetch', fetch);
    render(<NotesPlacement native="en" target="de" onVerify={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open saved analysis' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No saved source analysis');
    expect(screen.queryByText('Original saved sources.')).not.toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/v1/users/me']);
  });
});
