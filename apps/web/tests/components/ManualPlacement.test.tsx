import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManualPlacement } from '@/components/placement/ManualPlacement';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe('ManualPlacement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('warns that a self-selected level is less accurate', () => {
    render(<ManualPlacement native="en" target="es" />);
    expect(screen.getByRole('note')).toHaveTextContent(/placement test is more accurate/i);
  });

  it('disables the start button until a level is chosen', () => {
    render(<ManualPlacement native="en" target="es" />);
    expect(screen.getByRole('button', { name: /start at this level/i })).toBeDisabled();
  });

  it('posts the chosen level and navigates to the learn hub', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ courseId: 'course-1', level: 'B2' }, true),
    );
    render(<ManualPlacement native="en" target="es" />);

    fireEvent.click(screen.getByRole('button', { name: /^B2/ }));
    fireEvent.click(screen.getByRole('button', { name: /start at this level/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/learn'));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/placement/manual',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ native: 'en', target: 'es', level: 'B2' }),
      }),
    );
  });

  it('offers the full A1–C2 ladder including levels above B2', () => {
    render(<ManualPlacement native="en" target="es" />);
    for (const code of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${code}`) })).toBeInTheDocument();
    }
  });

  it('shows an error and does not navigate when the request fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ error: 'Rate limit exceeded.' }, false),
    );
    render(<ManualPlacement native="en" target="es" />);

    fireEvent.click(screen.getByRole('button', { name: /^A2/ }));
    fireEvent.click(screen.getByRole('button', { name: /start at this level/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/rate limit/i));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
