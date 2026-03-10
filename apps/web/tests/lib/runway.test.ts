import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  RunwayBillingError,
  isNonRetryableRunwayError,
  listRunwayPresets,
  listRunwayAvatars,
  createRealtimeSession,
  pollSessionReady,
  consumeSession,
  deleteSession,
} from '@/lib/runway';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RunwayBillingError', () => {
  it('has the correct name', () => {
    const err = new RunwayBillingError('out of credits');
    expect(err.name).toBe('RunwayBillingError');
    expect(err.message).toBe('out of credits');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('isNonRetryableRunwayError', () => {
  it('returns true for RunwayBillingError instances', () => {
    expect(isNonRetryableRunwayError(new RunwayBillingError('test'))).toBe(true);
  });

  it('returns true for billing-related error messages', () => {
    expect(isNonRetryableRunwayError(new Error('insufficient_credits'))).toBe(true);
    expect(isNonRetryableRunwayError(new Error('Payment Required'))).toBe(true);
    expect(isNonRetryableRunwayError(new Error('quota exceeded for account'))).toBe(true);
    expect(isNonRetryableRunwayError(new Error('subscription expired'))).toBe(true);
    expect(isNonRetryableRunwayError(new Error('plan limit reached'))).toBe(true);
    expect(isNonRetryableRunwayError(new Error('no remaining credits'))).toBe(true);
  });

  it('returns false for retryable errors', () => {
    expect(isNonRetryableRunwayError(new Error('Network timeout'))).toBe(false);
    expect(isNonRetryableRunwayError(new Error('Internal server error'))).toBe(false);
    expect(isNonRetryableRunwayError(new Error('502 Bad Gateway'))).toBe(false);
  });

  it('handles non-Error values', () => {
    expect(isNonRetryableRunwayError('billing error')).toBe(true);
    expect(isNonRetryableRunwayError('some random error')).toBe(false);
    expect(isNonRetryableRunwayError(null)).toBe(false);
  });
});

describe('listRunwayPresets', () => {
  it('returns all 9 preset avatars', () => {
    const presets = listRunwayPresets();
    expect(presets).toHaveLength(9);
    // Portal presets come first with real thumbnails
    expect(presets[0].id).toBe('cat-character');
    expect(presets[0].name).toContain('Mochi');
    expect(presets[0].previewImageUrl).toContain('runway-static-assets');
    // API-only presets use placeholder
    const apiOnly = presets.find((p) => p.id === 'influencer');
    expect(apiOnly).toBeDefined();
    expect(apiOnly!.previewImageUrl).toContain('gwm-1-avatars');
    // game-character-man is new
    expect(presets.find((p) => p.id === 'game-character-man')).toBeDefined();
  });

  it('returns stable references (static data)', () => {
    expect(listRunwayPresets()).toEqual(listRunwayPresets());
  });
});

describe('listRunwayAvatars', () => {
  it('fetches single page of avatars', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: [{ id: 'av-1', name: 'Custom Avatar' }],
        has_more: false,
      }),
    });

    const result = await listRunwayAvatars('test-key');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('av-1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'X-Runway-Version': '2024-11-06',
    });
  });

  it('paginates through multiple pages', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ id: 'av-1', name: 'First' }],
          has_more: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ id: 'av-2', name: 'Second' }],
          has_more: false,
        }),
      });

    const result = await listRunwayAvatars('test-key');
    expect(result).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Second call should include cursor
    const secondUrl = mockFetch.mock.calls[1][0] as string;
    expect(secondUrl).toContain('starting_after=av-1');
  });

  it('throws RunwayBillingError on 402', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: () => Promise.resolve('Payment required'),
    });

    await expect(listRunwayAvatars('test-key')).rejects.toThrow(RunwayBillingError);
  });

  it('throws generic Error on 500', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal error'),
    });

    await expect(listRunwayAvatars('test-key')).rejects.toThrow('Runway list avatars failed (500)');
    await expect(listRunwayAvatars('test-key')).rejects.not.toThrow(RunwayBillingError);
  });
});

