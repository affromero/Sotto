import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/providers/fal-endpoints', () => ({
  getFalAvatarEndpoint: vi.fn().mockReturnValue('fal-ai/lip-sync'),
}));

import { submitFalLipSync } from '@/lib/fal-lip-sync';

const defaultParams = {
  modelId: 'fal-lipsync-v1',
  imageUrl: 'https://cdn.example.com/avatar.png',
  audioUrl: 'https://cdn.example.com/audio.mp3',
  apiKey: 'test-fal-key',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('submitFalLipSync', () => {
  it('includes resolution field in submission body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        request_id: 'req-123',
        status_url: 'https://queue.fal.run/fal-ai/lip-sync/requests/req-123/status',
        response_url: 'https://queue.fal.run/fal-ai/lip-sync/requests/req-123',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await submitFalLipSync(defaultParams);

    const [, callOptions] = mockFetch.mock.calls[0];
    const body = JSON.parse(callOptions.body as string) as Record<string, string>;
    expect(body.resolution).toBe('512');
    expect(body.image_url).toBe(defaultParams.imageUrl);
    expect(body.audio_url).toBe(defaultParams.audioUrl);
  });

  it('throws with parsed validation error on 422', async () => {
    const validationError = {
      detail: [
        { loc: ['body', 'image_url'], msg: 'field required', type: 'value_error.missing' },
        { loc: ['body', 'audio_url'], msg: 'invalid url format', type: 'value_error.url' },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve(JSON.stringify(validationError)),
    }));

    await expect(submitFalLipSync(defaultParams)).rejects.toThrow('422');

    // Error should include field-level details from the 422 body
    await expect(submitFalLipSync(defaultParams)).rejects.toThrow('image_url');
  });

  it('returns requestId, statusUrl, resultUrl on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        request_id: 'req-abc',
        status_url: 'https://queue.fal.run/fal-ai/lip-sync/requests/req-abc/status',
        response_url: 'https://queue.fal.run/fal-ai/lip-sync/requests/req-abc',
      }),
    }));

    const result = await submitFalLipSync(defaultParams);

    expect(result.requestId).toBe('req-abc');
    expect(result.statusUrl).toContain('/status');
    expect(result.resultUrl).toBeDefined();
  });

  it('throws when no Fal endpoint is configured for model', async () => {
    const { getFalAvatarEndpoint } = await import('@/lib/providers/fal-endpoints');
    vi.mocked(getFalAvatarEndpoint).mockReturnValueOnce(null);

    await expect(submitFalLipSync(defaultParams)).rejects.toThrow('No Fal avatar endpoint');
  });
});
