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

  it('labels the primary action as taking a class when no class is active', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/v1/courses/course-1/next-class') {
        return Promise.resolve(jsonResponse({ classId: 'class-1' }, 201));
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

  it('labels the primary action as resuming when a class is active', () => {
    render(<StartNextClass courseId="course-1" activeClassId="class-active" />);

    fireEvent.click(screen.getByRole('button', { name: /resume active class/i }));

    expect(mockPush).toHaveBeenCalledWith('/learn/class/class-active');
    expect(global.fetch).not.toHaveBeenCalled();
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
