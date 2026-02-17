import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/components/providers/EventProvider', () => ({
  useTrack: () => vi.fn(),
}));

vi.mock('@/lib/podcast-gradient', () => ({
  getPodcastGradient: () => ({ from: '#000', to: '#fff', angle: '135deg' }),
}));

import { InspireMe } from '@/components/discovery/InspireMe';

const mockAllResponse = {
  forYou: [
    { id: 'fy1', text: 'AI meets Ancient History', topic: 'AI meets Ancient History', tagSlugs: ['ai', 'history'], category: 'Technology' },
    { id: 'fy2', text: 'Psychology of Music', topic: 'Psychology of Music', tagSlugs: ['psychology', 'music'], category: 'Science' },
  ],
  trending: [
    {
      id: 'pod-1',
      title: 'Top Podcast',
      topic: 'Quantum Computing',
      status: 'READY',
      visibility: 'PUBLIC',
      audioUrl: 'https://example.com/audio.mp3',
      duration: 300,
      playCount: 150,
      likeCount: 20,
      forkCount: 3,
      createdAt: '2026-02-15T00:00:00Z',
      source: 'WEB',
      isHumanContent: false,
      forkedFromId: null,
      user: { id: 'user-1', name: 'Test User', handle: null, image: null },
      tags: [{ id: 'tag-1', name: 'Tech', slug: 'tech' }],
    },
  ],
  news: [
    { id: 'n1', text: 'Breaking: Mars Rover Discovery', topic: 'Mars Rover Discovery', tagSlugs: ['science'], category: 'Science' },
  ],
};

/**
 * Create a mock fetch response that mimics the JSON path (all-cached).
 * The component checks content-type to decide between JSON and SSE parsing.
 */
function createJsonResponse(data: unknown, opts?: { ok?: boolean; status?: number }) {
  const ok = opts?.ok ?? true;
  const status = opts?.status ?? 200;
  return {
    ok,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
    text: async () => JSON.stringify(data),
    body: null,
  };
}

/**
 * Create a mock fetch response that mimics the SSE stream path.
 */
function createSseResponse(data: Record<string, unknown>) {
  let sseBody = '';
  if (data.trending !== undefined) sseBody += `data: ${JSON.stringify({ section: 'trending', data: data.trending })}\n\n`;
  if (data.forYou !== undefined) sseBody += `data: ${JSON.stringify({ section: 'forYou', data: data.forYou })}\n\n`;
  if (data.news !== undefined) sseBody += `data: ${JSON.stringify({ section: 'news', data: data.news })}\n\n`;
  sseBody += `data: ${JSON.stringify({ done: true })}\n\n`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseBody));
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    json: async () => { throw new Error('Not JSON'); },
    text: async () => sseBody,
    body: stream,
    getReader: () => stream.getReader(),
  };
}

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
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Inspire Me' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('renders section tabs', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'For You' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Trending' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'In the News' })).toBeInTheDocument();
  });

  it('fetches all tabs with a single API call on open', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/inspire/all',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('shows loading state while fetching', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    expect(screen.getByText('Finding ideas for you...')).toBeInTheDocument();
  });

  it('displays ForYou quiz questions once loaded (JSON path)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('AI meets Ancient History')).toBeInTheDocument();
    });
  });

  it('displays ForYou quiz questions once loaded (SSE path)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createSseResponse(mockAllResponse)
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('AI meets Ancient History')).toBeInTheDocument();
    });
  });

  it('tab switching renders correct content, trending tab does not re-fetch', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('AI meets Ancient History')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Trending' }));
    expect(screen.getByText('Top Podcast')).toBeInTheDocument();

    // Trending does not trigger a re-fetch — still just the initial one
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('trending tab shows "Make one like this" button', async () => {
    const handleSelectTopic = vi.fn();
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );

    render(
      <InspireMe open={true} onClose={handleClose} onSelectTopic={handleSelectTopic} />
    );

    await waitFor(() => {
      expect(screen.getByText('AI meets Ancient History')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Trending' }));

    const makeBtn = screen.getByLabelText('Make a podcast like Top Podcast');
    expect(makeBtn).toBeInTheDocument();

    await user.click(makeBtn);
    expect(handleSelectTopic).toHaveBeenCalledWith('Quantum Computing');
    expect(handleClose).toHaveBeenCalled();
  });

  it('clicking close button calls onClose', async () => {
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );

    render(<InspireMe open={true} onClose={handleClose} onSelectTopic={vi.fn()} />);

    await user.click(screen.getByLabelText('Close'));
    expect(handleClose).toHaveBeenCalled();
  });

  it('clicking backdrop calls onClose', async () => {
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );

    render(<InspireMe open={true} onClose={handleClose} onSelectTopic={vi.fn()} />);

    const backdrop = document.querySelector('[class*="backdrop"]');
    expect(backdrop).toBeInTheDocument();

    if (backdrop) {
      await user.click(backdrop);
      expect(handleClose).toHaveBeenCalled();
    }
  });

  it('clicking "Make" calls onSelectTopic and closes overlay', async () => {
    const handleSelectTopic = vi.fn();
    const handleClose = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );

    render(
      <InspireMe open={true} onClose={handleClose} onSelectTopic={handleSelectTopic} />
    );

    await waitFor(() => {
      expect(screen.getByText('AI meets Ancient History')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Make podcast: AI meets Ancient History'));

    expect(handleSelectTopic).toHaveBeenCalledWith('AI meets Ancient History');
    expect(handleClose).toHaveBeenCalled();
  });

  it('shows generate button when no ForYou questions returned', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse({ forYou: [], trending: [], news: [] })
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Generate ideas')).toBeInTheDocument();
    });
  });

  it('handles fetch error gracefully with retry button', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse({ error: 'Server error' }, { ok: false, status: 500 })
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText('Something went wrong. Please try again.')
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('renders topic input field', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    const input = screen.getByPlaceholderText(/Focus on/);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('maxLength', '50');
  });

  it('submitting a topic re-fetches with topic param', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );
    global.fetch = fetchMock;

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inspire/all',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    const input = screen.getByPlaceholderText(/Focus on/);
    await user.type(input, 'politics');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inspire/all?topic=politics',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  it('shows topic-specific loading message', async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: unknown) => void;
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => firstPromise)
      .mockImplementation(() => new Promise(() => {})); // Never resolves for second call

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    resolveFirst(createJsonResponse(mockAllResponse));

    await waitFor(() => {
      expect(screen.getByText('AI meets Ancient History')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Focus on/);
    await user.type(input, 'AI');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/Finding ideas about "AI"/)).toBeInTheDocument();
    });
  });

  it('clearing topic re-fetches without topic param', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(mockAllResponse)
    );
    global.fetch = fetchMock;

    render(<InspireMe open={true} onClose={vi.fn()} onSelectTopic={vi.fn()} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inspire/all',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    const input = screen.getByPlaceholderText(/Focus on/);
    await user.type(input, 'europe');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inspire/all?topic=europe',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    const clearBtn = screen.getByLabelText('Clear topic filter');
    await user.click(clearBtn);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(calls.filter((url) => url === '/api/inspire/all').length).toBeGreaterThanOrEqual(2);
    });
  });
});
