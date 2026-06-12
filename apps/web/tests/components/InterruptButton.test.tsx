import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InterruptButton } from '@/components/player/InterruptButton';
import * as AudioPlayerProvider from '@/components/providers/AudioPlayerProvider';

vi.mock('@/components/providers/AudioPlayerProvider');

describe('InterruptButton', () => {
  const mockPlayer = {
    episodeId: 'test-episode-id',
    episodeTitle: 'Test Episode',
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
    loadEpisode: vi.fn(),
    clearEpisode: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders button with "Ask a Question" text', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    const onInterrupt = vi.fn();
    render(<InterruptButton onInterrupt={onInterrupt} />);
    expect(screen.getByText('Ask a Question')).toBeInTheDocument();
  });

  it('renders button with correct aria label', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    const onInterrupt = vi.fn();
    render(<InterruptButton onInterrupt={onInterrupt} />);
    expect(screen.getByRole('button', { name: 'Ask a question' })).toBeInTheDocument();
  });

  it('is disabled when episodeId is null', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      episodeId: null,
    });
    const onInterrupt = vi.fn();
    render(<InterruptButton onInterrupt={onInterrupt} />);
    expect(screen.getByRole('button', { name: 'Ask a question' })).toBeDisabled();
  });

  it('is not disabled when episodeId is present', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    const onInterrupt = vi.fn();
    render(<InterruptButton onInterrupt={onInterrupt} />);
    expect(screen.getByRole('button', { name: 'Ask a question' })).not.toBeDisabled();
  });

  it('calls onInterrupt when clicked', async () => {
    const user = userEvent.setup();
    const onInterrupt = vi.fn();
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(mockPlayer);
    render(<InterruptButton onInterrupt={onInterrupt} />);
    await user.click(screen.getByRole('button', { name: 'Ask a question' }));
    expect(onInterrupt).toHaveBeenCalled();
  });

  it('pauses player when clicked and playing', async () => {
    const user = userEvent.setup();
    const onInterrupt = vi.fn();
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      isPlaying: true,
    });
    render(<InterruptButton onInterrupt={onInterrupt} />);
    await user.click(screen.getByRole('button', { name: 'Ask a question' }));
    expect(mockPlayer.pause).toHaveBeenCalled();
  });

  it('does not pause player when clicked and already paused', async () => {
    const user = userEvent.setup();
    const onInterrupt = vi.fn();
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      isPlaying: false,
    });
    render(<InterruptButton onInterrupt={onInterrupt} />);
    await user.click(screen.getByRole('button', { name: 'Ask a question' }));
    expect(mockPlayer.pause).not.toHaveBeenCalled();
  });

  it('handles null player gracefully', () => {
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue(null as any);
    const onInterrupt = vi.fn();
    render(<InterruptButton onInterrupt={onInterrupt} />);
    const button = screen.getByRole('button', { name: 'Ask a question' });
    expect(button).toBeDisabled();
  });

  it('does not call onInterrupt when disabled', async () => {
    const user = userEvent.setup();
    const onInterrupt = vi.fn();
    vi.mocked(AudioPlayerProvider.usePlayer).mockReturnValue({
      ...mockPlayer,
      episodeId: null,
    });
    render(<InterruptButton onInterrupt={onInterrupt} />);
    await user.click(screen.getByRole('button', { name: 'Ask a question' }));
    expect(onInterrupt).not.toHaveBeenCalled();
  });
});
