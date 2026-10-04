import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StartNextClass } from '@/components/learn/StartNextClass';

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: mockRefresh }) }));

vi.mock('@/components/landing/GlassOrb', () => ({
  GlassOrb: () => <span data-testid="glass-orb" />,
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe('StartNextClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('shows the saved failure reason without exposing private review content', async () => {
    const reason =
      'The generated lesson did not pass teaching review. You can start a new attempt.';
    vi.mocked(global.fetch).mockImplementation(async (url) =>
      String(url).includes('/preparation?')
        ? jsonResponse({
            aiProvider: 'codex',
            aiModel: 'selected-model',
            availableAt: '2026-10-04T10:00:00Z',
            timeZone: 'UTC',
            maxProviderRequests: null,
            providerRequestsAdmitted: null,
            failureReason: reason,
            events: [],
          })
        : jsonResponse({
            status: 'FAILED',
            operationId: 'failed-operation',
            detail: 'Preparation failed.',
            progress: 0,
          })
    );
    render(<StartNextClass courseId="course-1" activeClassId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check preparation' }));
    expect(await screen.findByText('Preparation activity')).toBeInTheDocument();
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(screen.queryByText(/private candidate/i)).not.toBeInTheDocument();
  });

  it('schedules one bounded preparation with audio deferred', async () => {
    let submitted: Record<string, unknown> | undefined;
    vi.mocked(global.fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/preparation')) {
        submitted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ operationId: 'task-1' }, 202);
      }
      return jsonResponse({
        status: 'GENERATING',
        operationStatus: 'QUEUED',
        detail: 'Scheduled for tomorrow',
        progress: 0,
      });
    });
    const { unmount } = render(<StartNextClass courseId="course-1" activeClassId={null} />);
    fireEvent.click(screen.getByText('Prepare a class later'));
    fireEvent.change(screen.getByLabelText(/preparation time/i), {
      target: { value: '2026-09-28T10:00' },
    });
    fireEvent.change(screen.getByLabelText(/maximum model requests/i), { target: { value: '32' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule preparation' }));
    expect(await screen.findByText('Scheduled for tomorrow')).toBeInTheDocument();
    expect(submitted).toMatchObject({ maxProviderRequests: 32, deferAudio: true });
    expect(Date.parse(String(submitted?.availableAt))).toBe(new Date('2026-09-28T10:00').getTime());
    unmount();
  });

  it('keeps cancellation visible until active work settles', async () => {
    let cancelling = false;
    vi.mocked(global.fetch).mockImplementation(async (_url, init) => {
      if (init?.method === 'DELETE') {
        cancelling = true;
        return jsonResponse({ cancelling: true });
      }
      return jsonResponse({
        status: cancelling ? 'CANCELLING' : 'GENERATING',
        detail: cancelling ? 'Waiting for active work to settle.' : 'Preparing your class.',
        progress: 0,
      });
    });
    const { unmount } = render(<StartNextClass courseId="course-1" activeClassId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check preparation' }));
    expect(await screen.findByText('Preparing your class.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel generation' }));
    expect(await screen.findByText('Waiting for active work to settle.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /take a class at this level/i })
    ).not.toBeInTheDocument();
    unmount();
  });

  it('shows completion when an asynchronous preparation finishes the course', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ status: 'COMPLETED', result: 'done', progress: 1 })
    );
    render(<StartNextClass courseId="course-1" activeClassId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check preparation' }));
    expect(await screen.findByText('Course complete')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('requires acknowledgement before recovery and preserves cleanup failures', async () => {
    let recovery: unknown;
    vi.mocked(global.fetch).mockImplementation(async (_url, init) => {
      if (init?.method === 'PATCH') {
        recovery = JSON.parse(String(init.body));
        return jsonResponse({ error: 'Execution cleanup is not confirmed.' }, 409);
      }
      return jsonResponse({
        status: 'UNRESOLVED',
        detail: 'Preparation was interrupted.',
        progress: 0,
      });
    });
    render(<StartNextClass courseId="course-1" activeClassId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check preparation' }));
    const recover = await screen.findByRole('button', { name: 'Check cleanup and recover' });
    expect(recover).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /provider may have charged/i }));
    fireEvent.click(recover);
    expect(await screen.findByRole('alert')).toHaveTextContent(/cleanup is not confirmed/i);
    expect(recovery).toEqual({ acknowledgeUnknownOutcome: true });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows the persisted model and consumed request budget', async () => {
    vi.mocked(global.fetch).mockImplementation(async (url) => {
      if (String(url).includes('/preparation?')) {
        return jsonResponse({
          aiProvider: 'meta',
          aiModel: 'muse-spark-1.3',
          availableAt: '2026-09-28T15:00:00Z',
          timeZone: 'America/Bogota',
          maxProviderRequests: 32,
          providerRequestsAdmitted: 3,
          events: [{ sequence: 1, at: 1790607600000, type: 'created' }],
        });
      }
      return jsonResponse({
        operationId: 'task-1',
        status: 'GENERATING',
        detail: 'Preparing your class.',
        progress: 0,
      });
    });
    const { unmount } = render(<StartNextClass courseId="course-1" activeClassId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check preparation' }));
    expect(await screen.findByText(/3 of 32 model requests admitted/i)).toBeInTheDocument();
    expect(screen.getByText(/meta: muse-spark-1.3/)).toBeInTheDocument();
    unmount();
  });

  it('labels the primary action as taking a class when no class is active', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/v1/courses/course-1/next-class') {
        return Promise.resolve(jsonResponse({ classId: 'class-1' }, 201));
      }

      if (url === '/api/v1/courses/course-1/generation') {
        return Promise.resolve(
          jsonResponse({
            status: 'AVAILABLE',
            classId: 'class-1',
            lessonTitle: 'Greetings',
            stage: 'Class ready',
            detail: 'Opening the generated class.',
            progress: 1,
            currentStep: 6,
            totalSteps: 6,
            elapsedSeconds: 12,
          })
        );
      }

      return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
    });

    render(<StartNextClass courseId="course-1" activeClassId={null} />);

    fireEvent.click(screen.getByRole('button', { name: /take a class at this level/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/learn/class/class-1'));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/courses/course-1/next-class',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('checks readiness before resuming an active class', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/v1/courses/course-1/generation') {
        return Promise.resolve(
          jsonResponse({
            status: 'AVAILABLE',
            classId: 'class-active',
            lessonTitle: 'Greetings',
            stage: 'Class ready',
            detail: 'Opening the generated class.',
            progress: 1,
            currentStep: 6,
            totalSteps: 6,
            elapsedSeconds: 20,
          })
        );
      }

      return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
    });

    render(<StartNextClass courseId="course-1" activeClassId="class-active" />);

    fireEvent.click(screen.getByRole('button', { name: /resume active class/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/learn/class/class-active'));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/courses/course-1/generation',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('keeps active classes inline while listening audio is still rendering', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/v1/courses/course-1/generation') {
        return Promise.resolve(
          jsonResponse({
            status: 'GENERATING',
            classId: 'class-active',
            lessonTitle: 'Greetings',
            stage: 'Rendering listening audio',
            detail: 'Generating the listening scene audio.',
            progress: 0.9,
            currentStep: 3,
            totalSteps: 6,
            elapsedSeconds: 30,
          })
        );
      }

      return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
    });

    const { unmount } = render(<StartNextClass courseId="course-1" activeClassId="class-active" />);

    fireEvent.click(screen.getByRole('button', { name: /resume active class/i }));

    expect(await screen.findByText('Generating the listening scene audio.')).toBeInTheDocument();
    expect(screen.getByText('Preparing Greetings')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();

    unmount();
  });

  it('opens a non-generating active class even when presentation material is incomplete', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/v1/courses/course-1/generation') {
        return Promise.resolve(
          jsonResponse({
            status: 'AVAILABLE',
            classId: 'class-active',
            lessonTitle: 'Greetings',
            stage: 'Class needs attention',
            detail: 'Open the class to review missing material.',
            progress: 1,
            currentStep: 6,
            totalSteps: 6,
            elapsedSeconds: 30,
          })
        );
      }

      return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
    });

    render(<StartNextClass courseId="course-1" activeClassId="class-active" />);

    fireEvent.click(screen.getByRole('button', { name: /resume active class/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/learn/class/class-active'));
  });

  it('lets learners cancel an in-progress class generation', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string, init?: RequestInit) => {
        if (url === '/api/v1/courses/course-1/next-class') {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        }

        if (url === '/api/v1/courses/course-1/generation' && init?.method === 'DELETE') {
          return Promise.resolve(jsonResponse({ cancelled: true }));
        }

        if (url === '/api/v1/courses/course-1/generation') {
          return Promise.resolve(
            jsonResponse({
              status: 'GENERATING',
              classId: 'class-1',
              lessonTitle: 'Greetings',
              stage: 'Generating grammar questions',
              detail: 'Building the first section.',
              progress: 0.2,
              currentStep: 1,
              totalSteps: 6,
              elapsedSeconds: 8,
            })
          );
        }

        return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
      }
    );

    render(<StartNextClass courseId="course-1" activeClassId={null} />);

    fireEvent.click(screen.getByRole('button', { name: /take a class at this level/i }));

    const cancel = await screen.findByRole('button', { name: /cancel generation/i });
    fireEvent.click(cancel);

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/courses/course-1/generation', {
      method: 'DELETE',
    });
  });
});
