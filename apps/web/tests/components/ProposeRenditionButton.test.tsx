import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, loading, type, variant: _variant, ...props }: { children: React.ReactNode; onClick?: () => void; loading?: boolean; type?: 'button' | 'submit' | 'reset'; variant?: string }) => (
    <button onClick={onClick} disabled={loading} type={type} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode; size?: string }) => {
    if (!isOpen) return null;
    return (
      <div role="dialog" data-testid="modal">
        <button onClick={onClose} aria-label="Close">Close</button>
        {children}
      </div>
    );
  },
}));

vi.mock('lucide-react', () => ({
  Send: () => <span data-testid="send-icon" />,
  Check: () => <span data-testid="check-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

import { ProposeRenditionButton } from '@/components/player/ProposeRenditionButton';

const defaultProps = {
  podcastId: 'fork-pod-1',
  voiceTrackId: 'track-1',
  originalPodcastId: 'original-pod-1',
  originalTitle: 'Quantum Computing 101',
};

describe('ProposeRenditionButton', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders propose button with original title', () => {
    render(<ProposeRenditionButton {...defaultProps} />);

    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('Quantum Computing 101');
  });

  it('opens modal on button click', async () => {
    const user = userEvent.setup();
    render(<ProposeRenditionButton {...defaultProps} />);

    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button'));

    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByText('Propose Rendition')).toBeInTheDocument();
  });

  it('submits proposal successfully and shows success banner', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'proposed-1', podcastId: 'original-pod-1' }),
    } as Response);

    render(<ProposeRenditionButton {...defaultProps} />);

    await user.click(screen.getByRole('button'));
    const textarea = screen.getByPlaceholderText(/Describe your rendition/);
    await user.type(textarea, 'Great voices!');
    await user.click(screen.getByText('Propose'));

    await waitFor(() => {
      expect(screen.getByTestId('check-icon')).toBeInTheDocument();
    });

    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      '/api/podcasts/fork-pod-1/voice-tracks/track-1/propose',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Great voices!' }),
      }),
    );
  });

  it('includes message in request body', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'proposed-1', podcastId: 'original-pod-1' }),
    } as Response);

    render(<ProposeRenditionButton {...defaultProps} />);

    await user.click(screen.getByRole('button'));
    const textarea = screen.getByPlaceholderText(/Describe your rendition/);
    await user.type(textarea, 'My custom message');
    await user.click(screen.getByText('Propose'));

    await waitFor(() => {
      expect(vi.mocked(global.fetch)).toHaveBeenCalled();
    });

    const callBody = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string);
    expect(callBody.message).toBe('My custom message');
  });

  it('shows error message on failure', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Already proposed' }),
    } as Response);

    render(<ProposeRenditionButton {...defaultProps} />);

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('Propose'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Already proposed')).toBeInTheDocument();
    });
  });

  it('navigates to original podcast from success banner', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'proposed-1', podcastId: 'original-pod-1' }),
    } as Response);

    render(<ProposeRenditionButton {...defaultProps} />);

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('Propose'));

    await waitFor(() => {
      expect(screen.getByTestId('check-icon')).toBeInTheDocument();
    });

    // Click the link button in success banner
    const linkBtn = screen.getByText('Quantum Computing 101');
    await user.click(linkBtn);

    expect(mockPush).toHaveBeenCalledWith('/podcast/original-pod-1');
  });
});
