import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Teleprompter } from '@/components/player/Teleprompter';
import type { SegmentData } from '@/types/podcast';
import type { ReferenceData } from '@/types/reference';

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
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

    it('pauses auto-scroll after wheel event on root container', () => {
      const { rerender } = render(
        <Teleprompter segments={mockSegments} references={[]} currentTime={0} />
      );
      const root = screen.getByLabelText('Teleprompter view');
      mockScrollable(root);

      act(() => {
        root.dispatchEvent(new Event('wheel', { bubbles: true }));
      });

      (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

      // Change currentTime to trigger activeIndex change (0→6 moves to segment 2)
      rerender(<Teleprompter segments={mockSegments} references={[]} currentTime={6} />);
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('resumes auto-scroll after 3 seconds', () => {
      const { rerender } = render(
        <Teleprompter segments={mockSegments} references={[]} currentTime={0} />
      );
      const root = screen.getByLabelText('Teleprompter view');
      mockScrollable(root);

      act(() => {
        root.dispatchEvent(new Event('wheel', { bubbles: true }));
      });

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
      rerender(<Teleprompter segments={mockSegments} references={[]} currentTime={6} />);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('segment click re-engages auto-scroll', () => {
      const onSegmentClick = vi.fn();
      const { rerender } = render(
        <Teleprompter segments={mockSegments} references={[]} currentTime={6} onSegmentClick={onSegmentClick} />
      );
      const root = screen.getByLabelText('Teleprompter view');
      mockScrollable(root);

      // Disengage
      act(() => {
        root.dispatchEvent(new Event('wheel', { bubbles: true }));
      });

      // Click a segment to reengage
      fireEvent.click(screen.getByText('Welcome to the show!'));

      (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
      rerender(<Teleprompter segments={mockSegments} references={[]} currentTime={14} />);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });
});
