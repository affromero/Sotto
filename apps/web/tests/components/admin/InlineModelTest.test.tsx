import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineModelTest } from '@/app/(admin)/admin/providers/InlineModelTest';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('InlineModelTest', () => {
  it('tests the selection it was given, not some default', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, latencyMs: 120, response: 'Hi' }));
    render(<InlineModelTest type="ai" provider="claude-code" model="claude-sonnet-5" />);

    await userEvent.click(screen.getByRole('button', { name: /test this model/i }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'ai',
      provider: 'claude-code',
      model: 'claude-sonnet-5',
    });
  });

  it('reports a working model with its latency', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, latencyMs: 340, response: 'Hola' }));
    render(<InlineModelTest type="ai" provider="openai" model="gpt-5.5" />);

    await userEvent.click(screen.getByRole('button', { name: /test this model/i }));

    expect(await screen.findByText('340 ms')).toBeInTheDocument();
    expect(screen.getByText('Hola')).toBeInTheDocument();
  });

  it('shows why a model failed instead of a bare cross', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: 'Platform API key not configured (check .env)' })
    );
    render(<InlineModelTest type="tts" provider="elevenlabs" model="eleven_v3" />);

    await userEvent.click(screen.getByRole('button', { name: /test this model/i }));

    // The reason is the whole point: "it failed" sends you to the logs.
    expect(await screen.findByText(/Platform API key not configured/)).toBeInTheDocument();
  });

  it('survives a network failure without wedging the button', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<InlineModelTest type="stt" provider="openai" model="whisper-1" />);

    const button = screen.getByRole('button', { name: /test this model/i });
    await userEvent.click(button);

    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('clears a stale result when the selection changes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, latencyMs: 90, response: 'Hi' }));
    // Keyed on the selection, exactly as the settings page mounts it.
    const { rerender } = render(
      <InlineModelTest key="ai:openai:gpt-5.5" type="ai" provider="openai" model="gpt-5.5" />
    );

    await userEvent.click(screen.getByRole('button', { name: /test this model/i }));
    expect(await screen.findByText('90 ms')).toBeInTheDocument();

    // A green tick under a model nobody tested is worse than no tick at all.
    rerender(
      <InlineModelTest
        key="ai:openai:gpt-5.5-mini"
        type="ai"
        provider="openai"
        model="gpt-5.5-mini"
      />
    );
    expect(screen.queryByText('90 ms')).not.toBeInTheDocument();
  });
});
