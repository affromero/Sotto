import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlacementEntry } from '@/components/placement/PlacementEntry';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const analysisId = '86f0dbae-f89e-479d-9bf2-fcc9c74165e3';
const placementSessionId = '479a9e06-21f1-4ae2-8974-1838434bd68b';
const resultDigest = 'a'.repeat(64),
  questionsDigest = 'b'.repeat(64);
const question = {
  id: 'pq_0',
  cefr: 'B1',
  skill: 'grammar',
  prompt: 'Choose the matching construction.',
  options: ['A', 'B', 'C', 'D', 'I do not know'],
};
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());
describe('placement entry with exact receipt transport', () => {
  it.each(['ready', 'network failure'])(
    'ignores an obsolete %s after cancelling and opening a saved quiz',
    async (outcome) => {
      let resolve: (response: Response) => void = () => {};
      let reject: (error: Error) => void = () => {};
      const pending = new Promise<Response>((accept, fail) => {
        resolve = accept;
        reject = fail;
      });
      vi.mocked(fetch)
        .mockImplementationOnce(() => pending)
        .mockResolvedValueOnce(
          Response.json({
            status: 'READY',
            placementSessionId,
            questionsDigest,
            questions: [question],
          })
        );
      render(<PlacementEntry native="en" target="es" />);
      fireEvent.click(screen.getByText('Take the placement test'));
      fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
      fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
      await screen.findByText(question.prompt);
      await act(async () => {
        if (outcome === 'ready')
          resolve(
            Response.json({
              status: 'READY',
              placementSessionId,
              questionsDigest,
              questions: [{ ...question, prompt: 'Obsolete quiz' }],
            })
          );
        else reject(new TypeError('Obsolete network failure'));
      });
      expect(screen.getByText(question.prompt)).toBeInTheDocument();
      expect(screen.queryByText('Obsolete quiz')).not.toBeInTheDocument();
      expect(screen.queryByText(/network error/i)).not.toBeInTheDocument();
    }
  );
  it('offers the test, the materials path, and manual selection', () => {
    render(<PlacementEntry native="en" target="es" />);
    expect(screen.getByText('Take the placement test')).toBeInTheDocument();
    expect(screen.getByText('I have materials from my level')).toBeInTheDocument();
    expect(screen.getByText('I already know my level')).toBeInTheDocument();
  });
  it('opens the manual level picker when chosen', () => {
    render(<PlacementEntry native="en" target="es" />);
    fireEvent.click(screen.getByText('I already know my level'));
    expect(screen.getByRole('group', { name: 'Choose your level' })).toBeInTheDocument();
  });
  it('opens the multiple-choice test with its saved session receipt', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ status: 'READY', placementSessionId, questionsDigest, questions: [question] })
    );
    render(<PlacementEntry native="en" target="es" />);
    fireEvent.click(screen.getByText('Take the placement test'));
    expect(await screen.findByText(question.prompt)).toBeInTheDocument();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).requestId).toMatch(
      /^[a-f0-9-]{36}$/
    );
  });
  it('opens the materials path and can go back', () => {
    render(<PlacementEntry native="en" target="es" />);
    fireEvent.click(screen.getByText('I have materials from my level'));
    expect(screen.getByLabelText(/paste notes/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Take the placement test')).toBeInTheDocument();
  });
  it('replays the exact saved submission when its committed response is lost', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          status: 'READY',
          placementSessionId,
          questionsDigest,
          questions: [question],
        })
      )
      .mockRejectedValueOnce(new Error('Synthetic lost confirmation response'))
      .mockResolvedValueOnce(
        Response.json({ courseId: 'course', level: 'B1', scoreBySkill: { grammar: 1 } })
      );
    render(<PlacementEntry native="en" target="es" />);
    fireEvent.click(screen.getByText('Take the placement test'));
    await screen.findByText(question.prompt);
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry submission' }));
    await screen.findByText(/skill breakdown/i);
    expect(vi.mocked(fetch).mock.calls[1][1]?.body).toBe(vi.mocked(fetch).mock.calls[2][1]?.body);
    expect(vi.mocked(fetch).mock.calls[2][1]?.method).toBe('POST');
  });
  it('carries the exact analyzed source receipt into verification and the saved quiz receipt into submission', async () => {
    const analysis = {
      analysisId,
      analysisRevision: 1,
      status: 'COMPLETE',
      resultDigest,
      summary: {
        focusCount: 2,
        inference: { level: 'B1', confidence: 0.7, rationale: 'Precise source focuses.' },
      },
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ id: 'owner' }))
      .mockResolvedValueOnce(Response.json({ id: 'owner' }))
      .mockResolvedValueOnce(Response.json(analysis))
      .mockResolvedValueOnce(Response.json(analysis))
      .mockResolvedValueOnce(
        Response.json({
          status: 'READY',
          placementSessionId,
          questionsDigest,
          questions: [question],
        })
      )
      .mockResolvedValueOnce(
        Response.json({ courseId: 'course', level: 'B1', scoreBySkill: { grammar: 1 } })
      );
    render(<PlacementEntry native="en" target="es" />);
    fireEvent.click(screen.getByText('I have materials from my level'));
    fireEvent.change(screen.getByLabelText(/paste notes/i), {
      target: { value: 'Owned source class' },
    });
    fireEvent.click(screen.getByRole('button', { name: /find my level/i }));
    fireEvent.click(await screen.findByRole('button', { name: /verify with a few questions/i }));
    expect(await screen.findByText(question.prompt)).toBeInTheDocument();
    const admission: unknown = JSON.parse(String(vi.mocked(fetch).mock.calls[4][1]?.body));
    expect(admission).toMatchObject({ analysisId, resultDigest });
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.getByText(/skill breakdown/i)).toBeInTheDocument());
    const submitted: unknown = JSON.parse(String(vi.mocked(fetch).mock.calls[5][1]?.body));
    expect(submitted).toMatchObject({
      placementSessionId,
      questionsDigest,
      analysisId,
      analysisRevision: 1,
      resultDigest,
      acceptPartial: false,
      answers: [{ id: 'pq_0', selectedIndex: 0 }],
    });
  });
});
