import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/providers/EventProvider', () => ({
  useTrack: () => vi.fn(),
}));

vi.mock('@/lib/podcast-gradient', () => ({
  getPodcastGradient: () => ({ from: '#000', to: '#fff', angle: '135deg' }),
}));

const mockUseAuth = vi.fn(() => ({
  user: { id: 'user-1' },
  isAuthenticated: true,
  isLoading: false,
}));
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

import { PodcastCard } from '@/components/feed/PodcastCard';
import type { PodcastSummary } from '@/types/podcast';

const mockPodcast: PodcastSummary = {
  id: 'podcast-1',
  title: 'Introduction to Quantum Computing',
  topic: 'A deep dive into quantum mechanics and computing applications',
  duration: 600,
  audioUrl: 'https://example.com/audio.mp3',
  playCount: 1250,
  visibility: 'PUBLIC',
  status: 'READY',
  createdAt: '2026-02-08T10:00:00Z',
  source: 'WEB' as const,
  isHumanContent: false,
  ownerIsPro: true,
  user: {
    id: 'user-1',
    name: 'Jane Smith',
    image: 'https://example.com/avatar.jpg',
    handle: null,
  },
  tags: [
    { id: 'tag-1', name: 'Science', slug: 'science' },
    { id: 'tag-2', name: 'Technology', slug: 'technology' },
  ],
};

describe('PodcastCard', () => {
  it('renders podcast title', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.getByText('Introduction to Quantum Computing')).toBeInTheDocument();
  });

  it('renders podcast topic', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(
      screen.getByText('A deep dive into quantum mechanics and computing applications')
    ).toBeInTheDocument();
  });

  it('formats and displays duration', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.getByText('10 min')).toBeInTheDocument();
  });

  it('displays play count for Pro owner', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.getByLabelText('1250 plays')).toBeInTheDocument();
  });

  it('formats large play counts with M suffix', () => {
    const popularPodcast = { ...mockPodcast, playCount: 2500000 };
    render(<PodcastCard podcast={popularPodcast} />);
    expect(screen.getByLabelText('2500000 plays')).toBeInTheDocument();
  });

  it('renders tags as cover overlays', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.getByText('Science')).toBeInTheDocument();
    expect(screen.getByText('Technology')).toBeInTheDocument();
  });

  it('does not render tags section when no tags', () => {
    const podcastNoTags = { ...mockPodcast, tags: [] };
    render(<PodcastCard podcast={podcastNoTags} />);
    expect(screen.queryByLabelText('Tags')).not.toBeInTheDocument();
  });

  it('links to podcast detail page', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    const link = screen.getByRole('link', {
      name: 'Listen to Introduction to Quantum Computing',
    });
    expect(link).toHaveAttribute('href', '/podcast/podcast-1');
  });

  it('has accessible link label without creator identity', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(
      screen.getByRole('link', {
        name: 'Listen to Introduction to Quantum Computing',
      })
    ).toBeInTheDocument();
  });

  it('renders date on card', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const recentPodcast = {
      ...mockPodcast,
      createdAt: yesterday.toISOString(),
    };
    render(<PodcastCard podcast={recentPodcast} />);
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('renders play button when onPlay callback provided', () => {
    const handlePlay = vi.fn();
    render(<PodcastCard podcast={mockPodcast} onPlay={handlePlay} />);
    expect(screen.getByLabelText('Play Introduction to Quantum Computing')).toBeInTheDocument();
  });

  it('does not render play button when no onPlay callback', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.queryByLabelText(/^Play /)).not.toBeInTheDocument();
  });

  it('calls onPlay with podcast id when play button clicked', async () => {
    const handlePlay = vi.fn();
    const user = userEvent.setup();
    render(<PodcastCard podcast={mockPodcast} onPlay={handlePlay} />);

    await user.click(screen.getByLabelText('Play Introduction to Quantum Computing'));
    expect(handlePlay).toHaveBeenCalledWith('podcast-1');
  });

  it('does not render play button when no audioUrl', () => {
    const handlePlay = vi.fn();
    const podcastNoAudio = { ...mockPodcast, audioUrl: null };
    render(<PodcastCard podcast={podcastNoAudio} onPlay={handlePlay} />);
    expect(screen.queryByLabelText(/^Play /)).not.toBeInTheDocument();
  });

  it('hides stats for non-owners', () => {
    mockUseAuth.mockReturnValueOnce({
      user: { id: 'other-user' },
      isAuthenticated: true,
      isLoading: false,
    });
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.queryByLabelText('1250 plays')).not.toBeInTheDocument();
  });

  it('hides stats for free owner viewing own podcast', () => {
    const freePodcast = { ...mockPodcast, ownerIsPro: false };
    render(<PodcastCard podcast={freePodcast} />);
    expect(screen.queryByLabelText('1250 plays')).not.toBeInTheDocument();
  });

  it('shows private playback stats for Pro owner viewing own podcast', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.getByLabelText('1250 plays')).toBeInTheDocument();
    expect(screen.queryByLabelText(/likes/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/forks/i)).not.toBeInTheDocument();
  });

  it("hides stats for Pro owner viewing someone else's podcast", () => {
    mockUseAuth.mockReturnValueOnce({
      user: { id: 'other-user' },
      isAuthenticated: true,
      isLoading: false,
    });
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.queryByLabelText('1250 plays')).not.toBeInTheDocument();
  });

  it('does not render social controls', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.queryByRole('button', { name: /Like/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Follow/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Original Podcast/)).not.toBeInTheDocument();
  });
});
