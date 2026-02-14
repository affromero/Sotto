import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoicePreferenceSelector } from '@/components/settings/VoicePreferenceSelector';

const mockPoolVoices = [
  { voice_id: 'voice-1', name: 'Sarah', category: 'female' },
  { voice_id: 'voice-2', name: 'Michael', category: 'male' },
  { voice_id: 'voice-3', name: 'Emma', category: 'female' },
];

const mockVoiceClones = [
  { id: 'clone-1', name: 'My Voice', elevenLabsVoiceId: 'clone-voice-1' },
  { id: 'clone-2', name: 'Custom Voice', elevenLabsVoiceId: 'clone-voice-2' },
];

describe('VoicePreferenceSelector', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders label text', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={[]}
      />
    );

    expect(screen.getByText('Host Voice')).toBeInTheDocument();
  });

  it('renders select dropdown', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={[]}
      />
    );

    expect(screen.getByLabelText('Host Voice')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('shows auto-assign option by default', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={[]}
      />
    );

    expect(screen.getByRole('option', { name: 'Auto-assign (recommended)' })).toBeInTheDocument();
  });

  it('disables select while loading', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={[]}
      />
    );

    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('enables select after loading completes', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });
  });

  it('displays pool voices after loading', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Sarah (female)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Michael (male)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Emma (female)' })).toBeInTheDocument();
    });
  });

  it('displays voice clones in separate optgroup', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={mockVoiceClones}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'My Voice' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Custom Voice' })).toBeInTheDocument();
    });
  });

  it('calls onChange with selected voice id', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={handleChange}
        voiceClones={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });

    await user.selectOptions(screen.getByRole('combobox'), 'voice-1');

    expect(handleChange).toHaveBeenCalledWith('voice-1');
  });

  it('calls onChange with null when auto-assign selected', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value="voice-1"
        onChange={handleChange}
        voiceClones={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });

    await user.selectOptions(screen.getByRole('combobox'), '');

    expect(handleChange).toHaveBeenCalledWith(null);
  });

  it('displays current value when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value="voice-2"
        onChange={vi.fn()}
        voiceClones={[]}
      />
    );

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('voice-2');
    });
  });

  it('displays empty string value when value is null', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={[]}
      />
    );

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('');
    });
  });

  it('handles API error gracefully with empty voice list', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Auto-assign (recommended)');
  });

  it('handles missing voices property in API response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
  });

  it('does not render voice clones optgroup when empty array', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });

    const optgroups = screen.queryAllByRole('group');
    expect(optgroups).toHaveLength(1);
    expect(optgroups[0]).toHaveAttribute('label', 'Voice Library');
  });

  it('renders both optgroups when both voice types present', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ voices: mockPoolVoices }),
    });

    render(
      <VoicePreferenceSelector
        label="Host Voice"
        value={null}
        onChange={vi.fn()}
        voiceClones={mockVoiceClones}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });

    const optgroups = screen.getAllByRole('group');
    expect(optgroups).toHaveLength(2);
    expect(optgroups[0]).toHaveAttribute('label', 'Your Voice Clones');
    expect(optgroups[1]).toHaveAttribute('label', 'Voice Library');
  });
});
