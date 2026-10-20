import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PracticePanel } from '@/components/learn/PracticePanel';
import { StrictMode } from 'react';

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

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
  it('shows qualified objective reviews once in full catch-up and in each applicable channel', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...OVERVIEW,
        due: {
          vocab: 3,
          grammar: 1,
          objectives: 2,
          bySkill: { GRAMMAR: 1, READING: 2, WRITING: 1 },
        },
      })
    );
    render(<PracticePanel courseId="course-1" courseName="German" />);
    expect(
      await screen.findByRole('button', { name: 'Practice Full catch-up, 6 due' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practice Grammar, 2 due' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practice Reading, 2 due' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practice Writing, 1 due' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practice Vocabulary, 3 due' })).toBeInTheDocument();
  });
  it('opens the course dictionary for vocabulary practice without generating a quiz', async () => {
    render(<PracticePanel courseId="course-1" courseName="German" />);
    fireEvent.click(await screen.findByRole('button', { name: /Practice Vocabulary/ }));
    expect(navigation.push).toHaveBeenCalledWith('/learn/vocabulary?course=course-1');
    expect(fetchMock.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  });
  it('badges each past session by how it ended', async () => {
    render(<PracticePanel courseId="course-1" courseName="German" />);

    expect(await screen.findByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('offers to resume active work and view completed results', async () => {
    render(<PracticePanel courseId="course-1" courseName="German" />);

    const resumeButtons = await screen.findAllByRole('button', {
      name: /^Resume /,
    });
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
  it('admits a focused lower-level selection once in StrictMode and returns from its saved result to the map', async () => {
    const selection = {
      catalogVersion: 3,
      level: 'A1' as const,
      nodeIds: ['de.grammar.exact', 'de.situations.exact'],
      materialFocusId: 'owned-source-focus',
    };
    const admissions: Array<{
      kind: string;
      requestId: string;
      learningSelection: unknown;
    }> = [];
    let returned = false;
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') return jsonResponse(OVERVIEW);
      const body = JSON.parse(String(init.body));
      admissions.push(body);
      return jsonResponse({
        ...savedExercises(body.requestId),
        practiceLevel: 'A1',
        submissionResult: { score: 1, correct: 1, total: 1 },
      });
    });
    const { rerender } = render(
      <StrictMode>
        <PracticePanel
          courseId="course-1"
          courseName="German A2"
          initialKind="GRAMMAR"
          initialLearningSelection={selection}
          onComplete={() => {
            returned = true;
          }}
        />
      </StrictMode>
    );
    expect(await screen.findByRole('region', { name: 'Practice result' })).toHaveTextContent(
      '1 of 1 choices correct.'
    );
    expect(
      screen.getByText('Focused practice at A1. Your course level stays the same.')
    ).toBeTruthy();
    expect(admissions).toEqual([
      {
        kind: 'GRAMMAR',
        requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
        learningSelection: selection,
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(returned).toBe(true);
    rerender(<p>Learning map reloaded from saved assessments.</p>);
    expect(screen.getByText('Learning map reloaded from saved assessments.')).toBeTruthy();
    expect(admissions).toHaveLength(1);
  });
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
          {
            id: 'saved-attempt',
            kind: 'GRAMMAR',
            status: 'GENERATING',
            score: null,
          },
          {
            id: 'failed-attempt',
            kind: 'READING',
            status: 'FAILED',
            score: null,
          },
          {
            id: 'cancelled-attempt',
            kind: 'FULL',
            status: 'CANCELLED',
            score: null,
          },
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
      jsonResponse({
        ...queued,
        preparationStatus: 'RUNNING',
        message: 'Preparing exercises.',
      })
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
