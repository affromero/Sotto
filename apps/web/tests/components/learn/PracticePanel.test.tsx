import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PracticePanel } from '@/components/learn/PracticePanel';

vi.mock('@/components/learn/PracticeRunner', () => ({
  PracticeRunner: () => <div data-testid="runner">running</div>,
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

const OVERVIEW = {
  due: { vocab: 3, grammar: 1 },
  totalVocab: 12,
  recent: [
    { id: 'sess-active', kind: 'FULL', status: 'ACTIVE', score: null },
    { id: 'sess-passed', kind: 'GRAMMAR', status: 'COMPLETED', score: 0.8 },
    { id: 'sess-done', kind: 'READING', status: 'COMPLETED', score: 0.4 },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(jsonResponse(OVERVIEW));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PracticePanel recent sessions', () => {
  it('badges each past session by how it ended', async () => {
    render(<PracticePanel courseId="course-1" courseName="German" />);

    expect(await screen.findByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('offers to resume only the session still in progress', async () => {
    render(<PracticePanel courseId="course-1" courseName="German" />);

    const resumeButtons = await screen.findAllByRole('button', { name: /^Resume / });
    expect(resumeButtons).toHaveLength(1);
    expect(resumeButtons[0]).toHaveAccessibleName('Resume Full catch-up practice');
  });

  it('reopens a session in the runner without building a new one', async () => {
    render(<PracticePanel courseId="course-1" courseName="German" />);
    const resume = await screen.findByRole('button', { name: /^Resume / });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'ready', sessionId: 'sess-active', kind: 'FULL', items: [] })
    );
    fireEvent.click(resume);

    expect(await screen.findByTestId('runner')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/practice/sess-active');
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    ).toBe(false);
  });

  it('tells the learner to start fresh when a session cannot be reopened', async () => {
    render(<PracticePanel courseId="course-1" courseName="German" />);
    const resume = await screen.findByRole('button', { name: /^Resume / });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Practice session not found' }, 404));
    fireEvent.click(resume);

    await waitFor(() => {
      expect(screen.getByText(/could not be reopened/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('runner')).not.toBeInTheDocument();
  });
});
