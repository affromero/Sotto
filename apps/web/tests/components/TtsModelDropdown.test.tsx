import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TtsModelDropdown } from '@/components/create/TtsModelDropdown';

const fetchMock = vi.fn();

describe('TtsModelDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const storage = new Map<string, string>();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
      clear: vi.fn(() => {
        storage.clear();
      }),
    });
  });

  it('selects the first concrete BYOK voice option instead of leaving provider undefined', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        readOnly: false,
        isByok: true,
        options: [
          {
            id: 'openai:tts-1-hd',
            displayName: 'OpenAI TTS HD',
            group: 'OpenAI',
          },
        ],
      }),
    });
    const onChange = vi.fn();

    render(<TtsModelDropdown ttsProvider={undefined} ttsModel={undefined} onChange={onChange} />);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('openai', 'tts-1-hd');
    });
    expect(onChange).not.toHaveBeenCalledWith(undefined, undefined);
  });

  it('keeps Auto explicit when the server includes the Auto option', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        readOnly: false,
        isByok: false,
        options: [
          {
            id: 'auto',
            displayName: 'Auto',
          },
          {
            id: 'openai:tts-1',
            displayName: 'OpenAI TTS',
            group: 'OpenAI',
          },
        ],
      }),
    });
    const onChange = vi.fn();

    render(<TtsModelDropdown ttsProvider={undefined} ttsModel={undefined} onChange={onChange} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/tts-options');
    });
    expect(onChange).not.toHaveBeenCalledWith('openai', 'tts-1');
  });
});
