import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PracticePanel } from '@/components/learn/PracticePanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const savedExercises = (sessionId: string) => ({
  status: 'ready',
  sessionId,
  kind: 'GRAMMAR',
  items: [
    {
      id: 'g0',
      prompt: 'Choose a greeting for Mia.',
      options: ['Hallo', 'Tschüss', 'Morgen', 'Gestern'],
    },
  ],
});

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
  fetchMock.mockReset();
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

  it('offers to resume active work and view completed results', async () => {
    render(<PracticePanel courseId="course-1" courseName="German" />);

    const resumeButtons = await screen.findAllByRole('button', { name: /^Resume / });
    expect(resumeButtons).toHaveLength(1);
    expect(resumeButtons[0]).toHaveAccessibleName('Resume Full catch-up practice');
    expect(screen.getAllByRole('button', { name: /^View results for / })).toHaveLength(2);
  });

  it('reopens a session in the runner without building a new one', async () => {
    render(<PracticePanel courseId="course-1" courseName="German" />);
    const resume = await screen.findByRole('button', { name: /^Resume / });

    fetchMock.mockResolvedValueOnce(jsonResponse(savedExercises('sess-active')));
    fireEvent.click(resume);

    expect(await screen.findByText('Choose a greeting for Mia.')).toBeInTheDocument();
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
    expect(screen.queryByText('Choose a greeting for Mia.')).not.toBeInTheDocument();
  });
});

describe('PracticePanel durable generation', () => {
  const queued = {
    status: 'preparing',
    sessionId: 'saved-attempt',
    preparationStatus: 'QUEUED',
    message: 'Practice is saved and waiting for a worker.',
    canRecover: false,
  };

  it('shows preparation and failure states in history and can reopen saved generation', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...OVERVIEW,
        recent: [
          { id: 'saved-attempt', kind: 'GRAMMAR', status: 'GENERATING', score: null },
          { id: 'failed-attempt', kind: 'READING', status: 'FAILED', score: null },
          { id: 'cancelled-attempt', kind: 'FULL', status: 'CANCELLED', score: null },
        ],
      })
    );
    render(<PracticePanel courseId="course-1" courseName="German" />);
    expect(await screen.findByText('Preparing')).toBeInTheDocument();
    expect(screen.getByText('Generation failed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(jsonResponse(queued));
    fireEvent.click(screen.getByRole('button', { name: 'Resume Grammar practice' }));
    expect(await screen.findByText(queued.message)).toBeInTheDocument();
  });

  it('polls a saved request until exercises publish without submitting another generation request', async () => {
    render(<PracticePanel courseId="course-1" courseName="German" />);
    await screen.findByText('In progress');
    fetchMock.mockResolvedValueOnce(jsonResponse(queued, 202));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...queued, preparationStatus: 'RUNNING', message: 'Preparing exercises.' })
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(savedExercises(queued.sessionId)));
    fireEvent.click(screen.getByRole('button', { name: /^Practice Grammar/ }));
    expect(await screen.findByText(queued.message)).toBeInTheDocument();
    expect(
      await screen.findByText('Choose a greeting for Mia.', {}, { timeout: 4500 })
    ).toBeInTheDocument();
    const admissions = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
    );
    expect(admissions).toHaveLength(1);
    expect(JSON.parse(admissions[0][1].body)).toMatchObject({
      kind: 'GRAMMAR',
      requestId: expect.any(String),
    });
  });

  it('can check a lost admission acknowledgement and restore the same paid attempt', async () => {
    render(<PracticePanel courseId="course-1" courseName="German" />);
    await screen.findByText('In progress');
    fetchMock.mockRejectedValueOnce(new TypeError('Connection closed'));
    fireEvent.click(screen.getByRole('button', { name: /^Practice Grammar/ }));
    expect(await screen.findByText(/acknowledgement was lost/)).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(jsonResponse(savedExercises(queued.sessionId)));
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    expect(await screen.findByText('Choose a greeting for Mia.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
      )
    ).toHaveLength(1);
  });
});
