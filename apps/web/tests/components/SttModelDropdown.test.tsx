import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SttModelDropdown } from '@/components/create/SttModelDropdown';

const fetchMock = vi.fn();

const sttProvidersResponse = {
  providers: [
    {
      id: 'openai',
      displayName: 'OpenAI Whisper',
      description: 'Fast transcription',
    },
    {
      id: 'deepgram',
      displayName: 'Deepgram Nova',
      description: 'High accuracy',
    },
  ],
};

describe('SttModelDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    const storage = new Map<string, string>();
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

  it('restores OpenAI as a concrete transcription provider', async () => {
    localStorage.setItem('sotto:sttProvider', 'openai');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...sttProvidersResponse, configuredProviders: ['openai'] }),
    });
    const onChange = vi.fn();

    render(<SttModelDropdown value={undefined} onChange={onChange} />);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('openai');
    });
    expect(onChange).not.toHaveBeenCalledWith(undefined);
  });

  it('selects the first configured provider when no stored provider exists', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...sttProvidersResponse, configuredProviders: ['deepgram'] }),
    });
    const onChange = vi.fn();

    render(<SttModelDropdown value={undefined} onChange={onChange} />);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('deepgram');
    });
  });
});
