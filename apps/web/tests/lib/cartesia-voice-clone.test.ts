import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { cloneVoiceViaCartesia, deleteCartesiaVoice } from '@/lib/cartesia-voice-clone';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cloneVoiceViaCartesia', () => {
  it('clones a voice and returns the voice ID', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cartesia-voice-123' }),
    });

    const result = await cloneVoiceViaCartesia(
      'test-api-key',
      Buffer.from('audio-data'),
      'My Voice'
    );

    expect(result.voiceId).toBe('cartesia-voice-123');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cartesia.ai/voices/clone',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-Key': 'test-api-key',
          'Cartesia-Version': '2025-04-16',
        }),
      })
    );
  });

  it('throws on clone failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad audio quality',
    });

    await expect(
      cloneVoiceViaCartesia('key', Buffer.from('bad'), 'Test')
    ).rejects.toThrow(/Cartesia voice clone error.*400/);
  });

  it('sends enhance flag when specified', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'v-1' }),
    });

    await cloneVoiceViaCartesia('key', Buffer.from('audio'), 'Test', {
      enhance: true,
    });

    const call = mockFetch.mock.calls[0];
    const body = call[1].body as FormData;
    expect(body.get('enhance')).toBe('true');
  });
});

describe('deleteCartesiaVoice', () => {
  it('deletes a voice by ID', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await deleteCartesiaVoice('test-api-key', 'cartesia-voice-123');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cartesia.ai/voices/cartesia-voice-123',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'X-API-Key': 'test-api-key',
          'Cartesia-Version': '2025-04-16',
        }),
      })
    );
  });

  it('throws on deletion failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Voice not found',
    });

    await expect(
      deleteCartesiaVoice('key', 'nonexistent')
    ).rejects.toThrow(/Cartesia voice deletion error.*404/);
  });
});
