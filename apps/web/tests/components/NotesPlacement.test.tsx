import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotesPlacement } from '@/components/placement/NotesPlacement';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe('NotesPlacement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  async function deduce() {
    const onVerify = vi.fn();
    render(<NotesPlacement native="en" target="es" onVerify={onVerify} />);
    fireEvent.change(screen.getByLabelText(/paste notes/i), { target: { value: 'mi cuaderno de espanol' } });

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ deducedLevel: 'B1', rationale: 'Uses past tense.', confidence: 0.8 }),
    );
    fireEvent.click(screen.getByRole('button', { name: /find my level/i }));
    await waitFor(() => expect(screen.getByText('B1')).toBeInTheDocument());
    return onVerify;
  }

  it('deduces and shows the level with both confirm options', async () => {
    await deduce();
    expect(screen.getByText('Uses past tense.')).toBeInTheDocument();
    expect(screen.getByText('Confidence: 80%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start here/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify with a few questions/i })).toBeInTheDocument();
  });

  it('"Start here" confirms and navigates to the learn hub', async () => {
    await deduce();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ courseId: 'course-1', level: 'B1', addedVocabulary: 5 }, true),
    );
    fireEvent.click(screen.getByRole('button', { name: /start here/i }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/learn'));
  });

  it('"Verify" hands the deduced level back to the parent', async () => {
    const onVerify = await deduce();
    fireEvent.click(screen.getByRole('button', { name: /verify with a few questions/i }));
    expect(onVerify).toHaveBeenCalledWith('B1');
  });

  it('shows an error when the materials cannot be read', async () => {
    const onVerify = vi.fn();
    render(<NotesPlacement native="en" target="es" onVerify={onVerify} />);
    fireEvent.change(screen.getByLabelText(/paste notes/i), { target: { value: 'x' } });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ error: 'No readable materials uploaded' }, false),
    );
    fireEvent.click(screen.getByRole('button', { name: /find my level/i }));
    await waitFor(() => expect(screen.getByText(/no readable materials/i)).toBeInTheDocument());
  });
});