describe('createRealtimeSession', () => {
  it('creates a preset session', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'session-123' }),
    });

    const sessionId = await createRealtimeSession({
      apiKey: 'test-key',
      avatarId: 'influencer',
      isPreset: true,
    });

    expect(sessionId).toBe('session-123');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('gwm1_avatars');
    expect(body.avatar).toEqual({ type: 'runway-preset', presetId: 'influencer' });
  });

  it('creates a custom avatar session', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'session-456' }),
    });

    await createRealtimeSession({
      apiKey: 'test-key',
      avatarId: 'custom-av-1',
      isPreset: false,
      maxDuration: 300,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('gwm1_avatars');
    expect(body.avatar).toEqual({ type: 'custom', avatarId: 'custom-av-1' });
    expect(body.maxDuration).toBe(300);
  });

  it('throws RunwayBillingError on 403', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    });

    await expect(createRealtimeSession({
      apiKey: 'test-key',
      avatarId: 'influencer',
      isPreset: true,
    })).rejects.toThrow(RunwayBillingError);
  });
});

describe('pollSessionReady', () => {
  it('returns sessionKey when session becomes READY', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'PENDING' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'READY', sessionKey: 'jwt-key-123' }),
      });

    const key = await pollSessionReady({
      apiKey: 'test-key',
      sessionId: 'session-1',
      maxPollAttempts: 5,
      pollIntervalMs: 1,
    });

    expect(key).toBe('jwt-key-123');
  });

  it('throws on FAILED status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'FAILED', error: 'GPU unavailable' }),
    });

    await expect(pollSessionReady({
      apiKey: 'test-key',
      sessionId: 'session-1',
      maxPollAttempts: 2,
      pollIntervalMs: 1,
    })).rejects.toThrow('Runway session failed: GPU unavailable');
  });

  it('throws RunwayBillingError on FAILED with billing reason', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'FAILED', error: 'insufficient_credits' }),
    });

    await expect(pollSessionReady({
      apiKey: 'test-key',
      sessionId: 'session-1',
      maxPollAttempts: 2,
      pollIntervalMs: 1,
    })).rejects.toThrow(RunwayBillingError);
  });

  it('throws on timeout', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'PENDING' }),
    });

    await expect(pollSessionReady({
      apiKey: 'test-key',
      sessionId: 'session-1',
      maxPollAttempts: 2,
      pollIntervalMs: 1,
    })).rejects.toThrow('timed out after 2 poll attempts');
  });

  it('continues polling on HTTP errors', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'READY', sessionKey: 'key-after-retry' }),
      });

    const key = await pollSessionReady({
      apiKey: 'test-key',
      sessionId: 'session-1',
      maxPollAttempts: 3,
      pollIntervalMs: 1,
    });

    expect(key).toBe('key-after-retry');
  });
});

describe('consumeSession', () => {
  it('returns LiveKit credentials', async () => {
    const creds = {
      url: 'wss://demo-123.livekit.cloud',
      token: 'lk-jwt-token',
      roomName: 'room-xyz',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(creds),
    });

    const result = await consumeSession({
      sessionKey: 'session-jwt',
      sessionId: 'session-1',
    });

    expect(result).toEqual(creds);
    // Uses sessionKey (not apiKey) for auth
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer session-jwt');
  });

  it('throws on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Session not ready'),
    });

    await expect(consumeSession({
      sessionKey: 'jwt',
      sessionId: 'session-1',
    })).rejects.toThrow('Runway consume session failed (400)');
  });
});

describe('deleteSession', () => {
  it('calls DELETE endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await deleteSession({ apiKey: 'test-key', sessionId: 'session-1' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('swallows errors silently', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    // Should not throw
    await expect(deleteSession({ apiKey: 'test-key', sessionId: 'session-1' })).resolves.toBeUndefined();
  });
});
