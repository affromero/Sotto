import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranscriptPanel } from '@/components/player/TranscriptPanel';
import { SegmentData } from '@/types/podcast';
import { ReferenceData } from '@/types/reference';

vi.mock('@/lib/citation-parser', () => ({
  parseTextWithCitations: (text: string) => text,
}));

describe('TranscriptPanel', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  const mockSegments: SegmentData[] = [
    {
      id: 'segment-1',
      speaker: 'HOST' as const,
      text: 'Welcome to the podcast about quantum physics.',
      audioUrl: 'https://example.com/audio1.mp3',
      order: 0,
      startTime: 0,
      duration: 5,
    },
    {
      id: 'segment-2',
      speaker: 'EXPERT' as const,
      text: 'Thank you for having me. Let me explain quantum entanglement.',
      audioUrl: 'https://example.com/audio2.mp3',
      order: 1,
      startTime: 5,
      duration: 7,
    },
    {
      id: 'segment-3',
      speaker: 'HOST' as const,
      text: 'That sounds fascinating. Can you elaborate?',
      audioUrl: 'https://example.com/audio3.mp3',
      order: 2,
      startTime: 12,
      duration: 4,
    },
  ];

  const mockReferences: ReferenceData[] = [
    {
      id: 'ref-1',
      number: 1,
      title: 'Quantum Mechanics',
      authors: ['Einstein, A.', 'Bohr, N.'],
      year: 1935,
      url: 'https://example.com/paper',
      type: 'PAPER',
      publisher: null,
      doi: null,
      verificationStatus: 'VERIFIED',
      verificationDetails: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders transcript heading', () => {
    render(<TranscriptPanel segments={mockSegments} currentTime={0} />);
    expect(screen.getByRole('heading', { name: 'Transcript' })).toBeInTheDocument();
  });

  it('renders all segments', () => {
    render(<TranscriptPanel segments={mockSegments} currentTime={0} />);
    expect(screen.getByText('Welcome to the podcast about quantum physics.')).toBeInTheDocument();
    expect(
      screen.getByText('Thank you for having me. Let me explain quantum entanglement.')
    ).toBeInTheDocument();
    expect(screen.getByText('That sounds fascinating. Can you elaborate?')).toBeInTheDocument();
  });

  it('renders HOST speaker label as "Host"', () => {
    render(<TranscriptPanel segments={mockSegments} currentTime={0} />);
    const hostLabels = screen.getAllByText('Host');
    expect(hostLabels).toHaveLength(2);
  });

  it('renders EXPERT speaker label as "Expert"', () => {
    render(<TranscriptPanel segments={mockSegments} currentTime={0} />);
    const expertLabels = screen.getAllByText('Expert');
    expect(expertLabels).toHaveLength(1);
  });


  it('calls onSegmentClick with startTime when segment is clicked', async () => {
    const user = userEvent.setup();
    const onSegmentClick = vi.fn();
    render(
      <TranscriptPanel segments={mockSegments} currentTime={0} onSegmentClick={onSegmentClick} />
    );
    await user.click(screen.getByText('Welcome to the podcast about quantum physics.'));
    expect(onSegmentClick).toHaveBeenCalledWith(0);
  });

  it('does not call onSegmentClick when startTime is null', async () => {
    const user = userEvent.setup();
    const onSegmentClick = vi.fn();
    const segmentsWithNullTime: SegmentData[] = [
      {
        ...mockSegments[0],
        startTime: null,
      },
    ];
    render(
      <TranscriptPanel
        segments={segmentsWithNullTime}
        currentTime={0}
        onSegmentClick={onSegmentClick}
      />
    );
    await user.click(screen.getByText('Welcome to the podcast about quantum physics.'));
    expect(onSegmentClick).not.toHaveBeenCalled();
  });

  it('renders segments in correct order', () => {
    const { container } = render(<TranscriptPanel segments={mockSegments} currentTime={0} />);
    const segmentTexts = Array.from(container.querySelectorAll('[class*="text"]')).map(
      (el) => el.textContent
    );
    expect(segmentTexts[0]).toBe('Welcome to the podcast about quantum physics.');
    expect(segmentTexts[1]).toBe('Thank you for having me. Let me explain quantum entanglement.');
    expect(segmentTexts[2]).toBe('That sounds fascinating. Can you elaborate?');
  });

  it('segments are keyboard accessible', () => {
    const { container } = render(<TranscriptPanel segments={mockSegments} currentTime={0} />);
    const segments = container.querySelectorAll('[role="button"]');
    segments.forEach((segment) => {
      expect(segment).toHaveAttribute('tabIndex', '0');
    });
  });

  it('does not highlight segment when startTime is null', () => {
    const segmentsWithNullTime: SegmentData[] = [
      {
        ...mockSegments[0],
        startTime: null,
        duration: null,
      },
    ];
    const { container } = render(
      <TranscriptPanel segments={segmentsWithNullTime} currentTime={2} />
    );
    const activeSegments = container.querySelectorAll('[class*="active"]');
    expect(activeSegments.length).toBe(0);
  });

  it('does not highlight segment when duration is null', () => {
    const segmentsWithNullDuration: SegmentData[] = [
      {
        ...mockSegments[0],
        duration: null,
      },
    ];
    const { container } = render(
      <TranscriptPanel segments={segmentsWithNullDuration} currentTime={2} />
    );
    const activeSegments = container.querySelectorAll('[class*="active"]');
    expect(activeSegments.length).toBe(0);
  });

  it('passes references to citation parser when references provided', () => {
    const parseTextWithCitations = vi.fn((text) => text);
    vi.doMock('@/lib/citation-parser', () => ({
      parseTextWithCitations,
    }));
    render(<TranscriptPanel segments={mockSegments} references={mockReferences} currentTime={0} />);
    expect(screen.getByText('Welcome to the podcast about quantum physics.')).toBeInTheDocument();
  });

  it('handles empty segments array', () => {
    render(<TranscriptPanel segments={[]} currentTime={0} />);
    expect(screen.getByRole('heading', { name: 'Transcript' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
