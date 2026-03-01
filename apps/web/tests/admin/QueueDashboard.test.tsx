import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/(admin)/admin/queues/QueueActions', () => ({
  QueueActions: ({ queueName, failedCount }: { queueName: string; failedCount: number }) => (
    <div data-testid={`actions-${queueName}`}>Failed: {failedCount}</div>
  ),
}));

import { QueueDashboard } from '@/app/(admin)/admin/queues/QueueDashboard';

const mockQueues = {
  'content-extraction': { waiting: 3, active: 1, completed: 100, failed: 0, delayed: 0 },
  'script-generation': { waiting: 0, active: 0, completed: 50, failed: 2, delayed: 0 },
  'audio-generation': { waiting: 0, active: 2, completed: 200, failed: 0, delayed: 1 },
  'notifications': { waiting: 0, active: 0, completed: 500, failed: 0, delayed: 0 },
  'voice-verification': { waiting: 1, active: 0, completed: 10, failed: 5, delayed: 0 },
};

function mockFetchSuccess(data = mockQueues) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({ queues: data }),
  });
}

function mockFetchFailure() {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => ({}),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('QueueDashboard', () => {
  it('shows loading state before data arrives', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<QueueDashboard />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders all queue names after fetch', async () => {
    mockFetchSuccess();
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });
    expect(screen.getByText('script-generation')).toBeInTheDocument();
    expect(screen.getByText('audio-generation')).toBeInTheDocument();
    expect(screen.getByText('notifications')).toBeInTheDocument();
    expect(screen.getByText('voice-verification')).toBeInTheDocument();
  });

  it('displays summary card totals', async () => {
    mockFetchSuccess();
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    // Scope to the summary cards container to avoid collisions with filter chips
    const summarySection = screen.getByText('Total Queues').closest('div[class*="summary"]') as HTMLElement;
    const cards = within(summarySection);

    function cardValue(label: string): string {
      const labelEl = cards.getByText(label);
      const card = labelEl.closest('div[class*="card"]') as HTMLElement;
      return within(card).getByText(/^\d+$/).textContent!;
    }

    expect(cardValue('Total Queues')).toBe('5');
    expect(cardValue('Active')).toBe('3');    // 1 + 0 + 2 + 0 + 0
    expect(cardValue('Waiting')).toBe('4');   // 3 + 0 + 0 + 0 + 1
    expect(cardValue('Failed')).toBe('7');    // 0 + 2 + 0 + 0 + 5
    expect(cardValue('Delayed')).toBe('1');   // 0 + 0 + 1 + 0 + 0
  });

  it('shows error banner on fetch failure', async () => {
    mockFetchFailure();
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
  });

  it('filters queues by search text matching name', async () => {
    mockFetchSuccess();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search queues...');
    await user.type(searchInput, 'script');

    expect(screen.getByText('script-generation')).toBeInTheDocument();
    expect(screen.queryByText('content-extraction')).not.toBeInTheDocument();
    expect(screen.queryByText('notifications')).not.toBeInTheDocument();
  });

  it('filters queues by search text matching description', async () => {
    mockFetchSuccess();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search queues...');
    await user.type(searchInput, 'push notifications');

    expect(screen.getByText('notifications')).toBeInTheDocument();
    expect(screen.queryByText('content-extraction')).not.toBeInTheDocument();
  });

  it('filters by Failed status chip', async () => {
    mockFetchSuccess();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Failed' }));

    // Only queues with failed > 0: script-generation (2), voice-verification (5)
    expect(screen.getByText('script-generation')).toBeInTheDocument();
    expect(screen.getByText('voice-verification')).toBeInTheDocument();
    expect(screen.queryByText('content-extraction')).not.toBeInTheDocument();
    expect(screen.queryByText('notifications')).not.toBeInTheDocument();
  });

  it('filters by Active status chip', async () => {
    mockFetchSuccess();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Active' }));

    // Only queues with active > 0: content-extraction (1), audio-generation (2)
    expect(screen.getByText('content-extraction')).toBeInTheDocument();
    expect(screen.getByText('audio-generation')).toBeInTheDocument();
    expect(screen.queryByText('notifications')).not.toBeInTheDocument();
  });

  it('filters by Idle status chip', async () => {
    mockFetchSuccess();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Idle' }));

    // Idle = active === 0 && waiting === 0: script-generation, notifications
    expect(screen.getByText('script-generation')).toBeInTheDocument();
    expect(screen.getByText('notifications')).toBeInTheDocument();
    expect(screen.queryByText('content-extraction')).not.toBeInTheDocument();
    expect(screen.queryByText('audio-generation')).not.toBeInTheDocument();
  });

  it('shows grouped view by default with stage headers', async () => {
    mockFetchSuccess();
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    expect(screen.getByText('Content Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Audio Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Platform Ops')).toBeInTheDocument();
    expect(screen.getByText('Voice Features')).toBeInTheDocument();
  });

  it('toggles to flat view and removes stage headers', async () => {
    mockFetchSuccess();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Flat View' }));

    // Stage headers should be gone
    expect(screen.queryByText('Content Pipeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Audio Pipeline')).not.toBeInTheDocument();
    // But queue names should still be visible
    expect(screen.getByText('content-extraction')).toBeInTheDocument();
    expect(screen.getByText('audio-generation')).toBeInTheDocument();
  });

  it('sorts by column when header is clicked', async () => {
    mockFetchSuccess();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    // Switch to flat view first for a single table
    await user.click(screen.getByRole('button', { name: 'Flat View' }));

    // Click "Failed" column header to sort by failed (desc first)
    const failedHeaders = screen.getAllByRole('button', { name: /Failed/ });
    // Find the sort button (not the filter chip) — sort buttons contain the indicator character
    const sortButton = failedHeaders.find((btn) => btn.textContent?.includes('\u21C5') || btn.textContent?.includes('\u2193') || btn.textContent?.includes('\u2191'));
    expect(sortButton).toBeDefined();
    await user.click(sortButton!);

    // After sorting by failed desc, voice-verification (5) should be first
    const rows = screen.getAllByRole('row');
    // First data row (index 1, after header)
    const firstDataRow = rows[1];
    expect(within(firstDataRow).getByText('voice-verification')).toBeInTheDocument();
  });

  it('renders QueueActions for queues with failures', async () => {
    mockFetchSuccess();
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    // script-generation has 2 failed, voice-verification has 5 failed
    expect(screen.getByTestId('actions-script-generation')).toBeInTheDocument();
    expect(screen.getByTestId('actions-voice-verification')).toBeInTheDocument();
    // content-extraction has 0 failed — no actions
    expect(screen.queryByTestId('actions-content-extraction')).not.toBeInTheDocument();
  });

  it('shows descriptions from metadata', async () => {
    mockFetchSuccess();
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    expect(screen.getByText('Extracts text from URLs, PDFs, and uploaded files')).toBeInTheDocument();
    expect(screen.getByText('Sends push notifications to user devices')).toBeInTheDocument();
  });

  it('shows empty state when filters match nothing', async () => {
    mockFetchSuccess();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search queues...');
    await user.type(searchInput, 'nonexistent-queue-xyz');

    expect(screen.getByText('No queues match your filters.')).toBeInTheDocument();
  });

  it('auto-refresh fetches data every 10 seconds', async () => {
    mockFetchSuccess();
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    // Initial fetch
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Advance 10 seconds — should trigger another fetch
    vi.advanceTimersByTime(10_000);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('stops polling when auto-refresh is toggled off', async () => {
    mockFetchSuccess();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<QueueDashboard />);
    await waitFor(() => {
      expect(screen.getByText('content-extraction')).toBeInTheDocument();
    });

    // Uncheck auto-refresh
    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);

    const callsAfterToggle = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    // Advance 20 seconds — no new fetches should happen
    vi.advanceTimersByTime(20_000);
    expect(global.fetch).toHaveBeenCalledTimes(callsAfterToggle);
  });
});
