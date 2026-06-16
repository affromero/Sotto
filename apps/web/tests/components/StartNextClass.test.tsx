import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StartNextClass } from '@/components/learn/StartNextClass';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

vi.mock('@/components/landing/GlassOrb', () => ({
  GlassOrb: () => <span data-testid="glass-orb" />,
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    json: async () => body,
  } as Response;
}

describe('StartNextClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('labels the primary action as taking a class when no class is active', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ classId: 'class-1' }, 201)
    );
    render(<StartNextClass courseId="course-1" activeClassId={null} />);

    fireEvent.click(screen.getByRole('button', { name: /take a class at this level/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/learn/class/class-1'));
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/courses/course-1/next-class', {
      method: 'POST',
    });
  });

  it('labels the primary action as resuming when a class is active', () => {
    render(<StartNextClass courseId="course-1" activeClassId="class-active" />);

    fireEvent.click(screen.getByRole('button', { name: /resume active class/i }));

    expect(mockPush).toHaveBeenCalledWith('/learn/class/class-active');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
