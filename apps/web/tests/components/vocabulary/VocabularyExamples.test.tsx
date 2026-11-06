import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VocabularyExamples } from '@/components/learn/vocabulary/VocabularyExamples';

const fetchMock = vi.fn<typeof fetch>();
const request = {
  operationId: '00000000-0000-4000-8000-000000000001',
  retryOf: null,
  sourceHash: 'a'.repeat(64),
};
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('flashcard examples', () => {
  it('prepares examples only after the learner asks and shows the saved sentences', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: 'AVAILABLE', request, canRetry: false })
    );
    fetchMock.mockResolvedValueOnce(
      Response.json({
        status: 'READY',
        request,
        canRetry: false,
        examples: [
          { sentence: 'Der Bahnhof ist groß.', translation: null },
          { sentence: 'Wir warten am Bahnhof.', translation: null },
        ],
      })
    );
    const user = userEvent.setup();
    render(
      <VocabularyExamples sessionId="session" cardId="card" profileId="learner" revealed={false} />
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'See two examples' }));
    expect(await screen.findByText('Der Bahnhof ist groß.')).toBeVisible();
    expect(screen.queryByText('The station is large.')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      method: 'POST',
      headers: {
        'x-sotto-expected-profile-id': 'learner',
        'Content-Type': 'application/json',
      },
    });
  });

  it('checks an uncertain request before starting another generation', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network lost'));
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'PENDING', request, canRetry: false }));
    const user = userEvent.setup();
    render(
      <VocabularyExamples sessionId="session" cardId="card" profileId="learner" revealed={false} />
    );
    await user.click(screen.getByRole('button', { name: 'See two examples' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Check examples' }));
    await waitFor(() => expect(screen.getByText('Preparing examples…')).toBeVisible());
    expect(fetchMock.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
  });
});
