import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PodcastCard } from '@/components/feed/PodcastCard';
import type { PodcastSummary } from '@/types/podcast';

const mockPodcast: PodcastSummary = {
  id: 'podcast-1',
  title: 'Introduction to Quantum Computing',
  topic: 'A deep dive into quantum mechanics and computing applications',
  duration: 600,
  audioUrl: 'https://example.com/audio.mp3',
  playCount: 1250,
  likeCount: 89,
  forkCount: 12,
  visibility: 'PUBLIC',
  status: 'READY',
  createdAt: '2026-02-08T10:00:00Z',
  user: {
    id: 'user-1',
    name: 'Jane Smith',
    image: 'https://example.com/avatar.jpg',
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

  it('renders creator name', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('renders creator avatar image when provided', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    const avatar = screen.getByAltText('Jane Smith');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', expect.stringContaining('avatar.jpg'));
  });

  it('renders fallback initials when no avatar image', () => {
    const podcastNoImage = {
      ...mockPodcast,
      user: { ...mockPodcast.user, image: null },
    };
    render(<PodcastCard podcast={podcastNoImage} />);
    expect(screen.getByText('J')).toBeInTheDocument();
  });

  it('formats and displays duration', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.getByText('10 min')).toBeInTheDocument();
  });

  it('displays play count with proper formatting', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.getByText('1.3K')).toBeInTheDocument();
  });

  it('displays like count', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.getByLabelText('89 likes')).toBeInTheDocument();
  });

  it('displays fork count', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(screen.getByLabelText('12 forks')).toBeInTheDocument();
  });

  it('formats large play counts with M suffix', () => {
    const popularPodcast = { ...mockPodcast, playCount: 2500000 };
    render(<PodcastCard podcast={popularPodcast} />);
    expect(screen.getByText('2.5M')).toBeInTheDocument();
  });

  it('renders all tags', () => {
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
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/podcast/podcast-1');
  });

  it('has accessible link label with title and creator', () => {
    render(<PodcastCard podcast={mockPodcast} />);
    expect(
      screen.getByRole('link', {
        name: 'Listen to Introduction to Quantum Computing by Jane Smith',
      })
    ).toBeInTheDocument();
  });

  it('displays relative date for recent podcasts', () => {
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

  it('displays Anonymous for user without name', () => {
    const podcastNoName = {
      ...mockPodcast,
      user: { ...mockPodcast.user, name: null },
    };
    render(<PodcastCard podcast={podcastNoName} />);
    expect(screen.getByText('Anonymous')).toBeInTheDocument();
  });

  it('uses question mark fallback for anonymous user avatar', () => {
    const podcastAnon = {
      ...mockPodcast,
      user: { ...mockPodcast.user, name: null, image: null },
    };
    render(<PodcastCard podcast={podcastAnon} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});
