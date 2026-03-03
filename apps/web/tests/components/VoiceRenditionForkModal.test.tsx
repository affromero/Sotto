import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = vi.fn();
const mockOnClose = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
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

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, loading, type, variant: _variant, ...props }: { children: React.ReactNode; onClick?: () => void; loading?: boolean; type?: 'button' | 'submit' | 'reset'; variant?: string }) => (
    <button onClick={onClick} disabled={loading} type={type} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/Input', () => ({
  Input: ({ label, value, onChange, name, placeholder, helperText }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; name: string; placeholder?: string; helperText?: string }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} value={value} onChange={onChange} placeholder={placeholder} />
      {helperText && <span>{helperText}</span>}
    </div>
  ),
}));

vi.mock('@/components/player/AudioConfigPanel', () => ({
  AudioConfigPanel: ({ onConfigChange }: { speakers: string[]; onConfigChange: (config: unknown) => void }) => (
    <div data-testid="audio-config-panel">
      <button
        type="button"
        data-testid="set-config"
        onClick={() =>
          onConfigChange({
            ttsProvider: 'elevenlabs',
            ttsModel: null,
            voices: [
              { speaker: 'HOST', voiceId: 'voice-1' },
              { speaker: 'EXPERT', voiceId: 'voice-2' },
            ],
          })
        }
      >
        Set Config
      </button>
    </div>
  ),
}));

vi.mock('@/components/providers/StripeProvider', () => ({
  StripeProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/voices/VoicePaymentModal', () => ({
  VoicePaymentModal: () => <div data-testid="voice-payment-modal" />,
}));

vi.mock('lucide-react', () => ({
  Mic: () => <span data-testid="mic-icon" />,
}));

import { VoiceRenditionForkModal } from '@/components/player/VoiceRenditionForkModal';

const defaultProps = {
  isOpen: true,
  onClose: mockOnClose,
  podcastId: 'pod-1',
  podcastTitle: 'Quantum Computing 101',
  speakers: ['HOST', 'EXPERT'],
};

describe('VoiceRenditionForkModal', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <VoiceRenditionForkModal {...defaultProps} isOpen={false} />,
    );

    // Modal stub returns null when !isOpen, but StripeProvider wrapper may still be there
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders step 1 with name input', () => {
    render(<VoiceRenditionForkModal {...defaultProps} />);

    expect(screen.getByText('Re-voice')).toBeInTheDocument();
    expect(screen.getByLabelText('Rendition Name')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('advances to step 2 with AudioConfigPanel after entering name', async () => {
    const user = userEvent.setup();
    render(<VoiceRenditionForkModal {...defaultProps} />);

    const nameInput = screen.getByLabelText('Rendition Name');
    await user.type(nameInput, 'British Narrator');
    await user.click(screen.getByText('Next'));

    expect(screen.getByTestId('audio-config-panel')).toBeInTheDocument();
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('navigates back from step 2 to step 1', async () => {
    const user = userEvent.setup();
    render(<VoiceRenditionForkModal {...defaultProps} />);

    // Go to step 2
    const nameInput = screen.getByLabelText('Rendition Name');
    await user.type(nameInput, 'My Rendition');
    await user.click(screen.getByText('Next'));
    expect(screen.getByTestId('audio-config-panel')).toBeInTheDocument();

    // Go back
    await user.click(screen.getByText('Back'));
    expect(screen.getByLabelText('Rendition Name')).toBeInTheDocument();
    expect(screen.queryByTestId('audio-config-panel')).not.toBeInTheDocument();
  });

  it('submits fork and redirects on success', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'fork-pod-1', voiceTrackId: 'track-1' }),
    } as Response);

    render(<VoiceRenditionForkModal {...defaultProps} />);

    // Step 1: enter name
    await user.type(screen.getByLabelText('Rendition Name'), 'Cinema Style');
    await user.click(screen.getByText('Next'));

    // Step 2: configure audio and submit
    await user.click(screen.getByTestId('set-config'));
    // Use getByRole to avoid ambiguity with the "Re-voice" heading
    const submitBtn = screen.getByRole('button', { name: 'Re-voice' });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/podcast/fork-pod-1');
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows payment modal on 402 response', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 402,
      json: () => Promise.resolve({ requiresPayment: true, voiceCharges: [{ voiceId: 'v-1', amount: 500 }] }),
    } as Response);

    render(<VoiceRenditionForkModal {...defaultProps} />);

    // Go to step 2 and submit
    await user.type(screen.getByLabelText('Rendition Name'), 'Expensive Voices');
    await user.click(screen.getByText('Next'));
    await user.click(screen.getByTestId('set-config'));
    await user.click(screen.getByRole('button', { name: 'Re-voice' }));

    await waitFor(() => {
      expect(screen.getByTestId('voice-payment-modal')).toBeInTheDocument();
    });
  });

  it('shows error on non-402 failure', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    } as Response);

    render(<VoiceRenditionForkModal {...defaultProps} />);

    await user.type(screen.getByLabelText('Rendition Name'), 'Broken');
    await user.click(screen.getByText('Next'));
    await user.click(screen.getByTestId('set-config'));
    await user.click(screen.getByRole('button', { name: 'Re-voice' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Internal server error')).toBeInTheDocument();
    });
  });
});
