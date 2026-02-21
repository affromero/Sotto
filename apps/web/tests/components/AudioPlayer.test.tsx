import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AudioPlayer } from '@/components/player/AudioPlayer';
import * as AudioPlayerProvider from '@/components/providers/AudioPlayerProvider';

vi.mock('@/components/providers/AudioPlayerProvider');
vi.mock('@/components/player/PlaybackControls', () => ({
  PlaybackControls: () => <div data-testid="playback-controls">Playback Controls</div>,
}));

describe('AudioPlayer', () => {
  const mockPlayer = {
    podcastId: 'test-podcast-id',
    podcastTitle: 'Test Podcast',
    audioUrl: 'https://example.com/audio.mp3',
    isPlaying: false,
    currentTime: 30,
    duration: 180,
    playbackRate: 1,
    volume: 0.8,
    isMuted: false,
    activeVoiceTrackId: null,
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
    const { container } = render(<AudioPlayer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when podcastId is null', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      podcastId: null,
    });
    const { container } = render(<AudioPlayer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders player when podcastId is present', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<AudioPlayer />);
    expect(screen.getByRole('slider', { name: 'Playback progress' })).toBeInTheDocument();
  });

  it('displays current time correctly formatted', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      currentTime: 125,
    });
    render(<AudioPlayer />);
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('displays duration correctly formatted', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      duration: 245,
    });
    render(<AudioPlayer />);
    expect(screen.getByText('4:05')).toBeInTheDocument();
  });

  it('formats time with leading zero for seconds', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      currentTime: 5,
      duration: 180,
    });
    render(<AudioPlayer />);
    expect(screen.getByText('0:05')).toBeInTheDocument();
  });

  it('renders progress bar with correct aria attributes', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      currentTime: 60,
      duration: 180,
    });
    render(<AudioPlayer />);
    const progressBar = screen.getByRole('slider', { name: 'Playback progress' });
    expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    expect(progressBar).toHaveAttribute('aria-valuemax', '180');
    expect(progressBar).toHaveAttribute('aria-valuenow', '60');
  });

  it('handles progress bar click to seek', async () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<AudioPlayer />);

    const progressBar = screen.getByRole('slider', { name: 'Playback progress' });

    vi.spyOn(progressBar, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 400,
      top: 0,
      bottom: 0,
      right: 500,
      x: 100,
      y: 0,
      height: 20,
      toJSON: () => {},
    } as DOMRect);

    progressBar.click();
    progressBar.dispatchEvent(new MouseEvent('click', { clientX: 300, bubbles: true }));
    expect(mockPlayer.seek).toHaveBeenCalled();
  });

  it('shows zero progress when duration is zero', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      currentTime: 0,
      duration: 0,
    });
    render(<AudioPlayer />);
    const slider = screen.getByRole('slider', { name: 'Playback progress' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '0');
  });

  it('progress bar is keyboard accessible', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<AudioPlayer />);
    const progressBar = screen.getByRole('slider', { name: 'Playback progress' });
    // The slider role already implies keyboard interaction; verify it's not removed from tab order
    expect(progressBar.tabIndex).not.toBe(-1);
  });

  it('displays correct time format for longer durations', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      currentTime: 3665,
      duration: 7200,
    });
    render(<AudioPlayer />);
    expect(screen.getByText('61:05')).toBeInTheDocument();
    expect(screen.getByText('120:00')).toBeInTheDocument();
  });
});
