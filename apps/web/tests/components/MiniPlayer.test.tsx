import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MiniPlayer } from '@/components/player/MiniPlayer';
import * as AudioPlayerProvider from '@/components/providers/AudioPlayerProvider';

vi.mock('@/components/providers/AudioPlayerProvider');

describe('MiniPlayer', () => {
  const mockPlayer = {
    podcastId: 'test-podcast-id',
    podcastTitle: 'Test Podcast',
    audioUrl: 'https://example.com/audio.mp3',
    isPlaying: true,
    currentTime: 45,
    duration: 180,
    playbackRate: 1,
    volume: 0.8,
    isMuted: false,
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    seek: vi.fn(),
    skip: vi.fn(),
    setPlaybackRate: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    loadPodcast: vi.fn(),
    clearPodcast: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when player is null', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(null as any);
    const { container } = render(<MiniPlayer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when podcastId is null', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      podcastId: null,
    });
    const { container } = render(<MiniPlayer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders mini player when podcast is loaded', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<MiniPlayer podcastTitle="Test Podcast" />);
    expect(screen.getByText('Test Podcast')).toBeInTheDocument();
  });

  it('displays default title when no podcastTitle provided', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<MiniPlayer />);
    expect(screen.getByText('Now Playing')).toBeInTheDocument();
  });

  it('displays first letter of podcast title in artwork', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<MiniPlayer podcastTitle="Test Podcast" />);
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  it('displays P in artwork when no title provided', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<MiniPlayer />);
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('shows pause button when playing', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      isPlaying: true,
    });
    render(<MiniPlayer />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('shows play button when paused', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      isPlaying: false,
    });
    render(<MiniPlayer />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('calls toggle when play button is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<MiniPlayer />);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(mockPlayer.toggle).toHaveBeenCalled();
  });

  it('calls onExpand when artwork is clicked', async () => {
    const user = userEvent.setup();
    const onExpand = vi.fn();
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<MiniPlayer onExpand={onExpand} />);
    await user.click(screen.getByRole('button', { name: 'Expand player' }));
    expect(onExpand).toHaveBeenCalled();
  });

  it('calls onExpand when info section is clicked', async () => {
    const user = userEvent.setup();
    const onExpand = vi.fn();
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<MiniPlayer podcastTitle="Test Podcast" onExpand={onExpand} />);
    await user.click(screen.getByText('Test Podcast'));
    expect(onExpand).toHaveBeenCalled();
  });

  it('renders close button when onClose is provided', () => {
    const onClose = vi.fn();
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<MiniPlayer onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Close player' })).toBeInTheDocument();
  });

  it('does not render close button when onClose is not provided', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<MiniPlayer />);
    expect(screen.queryByRole('button', { name: 'Close player' })).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<MiniPlayer onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Close player' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('displays progress line with correct width', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      currentTime: 90,
      duration: 180,
    });
    const { container } = render(<MiniPlayer />);
    const progressLine = container.querySelector('[class*="progressLine"]');
    expect(progressLine).toHaveStyle({ width: '50%' });
  });

  it('shows zero progress when duration is zero', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      currentTime: 0,
      duration: 0,
    });
    const { container } = render(<MiniPlayer />);
    const progressLine = container.querySelector('[class*="progressLine"]');
    expect(progressLine).toHaveStyle({ width: '0%' });
  });

  it('capitalizes first letter of lowercase title', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<MiniPlayer podcastTitle="quantum physics" />);
    expect(screen.getByText('Q')).toBeInTheDocument();
  });
});
