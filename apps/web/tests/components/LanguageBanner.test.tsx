import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageBanner } from '@/components/discovery/LanguageBanner';

vi.mock('@sotto/shared', () => ({
  getLanguageLabel: (code: string) => {
    const map: Record<string, string> = { es: 'Spanish', fr: 'French', de: 'German', ja: 'Japanese' };
    return map[code] ?? code.toUpperCase();
  },
}));

describe('LanguageBanner', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('renders with correct language name', () => {
    render(<LanguageBanner detectedLanguage="es" onDismiss={vi.fn()} />);

    expect(screen.getByRole('status', { name: 'Language suggestion' })).toBeInTheDocument();
    expect(screen.getByText(/Switch to Spanish/)).toBeInTheDocument();
    expect(screen.getByText(/you write in Spanish/)).toBeInTheDocument();
  });

  it('calls PATCH /api/users/me on switch button click', async () => {
    const user = userEvent.setup();

    render(<LanguageBanner detectedLanguage="fr" onDismiss={vi.fn()} />);

    await user.click(screen.getByText('Switch to French'));

    expect(mockFetch).toHaveBeenCalledWith('/api/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredLanguage: 'fr' }),
    });
  });

  it('calls onDismiss after successful switch', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(<LanguageBanner detectedLanguage="de" onDismiss={onDismiss} />);

    await user.click(screen.getByText('Switch to German'));

    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  it('calls onDismiss on Keep English click', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(<LanguageBanner detectedLanguage="ja" onDismiss={onDismiss} />);

    await user.click(screen.getByText('Keep English'));

    expect(onDismiss).toHaveBeenCalled();
  });

  it('calls onDismiss on X button click', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(<LanguageBanner detectedLanguage="es" onDismiss={onDismiss} />);

    await user.click(screen.getByLabelText('Dismiss language suggestion'));

    expect(onDismiss).toHaveBeenCalled();
  });
});
