import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast } from '@/components/providers/ToastProvider';

function TestConsumer({ message = 'Test toast', type = 'success' as const, duration }: { message?: string; type?: 'success' | 'error' | 'info' | 'warning'; duration?: number }) {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast(message, type, duration)}>
      Trigger
    </button>
  );
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders toast when showToast is called', async () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );

    await act(async () => {
      screen.getByText('Trigger').click();
    });

    expect(screen.getByText('Test toast')).toBeInTheDocument();
  });

  it('auto-dismisses toast after duration', async () => {
    render(
      <ToastProvider>
        <TestConsumer duration={2000} />
      </ToastProvider>
    );

    await act(async () => {
      screen.getByText('Trigger').click();
    });

    expect(screen.getByText('Test toast')).toBeInTheDocument();

    // Advance past duration + fade-out animation (200ms)
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(screen.queryByText('Test toast')).not.toBeInTheDocument();
  });

  it('supports different toast types', async () => {
    render(
      <ToastProvider>
        <TestConsumer message="Error occurred" type="error" />
      </ToastProvider>
    );

    await act(async () => {
      screen.getByText('Trigger').click();
    });

    expect(screen.getByText('Error occurred')).toBeInTheDocument();
  });

  it('renders toast with action button when action is provided', async () => {
    function ActionConsumer() {
      const { showToast } = useToast();
      return (
        <button onClick={() => showToast('Ready!', 'success', 4000, { label: 'View', onClick: vi.fn() })}>
          Trigger
        </button>
      );
    }

    render(
      <ToastProvider>
        <ActionConsumer />
      </ToastProvider>
    );

    await act(async () => {
      screen.getByText('Trigger').click();
    });

    expect(screen.getByText('Ready!')).toBeInTheDocument();
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('renders multiple toasts', async () => {
    function MultiTrigger() {
      const { showToast } = useToast();
      return (
        <>
          <button onClick={() => showToast('Toast alpha', 'success')}>Trigger A</button>
          <button onClick={() => showToast('Toast beta', 'error')}>Trigger B</button>
        </>
      );
    }

    render(
      <ToastProvider>
        <MultiTrigger />
      </ToastProvider>
    );

    await act(async () => {
      screen.getByText('Trigger A').click();
    });
    await act(async () => {
      screen.getByText('Trigger B').click();
    });

    expect(screen.getByText('Toast alpha')).toBeInTheDocument();
    expect(screen.getByText('Toast beta')).toBeInTheDocument();
  });
});
