import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SunoMusicProvider } from '@/lib/providers/music/suno.provider';

const mockFetch = vi.fn();

describe('SunoMusicProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 200, data: { taskId: 'task-1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          data: {
            status: 'SUCCESS',
            response: { sunoData: [{ audioUrl: 'https://audio.example.com/a.mp3' }] },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('submits the configured deployment URL as the callback URL', async () => {
    const provider = new SunoMusicProvider('suno-key', 'suno-v5');

    const result = provider.generateMusic({
      prompt: 'ambient private briefing bed',
      durationSeconds: 30,
      instrumental: true,
    });
    await vi.advanceTimersByTimeAsync(5000);
    await result;

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(submitBody.callBackUrl).toBe('https://selfhost.example.com/api/webhooks/noop');
  });
});
