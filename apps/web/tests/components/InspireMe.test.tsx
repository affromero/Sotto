import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InspireMe } from '@/components/discovery/InspireMe';

const mockQuestions = {
  questions: [
    {
      id: 'q1',
      text: 'The Future of AI in Healthcare',
      tagSlugs: ['ai', 'health'],
      category: 'Technology',
    },
    {
      id: 'q2',
      text: 'Climate Change Solutions',
      tagSlugs: ['science', 'climate'],
      category: 'Science',
    },
  ],
};

describe('InspireMe', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when open is false', () => {
    const { container } = render(
      <InspireMe open={false} onClose={vi.fn()} onSelectTopic={vi.fn()} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with proper ARIA attributes when open', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockQuestions,
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Inspire Me' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('renders section tabs', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockQuestions,
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'For You' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Trending' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'In the News' })).toBeInTheDocument();
  });

  it('For You tab is active by default', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockQuestions,
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'For You' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Trending' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('fetches questions for the active section', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockQuestions,
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/inspire/questions?section=forYou&count=6'
      );
    });
  });

  it('displays quiz questions once loaded', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockQuestions,
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });
  });

  it('switching tabs fetches questions for that section', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockQuestions,
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Trending' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/inspire/questions?section=trending&count=6'
      );
    });
  });

  it('clicking close button calls onClose', async () => {
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockQuestions,
    });

    render(<InspireMe open={true} onClose={handleClose} onSelectTopic={vi.fn()} />);

    await user.click(screen.getByLabelText('Close'));

    expect(handleClose).toHaveBeenCalled();
  });

  it('clicking backdrop calls onClose', async () => {
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockQuestions,
    });

    render(<InspireMe open={true} onClose={handleClose} onSelectTopic={vi.fn()} />);

    const backdrop = document.querySelector('[class*="backdrop"]');
    expect(backdrop).toBeInTheDocument();

    if (backdrop) {
      await user.click(backdrop);
      expect(handleClose).toHaveBeenCalled();
    }
  });

  it('clicking "Yes, make this" calls onSelectTopic and closes overlay', async () => {
    const handleSelectTopic = vi.fn();
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockQuestions,
    });

    render(
      <InspireMe open={true} onClose={handleClose} onSelectTopic={handleSelectTopic} />
    );

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Yes, make this'));

    expect(handleSelectTopic).toHaveBeenCalledWith('The Future of AI in Healthcare');
    expect(handleClose).toHaveBeenCalled();
  });

  it('shows empty state when no questions are returned', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ questions: [] }),
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText('No suggestions available right now. Try again later!')
      ).toBeInTheDocument();
    });
  });

  it('handles fetch error gracefully', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText('No suggestions available right now. Try again later!')
      ).toBeInTheDocument();
    });
  });

  it('shows loading state while fetching questions', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    expect(screen.getByText('Finding ideas for you...')).toBeInTheDocument();
  });
});
