import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useScrollFollow } from '@/lib/hooks/useScrollFollow';

/**
 * Test harness: renders a div with the scrollContainerRef attached,
 * exposing hook state via data attributes and reengage via a button.
 */
function Harness({ resumeDelay }: { resumeDelay?: number }) {
  const { scrollContainerRef, isFollowing, reengage } = useScrollFollow({ resumeDelay });
  return (
    <div
      ref={scrollContainerRef as React.RefObject<HTMLDivElement>}
      data-testid="container"
      data-following={isFollowing}
    >
      <button onClick={reengage} data-testid="reengage">
        reengage
      </button>
    </div>
  );
}

function mockScrollable(el: HTMLElement, scrollable: boolean, overflowY = 'auto') {
  Object.defineProperty(el, 'scrollHeight', {
    value: scrollable ? 1000 : 100,
    configurable: true,
  });
  Object.defineProperty(el, 'clientHeight', {
    value: 100,
    configurable: true,
  });
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((target) => {
    if (target === el) return { overflowY } as CSSStyleDeclaration;
    return original(target);
  });
}

function getFollowing() {
  return screen.getByTestId('container').getAttribute('data-following') === 'true';
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useScrollFollow', () => {
  it('defaults to isFollowing = true', () => {
    render(<Harness />);
    expect(getFollowing()).toBe(true);
  });

  it('disengages on wheel event when container is scrollable', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    mockScrollable(container, true);

    act(() => {
      container.dispatchEvent(new Event('wheel', { bubbles: true }));
    });

    expect(getFollowing()).toBe(false);
  });

  it('stays engaged on wheel event when container is not scrollable', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    mockScrollable(container, false);

    act(() => {
      container.dispatchEvent(new Event('wheel', { bubbles: true }));
    });

    expect(getFollowing()).toBe(true);
  });

  it('stays engaged on wheel event when overflow is hidden', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    mockScrollable(container, true, 'hidden');

    act(() => {
      container.dispatchEvent(new Event('wheel', { bubbles: true }));
    });

    expect(getFollowing()).toBe(true);
  });

  it('disengages on touchstart event', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    mockScrollable(container, true);

    act(() => {
      container.dispatchEvent(new Event('touchstart', { bubbles: true }));
    });

    expect(getFollowing()).toBe(false);
  });

  it('re-engages after 3000ms', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    mockScrollable(container, true);

    act(() => {
      container.dispatchEvent(new Event('wheel', { bubbles: true }));
    });
    expect(getFollowing()).toBe(false);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(getFollowing()).toBe(true);
  });

  it('respects custom resumeDelay', () => {
    render(<Harness resumeDelay={1000} />);
    const container = screen.getByTestId('container');
    mockScrollable(container, true);

    act(() => {
      container.dispatchEvent(new Event('wheel', { bubbles: true }));
    });
    expect(getFollowing()).toBe(false);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(getFollowing()).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(getFollowing()).toBe(true);
  });

  it('resets debounce timer on rapid inputs', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    mockScrollable(container, true);

    act(() => {
      container.dispatchEvent(new Event('wheel', { bubbles: true }));
    });

    // Advance 2s, fire another wheel
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      container.dispatchEvent(new Event('wheel', { bubbles: true }));
    });

    // At 3s from start (1s after second wheel), should still be disengaged
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getFollowing()).toBe(false);

    // At 5s from start (3s after second wheel), should re-engage
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(getFollowing()).toBe(true);
  });

  it('reengage() immediately sets isFollowing = true', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    mockScrollable(container, true);

    act(() => {
      container.dispatchEvent(new Event('wheel', { bubbles: true }));
    });
    expect(getFollowing()).toBe(false);

    act(() => {
      screen.getByTestId('reengage').click();
    });
    expect(getFollowing()).toBe(true);
  });

  it('cleans up listeners on unmount', () => {
    render(<Harness />);
    const container = screen.getByTestId('container');
    const removeSpy = vi.spyOn(container, 'removeEventListener');

    const { unmount } = render(<Harness />);
    const container2 = screen.getAllByTestId('container')[1];
    const removeSpy2 = vi.spyOn(container2, 'removeEventListener');

    unmount();

    const removedEvents = removeSpy2.mock.calls.map(([event]) => event);
    expect(removedEvents).toContain('wheel');
    expect(removedEvents).toContain('touchstart');

    removeSpy.mockRestore();
  });
});
