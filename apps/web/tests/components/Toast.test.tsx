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

    // Advance well past the default duration + any animation delay
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(handleClose).toHaveBeenCalled();
  });

  it('auto-dismisses after custom duration', () => {
    const handleClose = vi.fn();
    render(<Toast message="Custom duration" duration={2000} onClose={handleClose} />);

    // Advance well past the custom duration + any animation delay
    act(() => {
      vi.advanceTimersByTime(3000);
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

  it('renders action button when action prop is provided', () => {
    const handleAction = vi.fn();
    render(
      <Toast
        message="Episode ready"
        onClose={vi.fn()}
        action={{ label: 'View', onClick: handleAction }}
      />
    );
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('calls action onClick and onClose when action button is clicked', async () => {
    const handleAction = vi.fn();
    const handleClose = vi.fn();
    render(
      <Toast
        message="Episode ready"
        onClose={handleClose}
        action={{ label: 'View', onClick: handleAction }}
      />
    );

    await act(async () => {
      screen.getByText('View').click();
    });
    expect(handleAction).toHaveBeenCalled();
    expect(handleClose).toHaveBeenCalled();
  });

  it('does not render action button when action prop is omitted', () => {
    render(<Toast message="No action" onClose={vi.fn()} />);
    expect(screen.queryByText('View')).not.toBeInTheDocument();
    expect(screen.queryByText('Report')).not.toBeInTheDocument();
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

});
