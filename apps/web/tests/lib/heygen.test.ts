import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { listAvatars, submitAvatarVideo, pollAvatarVideo, isNonRetryableHeyGenError, HeyGenBillingError } from '@/lib/heygen';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('listAvatars', () => {
  it('returns parsed avatars on success', async () => {
    const avatars = [
      { avatar_id: 'av1', avatar_name: 'Anna', preview_image_url: 'https://img/1', gender: 'female', premium: false },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { avatars } }),
    }));

    const result = await listAvatars('test-key');
    expect(result).toEqual(avatars);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.heygen.com/v2/avatars',
      expect.objectContaining({ headers: { 'x-api-key': 'test-key' } }),
    );
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    }));

    await expect(listAvatars('bad-key')).rejects.toThrow('HeyGen list avatars failed (401)');
  });
});

describe('submitAvatarVideo', () => {
  it('returns video_id on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { video_id: 'vid_123' } }),
    }));

    const id = await submitAvatarVideo({
      apiKey: 'key',
      avatarId: 'av1',
      audioUrl: 'https://audio.mp3',
    });
    expect(id).toBe('vid_123');
  });

  it('sends closeUp style and green screen background', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { video_id: 'vid_123' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await submitAvatarVideo({ apiKey: 'key', avatarId: 'av1', audioUrl: 'https://audio.mp3' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.video_inputs[0].character.avatar_style).toBe('closeUp');
    expect(body.video_inputs[0].background).toEqual({ type: 'color', value: '#00FF00' });
  });

  it('throws on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad request'),
    }));

    await expect(submitAvatarVideo({ apiKey: 'key', avatarId: 'av1', audioUrl: 'url' }))
      .rejects.toThrow('HeyGen submit failed (400)');
  });

  it('throws HeyGenBillingError on 402 (credits exhausted)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: () => Promise.resolve('Payment required'),
    }));

    await expect(submitAvatarVideo({ apiKey: 'key', avatarId: 'av1', audioUrl: 'url' }))
      .rejects.toThrow(HeyGenBillingError);
  });

  it('throws HeyGenBillingError on 401 (invalid key)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    }));

    await expect(submitAvatarVideo({ apiKey: 'key', avatarId: 'av1', audioUrl: 'url' }))
      .rejects.toThrow(HeyGenBillingError);
  });
});

describe('pollAvatarVideo', () => {
  it('returns video URL when completed', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { status: 'processing' } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { status: 'completed', video_url: 'https://result.mp4' } }),
      });
    }));

    const result = await pollAvatarVideo({
      apiKey: 'key',
      videoId: 'vid_123',
      pollIntervalMs: 10,
    });
    expect(result.videoUrl).toBe('https://result.mp4');
  });

  it('throws on HeyGen failure status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { status: 'failed', error: 'render error' } }),
    }));

    await expect(pollAvatarVideo({ apiKey: 'key', videoId: 'vid_123', pollIntervalMs: 10 }))
      .rejects.toThrow('HeyGen video generation failed: render error');
  });

  it('throws HeyGenBillingError when poll failure mentions credits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { status: 'failed', error: 'insufficient_credits' } }),
    }));

    await expect(pollAvatarVideo({ apiKey: 'key', videoId: 'vid_123', pollIntervalMs: 10 }))
      .rejects.toThrow(HeyGenBillingError);
  });

  it('throws on timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { status: 'processing' } }),
    }));

    await expect(pollAvatarVideo({
      apiKey: 'key',
      videoId: 'vid_123',
      maxPollAttempts: 2,
      pollIntervalMs: 10,
    })).rejects.toThrow('timed out after 2 poll attempts');
  });
});

describe('isNonRetryableHeyGenError', () => {
  it('returns true for HeyGenBillingError', () => {
    expect(isNonRetryableHeyGenError(new HeyGenBillingError('credits gone'))).toBe(true);
  });

  it('returns true for errors mentioning billing keywords', () => {
    expect(isNonRetryableHeyGenError(new Error('insufficient credits on account'))).toBe(true);
    expect(isNonRetryableHeyGenError(new Error('quota exceeded'))).toBe(true);
    expect(isNonRetryableHeyGenError(new Error('subscription expired'))).toBe(true);
  });

  it('returns false for transient errors', () => {
    expect(isNonRetryableHeyGenError(new Error('network timeout'))).toBe(false);
    expect(isNonRetryableHeyGenError(new Error('render error'))).toBe(false);
    expect(isNonRetryableHeyGenError(new Error('internal server error'))).toBe(false);
  });
});
