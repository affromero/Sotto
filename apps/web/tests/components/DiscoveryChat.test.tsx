import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscoveryChat } from '@/components/discovery/DiscoveryChat';
import type { DiscoveryMetadata } from '@/types/discovery';

// Mock useDiscovery hook
const mockSendMessage = vi.fn();
const mockReset = vi.fn();
const mockUpdateMetadata = vi.fn();

let hookState = {
  messages: [] as Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    chips: string[];
    createdAt: string;
  }>,
  metadata: null as DiscoveryMetadata | null,
  isLoading: false,
  isComplete: false,
  linkPreview: null,
  detectedLanguage: null as string | null,
  sendMessage: mockSendMessage,
  reset: mockReset,
  updateMetadata: mockUpdateMetadata,
};

vi.mock('@/lib/hooks/useDiscovery', () => ({
  useDiscovery: () => hookState,
}));

vi.mock('@/components/create/LlmModelDropdown', () => ({
  LlmModelDropdown: () => null,
}));

vi.mock('@sotto/shared', () => ({
  getLanguageLabel: (code: string) => {
    const map: Record<string, string> = { es: 'Spanish', fr: 'French', de: 'German' };
    return map[code] ?? code.toUpperCase();
  },
}));

// Mock EventProvider (useTrack is used by useDiscovery, but since we mock the whole hook it's not needed —
// however the module may still be imported transitively, so stub it)
vi.mock('@/components/providers/EventProvider', () => ({
  useTrack: () => vi.fn(),
}));

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
    vi.clearAllMocks();
    hookState = {
      messages: [],
      metadata: null,
      isLoading: false,
      isComplete: false,
      linkPreview: null,
      detectedLanguage: null,
      sendMessage: mockSendMessage,
      reset: mockReset,
      updateMetadata: mockUpdateMetadata,
    };
  });

  it('renders chat container with proper ARIA labels', () => {
    render(<DiscoveryChat onComplete={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Discovery chat' })).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('displays greeting message when no messages from hook', () => {
    render(<DiscoveryChat onComplete={vi.fn()} />);

    expect(screen.getByText(/What topic would you like to explore/i)).toBeInTheDocument();
  });

  it('displays greeting chips when no messages from hook', () => {
    render(<DiscoveryChat onComplete={vi.fn()} />);

    // Verify suggestion chips are rendered (at least the expected count)
    const chips = screen.getAllByRole('button').filter(
      (btn) => btn.getAttribute('aria-label')?.startsWith('Select suggestion:')
    );
    expect(chips.length).toBeGreaterThanOrEqual(5);
  });

  it('shows greeting plus hook messages when messages exist', () => {
    hookState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Tell me about quantum computing',
        chips: [],
        createdAt: '2026-02-09T10:00:00Z',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Great topic! What depth would you like?',
        chips: ['Quick Overview', 'Deep Dive'],
        createdAt: '2026-02-09T10:00:01Z',
      },
    ];

    render(<DiscoveryChat onComplete={vi.fn()} />);

    // Greeting is always first
    expect(screen.getByText(/What topic would you like to explore/i)).toBeInTheDocument();
    // User message
    expect(screen.getByText('Tell me about quantum computing')).toBeInTheDocument();
    // Assistant response
    expect(screen.getByText('Great topic! What depth would you like?')).toBeInTheDocument();
  });

  it('shows loading state with typing indicator', () => {
    hookState.isLoading = true;

    render(<DiscoveryChat onComplete={vi.fn()} />);

    expect(screen.getByLabelText('Sotto is thinking')).toBeInTheDocument();
  });

  it('handles chip selection and calls sendMessage with isChipBased=true', async () => {
    const user = userEvent.setup();

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await user.click(screen.getByText('AI & Technology'));

    expect(mockSendMessage).toHaveBeenCalledWith('AI & Technology', undefined, true, undefined);
  });

  it('passes podcastId to sendMessage when chip selected', async () => {
    const user = userEvent.setup();

    render(<DiscoveryChat podcastId="podcast-123" onComplete={vi.fn()} />);

    await user.click(screen.getByText('Science'));

    expect(mockSendMessage).toHaveBeenCalledWith('Science', 'podcast-123', true, undefined);
  });

  it('sends typed message and clears input', async () => {
    const user = userEvent.setup();

    render(<DiscoveryChat onComplete={vi.fn()} />);

    const input = screen.getByLabelText('Chat message input');
    await user.type(input, 'I want to learn about quantum computing');
    await user.click(screen.getByLabelText('Send message'));

    expect(mockSendMessage).toHaveBeenCalledWith(
      'I want to learn about quantum computing',
      undefined,
      false,
      undefined
    );
    expect(input).toHaveValue('');
  });

  it('submits message on Enter key press', async () => {
    const user = userEvent.setup();

    render(<DiscoveryChat onComplete={vi.fn()} />);

    const input = screen.getByLabelText('Chat message input');
    await user.type(input, 'Test{Enter}');

    expect(mockSendMessage).toHaveBeenCalledWith('Test', undefined, false, undefined);
  });

  it('does not submit empty messages', () => {
    render(<DiscoveryChat onComplete={vi.fn()} />);

    const sendButton = screen.getByLabelText('Send message');
    expect(sendButton).toBeDisabled();
  });

  it('disables input during loading', () => {
    hookState.isLoading = true;

    render(<DiscoveryChat onComplete={vi.fn()} />);

    const input = screen.getByLabelText('Chat message input');
    expect(input).toBeDisabled();
  });

  it('does not send when loading', async () => {
    hookState.isLoading = true;
    const user = userEvent.setup();

    render(<DiscoveryChat onComplete={vi.fn()} />);

    // Chips should be disabled too
    const chip = screen.getByLabelText('Select suggestion: AI & Technology');
    expect(chip).toBeDisabled();

    // Trying to click a disabled chip should not call sendMessage
    await user.click(chip);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('displays generate button when metadata is ready', () => {
    hookState.metadata = mockMetadata;

    render(<DiscoveryChat onComplete={vi.fn()} />);

    expect(screen.getByLabelText('Generate your podcast')).toBeInTheDocument();
  });

  it('does not display generate button when metadata is not ready', () => {
    hookState.metadata = { ...mockMetadata, ready: false };

    render(<DiscoveryChat onComplete={vi.fn()} />);

    expect(screen.queryByLabelText('Generate your podcast')).not.toBeInTheDocument();
  });

  it('calls onComplete when generate button is clicked', async () => {
    const handleComplete = vi.fn();
    const user = userEvent.setup();

    hookState.metadata = mockMetadata;

    render(<DiscoveryChat onComplete={handleComplete} />);

    await user.click(screen.getByLabelText('Generate your podcast'));

    expect(handleComplete).toHaveBeenCalledWith(mockMetadata);
  });

  it('auto-sends initialTopic on mount', () => {
    render(
      <DiscoveryChat podcastId="podcast-123" onComplete={vi.fn()} initialTopic="quantum physics" />
    );

    expect(mockSendMessage).toHaveBeenCalledWith('quantum physics', 'podcast-123', false, undefined);
  });

  it('only shows chips on the last assistant message', () => {
    hookState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Tell me about AI',
        chips: [],
        createdAt: '2026-02-09T10:00:00Z',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'First response',
        chips: ['Option A', 'Option B'],
        createdAt: '2026-02-09T10:00:01Z',
      },
      {
        id: 'user-2',
        role: 'user',
        content: 'Option A',
        chips: [],
        createdAt: '2026-02-09T10:00:02Z',
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: 'Second response',
        chips: ['Deep Dive', 'Quick Overview'],
        createdAt: '2026-02-09T10:00:03Z',
      },
    ];

    render(<DiscoveryChat onComplete={vi.fn()} />);

    // Only last assistant's chips should be rendered
    expect(screen.queryByText('Option A')).toBeInTheDocument(); // user message text
    expect(screen.queryByText('Option B')).not.toBeInTheDocument(); // first assistant's chip — hidden
    expect(screen.getByText('Deep Dive')).toBeInTheDocument();
    expect(screen.getByText('Quick Overview')).toBeInTheDocument();
  });

  it('refocuses input when loading completes', () => {
    hookState.isLoading = true;

    const { rerender } = render(<DiscoveryChat onComplete={vi.fn()} />);

    // Simulate loading completing
    hookState.isLoading = false;
    act(() => {
      rerender(<DiscoveryChat onComplete={vi.fn()} />);
    });

    const input = screen.getByLabelText('Chat message input');
    expect(document.activeElement).toBe(input);
  });

  it('does not show language banner when detectedLanguage is null', () => {
    render(<DiscoveryChat onComplete={vi.fn()} />);

    expect(screen.queryByRole('status', { name: 'Language suggestion' })).not.toBeInTheDocument();
  });

  it('shows language banner when detectedLanguage is set', () => {
    hookState.detectedLanguage = 'es';

    render(<DiscoveryChat onComplete={vi.fn()} />);

    expect(screen.getByRole('status', { name: 'Language suggestion' })).toBeInTheDocument();
    expect(screen.getByText(/Switch to Spanish/)).toBeInTheDocument();
  });

  it('hides language banner after dismiss', async () => {
    hookState.detectedLanguage = 'es';
    const user = userEvent.setup();

    render(<DiscoveryChat onComplete={vi.fn()} />);

    expect(screen.getByRole('status', { name: 'Language suggestion' })).toBeInTheDocument();

    await user.click(screen.getByText('Keep English'));

    expect(screen.queryByRole('status', { name: 'Language suggestion' })).not.toBeInTheDocument();
  });

  it('renders DiscoveryParamsCard instead of SuggestionChips when metadata.ready is true', () => {
    hookState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Tell me about quantum computing',
        chips: [],
        createdAt: '2026-02-09T10:00:00Z',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Great topic!',
        chips: ['angle A', 'angle B'],
        createdAt: '2026-02-09T10:00:01Z',
      },
    ];
    hookState.metadata = mockMetadata; // ready: true

    render(<DiscoveryChat onComplete={vi.fn()} />);

    // Params card chip groups should be visible
    expect(screen.getByRole('group', { name: 'Depth' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tone' })).toBeInTheDocument();

    // Focus-pivot chips from the agent should NOT render (metadata is ready)
    expect(screen.queryByText('angle A')).not.toBeInTheDocument();
  });

  it('renders SuggestionChips (not DiscoveryParamsCard) when metadata.ready is false', () => {
    hookState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Tell me about space',
        chips: [],
        createdAt: '2026-02-09T10:00:00Z',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'What angle interests you?',
        chips: ['Black holes', 'Mars missions'],
        createdAt: '2026-02-09T10:00:01Z',
      },
    ];
    hookState.metadata = { ...mockMetadata, ready: false };

    render(<DiscoveryChat onComplete={vi.fn()} />);

    expect(screen.getByText('Black holes')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Depth' })).not.toBeInTheDocument();
  });

  it('calls updateMetadata when a chip inside DiscoveryParamsCard is clicked', async () => {
    const user = userEvent.setup();

    hookState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Tell me about AI',
        chips: [],
        createdAt: '2026-02-09T10:00:00Z',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Here are your params.',
        chips: [],
        createdAt: '2026-02-09T10:00:01Z',
      },
    ];
    hookState.metadata = { ...mockMetadata, depth: 'standard' };

    render(<DiscoveryChat onComplete={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Depth: ELI5' }));

    expect(mockUpdateMetadata).toHaveBeenCalledWith({ depth: 'eli5' });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
