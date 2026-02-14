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
    expect(handleClose).toHaveBeenCalled();
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
    expect(handleClose).toHaveBeenCalled();
  });

  it('calls onClose immediately when close button is clicked', async () => {
    const handleClose = vi.fn();
    render(<Toast message="Manual close" onClose={handleClose} />);

    const closeButton = screen.getByRole('button', { name: 'Close notification' });
    await act(async () => {
      closeButton.click();
    });
    expect(handleClose).toHaveBeenCalled();
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
    render(
      <>
        <Toast message="First toast" type="success" onClose={vi.fn()} />
        <Toast message="Second toast" type="error" onClose={vi.fn()} />
      </>
    );

    expect(screen.getByText('First toast')).toBeInTheDocument();
    expect(screen.getByText('Second toast')).toBeInTheDocument();
  });

  it('accepts long message text', () => {
    const longMessage =
      'This is a very long notification message that might wrap to multiple lines in the toast component';
    render(<Toast message={longMessage} onClose={vi.fn()} />);
    expect(screen.getByText(longMessage)).toBeInTheDocument();
  });
});
