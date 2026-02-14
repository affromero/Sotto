import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InspireMe } from '@/components/discovery/InspireMe';

const mockInspireData = {
  forYou: [
    {
      title: 'The Future of AI in Healthcare',
      category: 'Technology',
      hook: 'How AI is revolutionizing medical diagnosis',
    },
    {
      title: 'Climate Change Solutions',
      category: 'Science',
      hook: 'Practical approaches to environmental challenges',
    },
  ],
  trending: [
    {
      title: 'Quantum Computing Basics',
      category: 'Technology',
      hook: 'Understanding the next computing revolution',
    },
    {
      title: 'Mediterranean Diet Benefits',
      category: 'Health',
      hook: 'Science-backed nutrition insights',
    },
  ],
  inTheNews: [
    {
      title: 'Space Exploration Updates',
      category: 'Science',
      hook: 'Latest discoveries from Mars missions',
    },
    {
      title: 'Economic Policy Changes',
      category: 'Politics',
      hook: 'How new regulations affect everyday life',
    },
  ],
};

const mockDrillData = {
  subtopics: [
    {
      title: 'AI Diagnostic Tools',
      category: 'Technology',
      hook: 'Current state of AI-powered diagnostics',
    },
    {
      title: 'Patient Data Privacy',
      category: 'Technology',
      hook: 'Security concerns in AI healthcare',
    },
    {
      title: 'AI Training on Medical Data',
      category: 'Technology',
      hook: 'How AI learns from patient records',
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

  it('shows loading state while fetching', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // Never resolves to keep loading
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Finding topics for you...')).toBeInTheDocument();
    });
  });

  it('displays "For You" section with topic cards', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockInspireData,
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('For You')).toBeInTheDocument();
    });

    expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    expect(screen.getByText('How AI is revolutionizing medical diagnosis')).toBeInTheDocument();
    expect(screen.getByText('Climate Change Solutions')).toBeInTheDocument();
  });

  it('displays "Trending on Sotto" section', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockInspireData,
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Trending on Sotto')).toBeInTheDocument();
    });

    expect(screen.getByText('Quantum Computing Basics')).toBeInTheDocument();
    expect(screen.getByText('Understanding the next computing revolution')).toBeInTheDocument();
    expect(screen.getByText('Mediterranean Diet Benefits')).toBeInTheDocument();
  });

  it('displays "In the News" section', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockInspireData,
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('In the News')).toBeInTheDocument();
    });

    expect(screen.getByText('Space Exploration Updates')).toBeInTheDocument();
    expect(screen.getByText('Latest discoveries from Mars missions')).toBeInTheDocument();
    expect(screen.getByText('Economic Policy Changes')).toBeInTheDocument();
  });

  it('clicking trending card calls onSelectTopic with title and closes overlay', async () => {
    const handleSelectTopic = vi.fn();
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockInspireData,
    });

    render(<InspireMe open={true} onClose={handleClose} onSelectTopic={handleSelectTopic} />);

    await waitFor(() => {
      expect(screen.getByText('Quantum Computing Basics')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Quantum Computing Basics'));

    expect(handleSelectTopic).toHaveBeenCalledWith('Quantum Computing Basics');
    expect(handleClose).toHaveBeenCalled();
  });

  it('clicking close button calls onClose', async () => {
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockInspireData,
    });

    render(<InspireMe open={true} onClose={handleClose} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Close')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Close'));

    expect(handleClose).toHaveBeenCalled();
  });

  it('clicking backdrop calls onClose', async () => {
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockInspireData,
    });

    render(<InspireMe open={true} onClose={handleClose} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Inspire Me')).toBeInTheDocument();
    });

    const backdrop = document.querySelector('[class*="backdrop"]');
    expect(backdrop).toBeInTheDocument();

    if (backdrop) {
      await user.click(backdrop);
      expect(handleClose).toHaveBeenCalled();
    }
  });

  it('drill-down: clicking a For You card shows subtopics', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInspireData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockDrillData,
      });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    await user.click(screen.getByText('The Future of AI in Healthcare'));

    await waitFor(() => {
      expect(screen.getByText('AI Diagnostic Tools')).toBeInTheDocument();
      expect(screen.getByText('Patient Data Privacy')).toBeInTheDocument();
      expect(screen.getByText('AI Training on Medical Data')).toBeInTheDocument();
    });
  });

  it('drill-down: shows back button', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInspireData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockDrillData,
      });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    await user.click(screen.getByText('The Future of AI in Healthcare'));

    await waitFor(() => {
      expect(screen.getByText('AI Diagnostic Tools')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Go back')).toBeInTheDocument();
  });

  it('drill-down: clicking back returns to sections view', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInspireData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockDrillData,
      });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    await user.click(screen.getByText('The Future of AI in Healthcare'));

    await waitFor(() => {
      expect(screen.getByText('AI Diagnostic Tools')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Go back'));

    await waitFor(() => {
      expect(screen.getByText('For You')).toBeInTheDocument();
      expect(screen.getByText('Trending on Sotto')).toBeInTheDocument();
      expect(screen.getByText('In the News')).toBeInTheDocument();
    });
  });

  it('drill-down: selecting subtopic calls onSelectTopic and onClose', async () => {
    const handleSelectTopic = vi.fn();
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInspireData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockDrillData,
      });

    render(<InspireMe open={true} onClose={handleClose} onSelectTopic={handleSelectTopic} />);

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    await user.click(screen.getByText('The Future of AI in Healthcare'));

    await waitFor(() => {
      expect(screen.getByText('AI Diagnostic Tools')).toBeInTheDocument();
    });

    await user.click(screen.getByText('AI Diagnostic Tools'));

    expect(handleSelectTopic).toHaveBeenCalledWith('AI Diagnostic Tools');
    expect(handleClose).toHaveBeenCalled();
  });

  it('empty state when no suggestions available', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        forYou: [],
        trending: [],
        inTheNews: [],
      }),
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'No suggestions available right now. Try describing your idea in the chat!'
        )
      ).toBeInTheDocument();
    });
  });

  it('drill-down: shows loading state while fetching subtopics', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInspireData,
      })
      .mockImplementationOnce(() => new Promise(() => {})); // Never resolves

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    await user.click(screen.getByText('The Future of AI in Healthcare'));

    await waitFor(() => {
      expect(screen.getByText('Finding specific topics...')).toBeInTheDocument();
    });
  });

  it('drill-down: clicking "In the News" card shows subtopics', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInspireData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockDrillData,
      });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Space Exploration Updates')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Space Exploration Updates'));

    await waitFor(() => {
      expect(screen.getByText('AI Diagnostic Tools')).toBeInTheDocument();
      expect(screen.getByText('Patient Data Privacy')).toBeInTheDocument();
    });
  });

  it('drill-down: shows empty state with "Use topic" button when no subtopics', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInspireData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subtopics: [] }),
      });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    await user.click(screen.getByText('The Future of AI in Healthcare'));

    await waitFor(() => {
      expect(
        screen.getByText('No subtopics found. Try tapping the topic above to use it directly.')
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Use \u201CThe Future of AI in Healthcare\u201D/)).toBeInTheDocument();
  });

  it('drill-down: clicking "Use topic" button calls onSelectTopic with parent title', async () => {
    const handleSelectTopic = vi.fn();
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInspireData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subtopics: [] }),
      });

    render(<InspireMe open={true} onClose={handleClose} onSelectTopic={handleSelectTopic} />);

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    await user.click(screen.getByText('The Future of AI in Healthcare'));

    await waitFor(() => {
      expect(
        screen.getByText(/Use \u201CThe Future of AI in Healthcare\u201D/)
      ).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Use \u201CThe Future of AI in Healthcare\u201D/));

    expect(handleSelectTopic).toHaveBeenCalledWith('The Future of AI in Healthcare');
    expect(handleClose).toHaveBeenCalled();
  });

  it('handles fetch error gracefully and shows empty sections', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'No suggestions available right now. Try describing your idea in the chat!'
        )
      ).toBeInTheDocument();
    });
  });

  it('handles drill-down fetch error gracefully', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInspireData,
      })
      .mockRejectedValueOnce(new Error('Network error'));

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    await user.click(screen.getByText('The Future of AI in Healthcare'));

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    expect(
      screen.getByText('No subtopics found. Try tapping the topic above to use it directly.')
    ).toBeInTheDocument();
  });

  it('shows cached data when closed and reopened', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockInspireData,
    });

    const { rerender } = render(
      <InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('For You')).toBeInTheDocument();
    });

    rerender(<InspireMe open={false} onClose={vi.fn()} onSelectTopic={vi.fn()} />);
    rerender(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('For You')).toBeInTheDocument();
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });
  });

  it('resets to sections view when closed and reopened', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInspireData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockDrillData,
      });

    const { rerender } = render(
      <InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    await user.click(screen.getByText('The Future of AI in Healthcare'));

    await waitFor(() => {
      expect(screen.getByText('AI Diagnostic Tools')).toBeInTheDocument();
    });

    rerender(<InspireMe open={false} onClose={vi.fn()} onSelectTopic={vi.fn()} />);
    rerender(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('For You')).toBeInTheDocument();
      expect(screen.queryByText('AI Diagnostic Tools')).not.toBeInTheDocument();
    });
  });

  it('renders with proper ARIA attributes', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockInspireData,
    });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Inspire Me' })).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('drill-down: displays parent title in context', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInspireData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockDrillData,
      });

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('The Future of AI in Healthcare')).toBeInTheDocument();
    });

    await user.click(screen.getByText('The Future of AI in Healthcare'));

    await waitFor(() => {
      const contexts = screen.getAllByText('The Future of AI in Healthcare');
      expect(contexts.length).toBeGreaterThan(0);
    });
  });
});
