import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscoveryChat } from '@/components/discovery/DiscoveryChat';
import type { DiscoveryMessage, DiscoveryMetadata } from '@/types/discovery';

const mockMessages: DiscoveryMessage[] = [
  {
    id: 'msg-1',
    role: 'assistant',
    content: 'Hi! What topic would you like to explore?',
    chips: ['AI & Technology', 'Science', 'History'],
    createdAt: '2026-02-09T10:00:00Z',
  },
];

const mockMetadata: DiscoveryMetadata = {
  topic: 'Quantum Computing',
  depth: 'standard',
  audienceLevel: 'intermediate',
  audience: 'general',
  tone: 'professional',
  focusAreas: ['practical applications'],
  durationTarget: 600,
  ready: true,
};

describe('DiscoveryChat', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders chat container with proper ARIA labels', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ message: mockMessages[0] }),
    });

    render(<DiscoveryChat onComplete={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Discovery chat' })).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('displays initial assistant message after mount', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ message: mockMessages[0] }),
    });

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Hi! What topic would you like to explore?')).toBeInTheDocument();
    });
  });

  it('displays suggestion chips for assistant messages', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ message: mockMessages[0] }),
    });

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('AI & Technology')).toBeInTheDocument();
      expect(screen.getByText('Science')).toBeInTheDocument();
      expect(screen.getByText('History')).toBeInTheDocument();
    });
  });

  it('shows loading state with typing indicator', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // Never resolves to keep loading
    );

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Sotto is thinking')).toBeInTheDocument();
    });
  });

  it('handles chip selection and sends message', async () => {
    const user = userEvent.setup();
    let callCount = 0;

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({ message: mockMessages[0] }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          message: {
            id: 'msg-2',
            role: 'assistant',
            content: 'Great choice! Tell me more.',
            chips: [],
            createdAt: new Date().toISOString(),
          },
        }),
      };
    });

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('AI & Technology')).toBeInTheDocument();
    });

    await user.click(screen.getByText('AI & Technology'));

    await waitFor(() => {
      expect(screen.getByText('Great choice! Tell me more.')).toBeInTheDocument();
    });
  });

  it('renders user messages with correct styling', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: mockMessages[0] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            id: 'msg-2',
            role: 'assistant',
            content: 'Got it!',
            chips: [],
            createdAt: new Date().toISOString(),
          },
        }),
      });

    const user = userEvent.setup();
    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Describe your podcast idea...')).toBeInTheDocument();
    });

    const input = screen.getByLabelText('Chat message input');
    await user.type(input, 'I want to learn about quantum computing');
    await user.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByText('I want to learn about quantum computing')).toBeInTheDocument();
    });
  });

  it('disables input during loading', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      const input = screen.getByLabelText('Chat message input');
      expect(input).toBeDisabled();
    });
  });

  it('displays generate button when metadata is ready', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: mockMessages[0],
        metadata: mockMetadata,
      }),
    });

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Generate your podcast')).toBeInTheDocument();
    });
  });

  it('calls onComplete when generate button is clicked', async () => {
    const handleComplete = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: mockMessages[0],
        metadata: mockMetadata,
      }),
    });

    render(<DiscoveryChat onComplete={handleComplete} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Generate your podcast')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Generate your podcast'));

    expect(handleComplete).toHaveBeenCalledWith(mockMetadata);
  });

  it('handles API errors gracefully with fallback message', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/What topic would you like to explore/i)).toBeInTheDocument();
    });
  });

  it('handles failed message send with error message', async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: mockMessages[0] }),
      })
      .mockRejectedValueOnce(new Error('Failed to send'));

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Chat message input')).toBeInTheDocument();
    });

    const input = screen.getByLabelText('Chat message input');
    await user.type(input, 'Test message');
    await user.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });

  it('submits message on Enter key press', async () => {
    const user = userEvent.setup();
    let callCount = 0;

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({ message: mockMessages[0] }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          message: {
            id: 'msg-2',
            role: 'assistant',
            content: 'Response',
            chips: [],
            createdAt: new Date().toISOString(),
          },
        }),
      };
    });

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Chat message input')).toBeInTheDocument();
    });

    const input = screen.getByLabelText('Chat message input');
    await user.type(input, 'Test{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Response')).toBeInTheDocument();
    });
  });

  it('does not submit empty messages', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ message: mockMessages[0] }),
    });

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Send message')).toBeInTheDocument();
    });

    const sendButton = screen.getByLabelText('Send message');
    expect(sendButton).toBeDisabled();
  });

  it('displays bot avatar for assistant messages', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ message: mockMessages[0] }),
    });

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await waitFor(() => {
      const avatars = document.querySelectorAll('[aria-hidden="true"] svg');
      expect(avatars.length).toBeGreaterThan(0);
    });
  });

  it('loads initial message when podcastId is provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ message: mockMessages[0] }),
    });

    render(<DiscoveryChat podcastId="podcast-123" onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Hi! What topic would you like to explore?')).toBeInTheDocument();
    });
  });
});
