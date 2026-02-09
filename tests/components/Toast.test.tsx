import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Toast } from '@/components/ui/Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders message text', () => {
    render(<Toast message="Test notification" onClose={vi.fn()} />);
    expect(screen.getByText('Test notification')).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(<Toast message="Test notification" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Close notification' })).toBeInTheDocument();
  });

  it('applies info type class by default', () => {
    const { container } = render(<Toast message="Info message" onClose={vi.fn()} />);
    const toast = container.querySelector('[class*="toast"]');
    expect(toast?.className).toContain('info');
  });

  it('applies success type class', () => {
    const { container } = render(
      <Toast message="Success message" type="success" onClose={vi.fn()} />
    );
    const toast = container.querySelector('[class*="toast"]');
    expect(toast?.className).toContain('success');
  });

  it('applies error type class', () => {
    const { container } = render(<Toast message="Error message" type="error" onClose={vi.fn()} />);
    const toast = container.querySelector('[class*="toast"]');
    expect(toast?.className).toContain('error');
  });

  it('applies warning type class', () => {
    const { container } = render(
      <Toast message="Warning message" type="warning" onClose={vi.fn()} />
    );
    const toast = container.querySelector('[class*="toast"]');
    expect(toast?.className).toContain('warning');
  });

  it('starts with visible animation class', () => {
    const { container } = render(<Toast message="Test" onClose={vi.fn()} />);
    const toast = container.querySelector('[class*="toast"]');
    expect(toast?.className).toContain('visible');
  });

  it('auto-dismisses after default duration', () => {
    const handleClose = vi.fn();
    render(<Toast message="Auto dismiss" onClose={handleClose} />);

    // Fast-forward time to just before dismissal
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(handleClose).not.toHaveBeenCalled();

    // Fast-forward past the 4000ms duration + 200ms animation delay
    act(() => {
      vi.advanceTimersByTime(201);
    });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after custom duration', () => {
    const handleClose = vi.fn();
    render(<Toast message="Custom duration" duration={2000} onClose={handleClose} />);

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(handleClose).not.toHaveBeenCalled();

    // Fast-forward past duration + animation delay
    act(() => {
      vi.advanceTimersByTime(201);
    });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose immediately when close button is clicked', async () => {
    const handleClose = vi.fn();
    render(<Toast message="Manual close" onClose={handleClose} />);

    const closeButton = screen.getByRole('button', { name: 'Close notification' });
    await act(async () => {
      closeButton.click();
    });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('changes to hidden animation class before calling onClose', () => {
    const handleClose = vi.fn();
    const { container } = render(<Toast message="Animation test" onClose={handleClose} />);
    const toast = container.querySelector('[class*="toast"]');

    expect(toast?.className).toContain('visible');

    // Fast-forward past duration to trigger state change
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(toast?.className).toContain('hidden');
    expect(toast?.className).not.toContain('visible');
  });

  it('cleans up timeout on unmount', () => {
    const handleClose = vi.fn();
    const { unmount } = render(<Toast message="Unmount test" onClose={handleClose} />);

    unmount();
    vi.advanceTimersByTime(5000);

    // onClose should not be called after unmount
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('renders multiple toasts independently', () => {
    const { container } = render(
      <>
        <Toast message="First toast" type="success" onClose={vi.fn()} />
        <Toast message="Second toast" type="error" onClose={vi.fn()} />
      </>
    );

    expect(screen.getByText('First toast')).toBeInTheDocument();
    expect(screen.getByText('Second toast')).toBeInTheDocument();

    const toasts = container.querySelectorAll('[class*="toast"]');
    expect(toasts).toHaveLength(2);
  });

  it('accepts long message text', () => {
    const longMessage =
      'This is a very long notification message that might wrap to multiple lines in the toast component';
    render(<Toast message={longMessage} onClose={vi.fn()} />);
    expect(screen.getByText(longMessage)).toBeInTheDocument();
  });
});
