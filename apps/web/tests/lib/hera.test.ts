import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: vi.fn(),
}));

import { createHeraJob } from '@/lib/hera';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  delete process.env.HERA_API_KEY;
});

describe('createHeraJob', () => {
  it('throws when HERA_API_KEY not set', async () => {
    delete process.env.HERA_API_KEY;

    await expect(
      createHeraJob({ prompt: 'test prompt', durationSeconds: 5 }),
    ).rejects.toThrow('not configured');
  });

  it('returns videoId on success', async () => {
    process.env.HERA_API_KEY = 'test-hera-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ video_id: 'hera-vid-abc123' }),
    }));

    const result = await createHeraJob({ prompt: 'test prompt', durationSeconds: 5 });

    expect(result.videoId).toBe('hera-vid-abc123');
  });

  it('throws with actual API error on non-ok response', async () => {
    process.env.HERA_API_KEY = 'test-hera-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve(JSON.stringify({ error: 'USAGE_LIMIT_REACHED' })),
    }));

    await expect(
      createHeraJob({ prompt: 'test prompt', durationSeconds: 5 }),
    ).rejects.toThrow('USAGE_LIMIT_REACHED');
  });

  it('includes prompt and duration_seconds in request body', async () => {
    process.env.HERA_API_KEY = 'test-hera-key';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ video_id: 'hera-vid-xyz' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await createHeraJob({ prompt: 'animated data chart', durationSeconds: 10 });

    const [, callOptions] = mockFetch.mock.calls[0];
    const body = JSON.parse(callOptions.body as string) as Record<string, unknown>;
    expect(body.prompt).toBe('animated data chart');
    expect(body.duration_seconds).toBe(10);
  });

  it('throws when response is missing video_id', async () => {
    process.env.HERA_API_KEY = 'test-hera-key';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }));

    await expect(
      createHeraJob({ prompt: 'test prompt', durationSeconds: 5 }),
    ).rejects.toThrow('missing video_id');
  });
});
