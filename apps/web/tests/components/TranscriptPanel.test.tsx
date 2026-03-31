import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranscriptPanel } from '@/components/player/TranscriptPanel';
import { SegmentData } from '@/types/podcast';

vi.mock('@/lib/citation-parser', () => ({
  parseTextWithCitations: (text: string) => text,
}));

vi.mock('@/components/providers/AudioPlayerProvider', () => ({
  AudioPlayerContext: React.createContext(null),
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

  it('renders speaker labels matching segment data', () => {
    render(<TranscriptPanel segments={mockSegments} currentTime={0} />);
    const hostLabels = screen.getAllByText('HOST');
    expect(hostLabels).toHaveLength(2);
    const expertLabels = screen.getAllByText('EXPERT');
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
    const buttons = container.querySelectorAll('[role="button"]');
    const segmentTexts = Array.from(buttons).map((el) => el.textContent);
    expect(segmentTexts[0]).toContain('Welcome to the podcast about quantum physics.');
    expect(segmentTexts[1]).toContain('Thank you for having me. Let me explain quantum entanglement.');
    expect(segmentTexts[2]).toContain('That sounds fascinating. Can you elaborate?');
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
    // Active state has no accessible attribute — CSS class query is the only option
    const activeSegments = container.querySelectorAll('[class*="active"]');
    expect(activeSegments).toHaveLength(0);
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
    // Active state has no accessible attribute — CSS class query is the only option
    const activeSegments = container.querySelectorAll('[class*="active"]');
    expect(activeSegments).toHaveLength(0);
  });

  it('handles empty segments array', () => {
    render(<TranscriptPanel segments={[]} currentTime={0} />);
    expect(screen.getByRole('heading', { name: 'Transcript' })).toBeInTheDocument();
    // Only the two text-size control buttons should exist — no segment rows
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(screen.getByLabelText('Decrease text size')).toBeInTheDocument();
    expect(screen.getByLabelText('Increase text size')).toBeInTheDocument();
  });

  describe('scroll-follow', () => {
    function mockScrollable(el: Element) {
      Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
      const original = window.getComputedStyle;
      vi.spyOn(window, 'getComputedStyle').mockImplementation((target) => {
        if (target === el) return { overflowY: 'auto' } as CSSStyleDeclaration;
        return original(target);
      });
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('pauses auto-scroll after wheel event on segments container', () => {
      const { container, rerender } = render(
        <TranscriptPanel segments={mockSegments} currentTime={0} />
      );
      const segments = container.querySelector('[class*="segments"]')!;
      mockScrollable(segments);

      act(() => {
        segments.dispatchEvent(new Event('wheel', { bubbles: true }));
      });

      // Clear the mock to track new calls
      (HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

      // Re-render with new currentTime — scrollIntoView should NOT be called
      rerender(<TranscriptPanel segments={mockSegments} currentTime={6} />);
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('resumes auto-scroll after 3 seconds', () => {
      const { container, rerender } = render(
        <TranscriptPanel segments={mockSegments} currentTime={0} />
      );
      const segments = container.querySelector('[class*="segments"]')!;
      mockScrollable(segments);

      act(() => {
        segments.dispatchEvent(new Event('wheel', { bubbles: true }));
      });

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      (HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
      rerender(<TranscriptPanel segments={mockSegments} currentTime={6} />);
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('does not scroll page when container is not scrollable', () => {
      const { rerender } = render(
        <TranscriptPanel segments={mockSegments} currentTime={0} />
      );
      // Container is NOT scrollable (default jsdom: scrollHeight === clientHeight)
      (HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
      rerender(<TranscriptPanel segments={mockSegments} currentTime={6} />);
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('segment click re-engages auto-scroll', () => {
      const onSegmentClick = vi.fn();
      const { container, rerender } = render(
        <TranscriptPanel segments={mockSegments} currentTime={0} onSegmentClick={onSegmentClick} />
      );
      const segments = container.querySelector('[class*="segments"]')!;
      mockScrollable(segments);

      // Disengage
      act(() => {
        segments.dispatchEvent(new Event('wheel', { bubbles: true }));
      });

      // Click a segment to reengage
      fireEvent.click(screen.getByText('Welcome to the podcast about quantum physics.'));

      (HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
      rerender(<TranscriptPanel segments={mockSegments} currentTime={6} />);
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });
});
