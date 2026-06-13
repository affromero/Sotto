import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoicePreferenceSelector } from '@/components/settings/VoicePreferenceSelector';

const mockPoolVoices = [
  { id: 'voice-1', name: 'Sarah', category: 'female' },
  { id: 'voice-2', name: 'Michael', category: 'male' },
  { id: 'voice-3', name: 'Emma', category: 'female' },
];

describe('VoicePreferenceSelector', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders label text and select dropdown', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ poolVoices: mockPoolVoices }),
    });

    render(<VoicePreferenceSelector label="Host Voice" value={null} onChange={vi.fn()} />);

    expect(screen.getByText('Host Voice')).toBeInTheDocument();
    expect(screen.getByLabelText('Host Voice')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Auto-assign' })).toBeInTheDocument();
  });

  it('disables select while loading and enables after loading completes', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ poolVoices: mockPoolVoices }),
    });

    render(<VoicePreferenceSelector label="Host Voice" value={null} onChange={vi.fn()} />);

    expect(screen.getByRole('combobox')).toBeDisabled();
    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });
  });

  it('displays preset pool voices after loading', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ poolVoices: mockPoolVoices }),
    });

    render(<VoicePreferenceSelector label="Host Voice" value={null} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Sarah (female)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Michael (male)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Emma (female)' })).toBeInTheDocument();
    });

    const optgroups = screen.getAllByRole('group');
    expect(optgroups).toHaveLength(1);
    expect(optgroups[0]).toHaveAttribute('label', 'Voice Library');
  });

  it('calls onChange with selected voice id', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ poolVoices: mockPoolVoices }),
    });

    render(<VoicePreferenceSelector label="Host Voice" value={null} onChange={handleChange} />);

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
      json: async () => ({ poolVoices: mockPoolVoices }),
    });

    render(<VoicePreferenceSelector label="Host Voice" value="voice-1" onChange={handleChange} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });

    await user.selectOptions(screen.getByRole('combobox'), '');

    expect(handleChange).toHaveBeenCalledWith(null);
  });

  it('displays current value when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ poolVoices: mockPoolVoices }),
    });

    render(<VoicePreferenceSelector label="Host Voice" value="voice-2" onChange={vi.fn()} />);

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('voice-2');
    });
  });

  it('handles API error gracefully with empty voice list', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    render(<VoicePreferenceSelector label="Host Voice" value={null} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Auto-assign');
  });
});
