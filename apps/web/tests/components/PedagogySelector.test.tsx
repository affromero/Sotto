/**
 * PedagogySelector lets a learner switch the course's teaching approach and shows
 * the research each draws on, with copy that it applies to future generation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PedagogySelector } from '@/components/learn/PedagogySelector';

describe('PedagogySelector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all five approaches and the current basis', () => {
    render(<PedagogySelector courseId="c1" current="IMMERSION" />);
    const select = screen.getByLabelText('Teaching approach') as HTMLSelectElement;
    expect(select.value).toBe('IMMERSION');
    for (const label of ['Balanced', 'Immersion', 'Grammar-first', 'Conversation-first', 'Intensive review']) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText(/Krashen/)).toBeInTheDocument();
  });

  it('PATCHes the new approach on change and confirms it applies to future content', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ pedagogy: 'GRAMMAR' }), { status: 200 }),
    );
    const user = userEvent.setup();
    render(<PedagogySelector courseId="c1" current="BALANCED" />);

    await user.selectOptions(screen.getByLabelText('Teaching approach'), 'GRAMMAR');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/courses/c1/pedagogy',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(await screen.findByText(/Applies to your next class/)).toBeInTheDocument();
  });
});
