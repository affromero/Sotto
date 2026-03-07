import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoView } from '@/components/player/VideoView';
import type { SegmentData } from '@/types/podcast';
import type { ReferenceData } from '@/types/reference';
import type { SegmentVisualData } from '@/lib/segment-utils';

const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockSeekTo = vi.fn();
let mockIsPlaying = false;

vi.mock('@/components/providers/AudioPlayerProvider', () => ({
  usePlayer: () => ({
    isPlaying: mockIsPlaying,
    currentTime: 0,
    duration: 100,
    isLoading: false,
    audioUrl: null,
    volume: 1,
    playbackRate: 1,
    podcastId: null,
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    skip: vi.fn(),
    setVolume: vi.fn(),
    setPlaybackRate: vi.fn(),
    loadPodcast: vi.fn(),
  }),
}));

vi.mock('@remotion/player', () => ({
  Player: vi.fn().mockImplementation(({ ref, ...props }) => {
    if (ref) {
      ref.current = { play: mockPlay, pause: mockPause, seekTo: mockSeekTo };
    }
    return <div data-testid="remotion-player" aria-label={props['aria-label']} />;
  }),
}));

const mockSegments: SegmentData[] = [
  { id: 'seg-1', speaker: 'HOST', text: 'Welcome to the show!', audioUrl: null, order: 0, startTime: 0, duration: 5 },
  { id: 'seg-2', speaker: 'EXPERT', text: 'Thanks for having me.', audioUrl: null, order: 1, startTime: 5, duration: 8 },
  { id: 'seg-3', speaker: 'HOST', text: 'Let us begin.', audioUrl: null, order: 2, startTime: 13, duration: 3 },
];

const mockVisuals: SegmentVisualData[] = [
  { segmentId: 'seg-1', visualType: 'TEXT_CARD', prompt: null, metadata: null, assetUrl: null, assetType: null, order: 0 },
  { segmentId: 'seg-2', visualType: 'IMAGE_SLIDE', prompt: 'expert photo', metadata: null, assetUrl: 'https://example.com/img.png', assetType: 'image/png', order: 1 },
  { segmentId: 'seg-3', visualType: 'TEXT_CARD', prompt: null, metadata: null, assetUrl: null, assetType: null, order: 2 },
];

const mockReferences: ReferenceData[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mockIsPlaying = false;
});

describe('VideoView', () => {
  it('renders Remotion Player with correct aria label', () => {
    render(
      <VideoView
        segments={mockSegments}
        segmentVisuals={mockVisuals}
        references={mockReferences}
        currentTime={0}
      />
    );

    expect(screen.getByTestId('remotion-player')).toBeInTheDocument();
    expect(screen.getByLabelText('Podcast video')).toBeInTheDocument();
  });

  it('shows current segment subtitle based on currentTime', () => {
    render(
      <VideoView
        segments={mockSegments}
        segmentVisuals={mockVisuals}
        references={mockReferences}
        currentTime={6}
      />
    );

    expect(screen.getByText('EXPERT')).toBeInTheDocument();
    expect(screen.getByText('Thanks for having me.')).toBeInTheDocument();
  });

  it('calls onSegmentClick when subtitle is clicked', () => {
    const onSegmentClick = vi.fn();
    render(
      <VideoView
        segments={mockSegments}
        segmentVisuals={mockVisuals}
        references={mockReferences}
        currentTime={6}
        onSegmentClick={onSegmentClick}
      />
    );

    fireEvent.click(screen.getByText('Thanks for having me.'));
    expect(onSegmentClick).toHaveBeenCalledWith(5);
  });

  it('handles empty segments array gracefully', () => {
    render(
      <VideoView
        segments={[]}
        segmentVisuals={[]}
        references={mockReferences}
        currentTime={0}
      />
    );

    expect(screen.getByLabelText('Video view')).toBeInTheDocument();
    expect(screen.getByTestId('remotion-player')).toBeInTheDocument();
  });

  it('calls player.play() when isPlaying and pause when not', () => {
    mockIsPlaying = true;
    const { rerender } = render(
      <VideoView
        segments={mockSegments}
        segmentVisuals={mockVisuals}
        references={mockReferences}
        currentTime={0}
      />
    );

    expect(mockPlay).toHaveBeenCalled();

    mockIsPlaying = false;
    mockPlay.mockClear();
    rerender(
      <VideoView
        segments={mockSegments}
        segmentVisuals={mockVisuals}
        references={mockReferences}
        currentTime={0}
      />
    );

    expect(mockPause).toHaveBeenCalled();
  });

  it('seeks Remotion player to correct frame when currentTime changes', () => {
    const { rerender } = render(
      <VideoView
        segments={mockSegments}
        segmentVisuals={mockVisuals}
        references={mockReferences}
        currentTime={0}
      />
    );

    rerender(
      <VideoView
        segments={mockSegments}
        segmentVisuals={mockVisuals}
        references={mockReferences}
        currentTime={10}
      />
    );

    // 10 seconds * 30 fps = frame 300
    expect(mockSeekTo).toHaveBeenCalledWith(300);
  });
});
