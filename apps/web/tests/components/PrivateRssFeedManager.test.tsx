import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateRssFeedManager } from '@/components/settings/PrivateRssFeedManager';

const fetchMock = vi.fn();
const writeTextMock = vi.fn();

const initialTokens = [
  {
    id: 'feed-token-1',
    name: 'Daily Briefings',
    feedType: 'all',
    createdAt: '2026-05-15T10:00:00.000Z',
    lastUsedAt: null,
  },
];

describe('PrivateRssFeedManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  it('renders existing private feed token metadata without exposing a raw URL', () => {
    render(<PrivateRssFeedManager initialTokens={initialTokens} />);

    expect(screen.getByText('Private Podcast Feed')).toBeInTheDocument();
    expect(screen.getByText('Daily Briefings')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/api\/rss\/private/)).not.toBeInTheDocument();
  });

  it('creates a private feed URL and copies the one-time URL', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'feed-token-2',
        token: 'raw-token',
        feedUrl: 'https://sotto.test/api/rss/private/raw-token',
      }),
    });
    writeTextMock.mockResolvedValueOnce(undefined);

    render(<PrivateRssFeedManager initialTokens={[]} />);

    await user.type(screen.getByLabelText('Feed name'), 'Board Updates');
    await user.click(screen.getByRole('button', { name: 'Create Feed URL' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/rss/private', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Board Updates' }),
    });
    expect(
      await screen.findByDisplayValue('https://sotto.test/api/rss/private/raw-token')
    ).toBeInTheDocument();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('https://sotto.test/api/rss/private/raw-token');
    });
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('revokes an active private feed token and removes it from the list', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: true });

    render(<PrivateRssFeedManager initialTokens={initialTokens} />);

    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/rss/private/tokens/feed-token-1', {
      method: 'DELETE',
    });
    await waitFor(() => {
      expect(screen.queryByText('Daily Briefings')).not.toBeInTheDocument();
    });
    expect(screen.getByText('No private feed URLs yet.')).toBeInTheDocument();
  });
});
