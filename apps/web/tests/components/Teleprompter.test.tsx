import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Teleprompter } from '@/components/player/Teleprompter';
import type { SegmentData } from '@/types/podcast';
import type { ReferenceData } from '@/types/reference';

// jsdom doesn't implement scrollIntoView or matchMedia
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const mockSegments: SegmentData[] = [
  { id: 'seg-1', speaker: 'HOST', text: 'Welcome to the show!', audioUrl: null, order: 0, startTime: 0, duration: 5 },
  { id: 'seg-2', speaker: 'EXPERT', text: 'Thanks for having me. According to a study [1], AI is growing rapidly.', audioUrl: null, order: 1, startTime: 5, duration: 8 },
  { id: 'seg-3', speaker: 'HOST', text: 'That is fascinating!', audioUrl: null, order: 2, startTime: 13, duration: 3 },
  { id: 'seg-4', speaker: 'EXPERT', text: 'Let me tell you more about it.', audioUrl: null, order: 3, startTime: 16, duration: 5 },
];

const mockReferences: ReferenceData[] = [
  {
    id: 'ref-1',
    number: 1,
    title: 'AI Growth Study',
    authors: ['Smith, J.'],
    year: 2023,
    url: 'https://example.com',
    type: 'PAPER',
    publisher: 'Nature',
    doi: null,
    verificationStatus: 'VERIFIED',
    verificationDetails: null,
    contentDomain: null,
  },
];

describe('Teleprompter', () => {
  it('renders the teleprompter view', () => {
    render(
      <Teleprompter
        segments={mockSegments}
        references={mockReferences}
        currentTime={0}
      />
    );
    expect(screen.getByLabelText('Teleprompter view')).toBeInTheDocument();
  });

  it('highlights the active segment based on currentTime', () => {
    render(
      <Teleprompter
        segments={mockSegments}
        references={[]}
        currentTime={6}
      />
    );
    // At time=6, segment 2 (EXPERT) should be active
    const expertLabels = screen.getAllByText('EXPERT');
    // The active segment should be present
    expect(expertLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('shows speaker labels with correct names', () => {
    render(
      <Teleprompter
        segments={mockSegments}
        references={[]}
        currentTime={0}
      />
    );
    expect(screen.getAllByText('HOST').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('EXPERT').length).toBeGreaterThanOrEqual(1);
  });

  it('shows previous, current, and next segments', () => {
    // At time=6, index 1 is active; 0 is prev, 2 is next
    render(
      <Teleprompter
        segments={mockSegments}
        references={[]}
        currentTime={6}
      />
    );
    expect(screen.getByText('Welcome to the show!')).toBeInTheDocument();
    expect(screen.getByText(/Thanks for having me/)).toBeInTheDocument();
    expect(screen.getByText('That is fascinating!')).toBeInTheDocument();
  });

  it('handles first segment (no previous)', () => {
    render(
      <Teleprompter
        segments={mockSegments}
        references={[]}
        currentTime={0}
      />
    );
    expect(screen.getByText('Welcome to the show!')).toBeInTheDocument();
  });

  it('calls onSegmentClick when a segment is clicked', () => {
    const onSegmentClick = vi.fn();
    render(
      <Teleprompter
        segments={mockSegments}
        references={[]}
        currentTime={6}
        onSegmentClick={onSegmentClick}
      />
    );

    // Click on the previous segment text
    fireEvent.click(screen.getByText('Welcome to the show!'));
    expect(onSegmentClick).toHaveBeenCalledWith(0);
  });

  it('renders citations in segment text', () => {
    render(
      <Teleprompter
        segments={mockSegments}
        references={mockReferences}
        currentTime={6}
      />
    );
    // The [1] citation marker should be rendered as a button
    const citationButton = screen.getByLabelText('Citation 1');
    expect(citationButton).toBeInTheDocument();
  });

  it('handles empty segments array', () => {
    render(
      <Teleprompter
        segments={[]}
        references={[]}
        currentTime={0}
      />
    );
    expect(screen.getByLabelText('Teleprompter view')).toBeInTheDocument();
  });

  describe('scroll-follow', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('pauses auto-scroll on mousemove', () => {
      render(
        <Teleprompter segments={mockSegments} references={[]} currentTime={0} />
      );

      (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

      // User moves mouse — should pause auto-scroll
      act(() => {
        window.dispatchEvent(new Event('mousemove'));
      });

      // scrollIntoView should NOT be called while user is active
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('resumes auto-scroll after 3s idle', () => {
      render(
        <Teleprompter segments={mockSegments} references={[]} currentTime={0} />
      );

      // User moves mouse — disengages
      act(() => {
        window.dispatchEvent(new Event('mousemove'));
      });

      (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

      // Wait 3s — should re-engage and scroll root into view
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('segment click seeks without forcing scroll-back', () => {
      const onSegmentClick = vi.fn();
      render(
        <Teleprompter segments={mockSegments} references={[]} currentTime={6} onSegmentClick={onSegmentClick} />
      );

      (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

      // Click a segment — should seek but NOT immediately scroll back
      fireEvent.click(screen.getByText('Welcome to the show!'));

      expect(onSegmentClick).toHaveBeenCalledWith(0);
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
  });
});
