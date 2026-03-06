import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoView } from '@/components/player/VideoView';
import type { SegmentData } from '@/types/podcast';
import type { ReferenceData } from '@/types/reference';

const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();
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

const mockSegments: SegmentData[] = [
  { id: 'seg-1', speaker: 'HOST', text: 'Welcome to the show!', audioUrl: null, order: 0, startTime: 0, duration: 5 },
  { id: 'seg-2', speaker: 'EXPERT', text: 'Thanks for having me.', audioUrl: null, order: 1, startTime: 5, duration: 8 },
  { id: 'seg-3', speaker: 'HOST', text: 'Let us begin.', audioUrl: null, order: 2, startTime: 13, duration: 3 },
];

const mockReferences: ReferenceData[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mockIsPlaying = false;
  // Mock HTMLMediaElement methods
  HTMLMediaElement.prototype.play = mockPlay;
  HTMLMediaElement.prototype.pause = mockPause;
});

describe('VideoView', () => {
  it('renders video element with correct src and muted attribute', () => {
    render(
      <VideoView
        videoUrl="https://example.com/video.mp4"
        segments={mockSegments}
        references={mockReferences}
        currentTime={0}
      />
    );

    const video = screen.getByLabelText('Podcast video') as HTMLVideoElement;
    expect(video).toBeInTheDocument();
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('src', 'https://example.com/video.mp4');
    expect(video.muted).toBe(true);
  });

  it('shows current segment subtitle based on currentTime', () => {
    render(
      <VideoView
        videoUrl="https://example.com/video.mp4"
        segments={mockSegments}
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
        videoUrl="https://example.com/video.mp4"
        segments={mockSegments}
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
        videoUrl="https://example.com/video.mp4"
        segments={[]}
        references={mockReferences}
        currentTime={0}
      />
    );

    expect(screen.getByLabelText('Video view')).toBeInTheDocument();
    expect(screen.getByLabelText('Podcast video')).toBeInTheDocument();
  });

  it('calls video.play() when isPlaying is true and pause when false', () => {
    mockIsPlaying = true;
    const { rerender } = render(
      <VideoView
        videoUrl="https://example.com/video.mp4"
        segments={mockSegments}
        references={mockReferences}
        currentTime={0}
      />
    );

    expect(mockPlay).toHaveBeenCalled();

    mockIsPlaying = false;
    mockPlay.mockClear();
    rerender(
      <VideoView
        videoUrl="https://example.com/video.mp4"
        segments={mockSegments}
        references={mockReferences}
        currentTime={0}
      />
    );

    expect(mockPause).toHaveBeenCalled();
  });
});
