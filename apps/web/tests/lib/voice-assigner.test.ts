import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assignVoicesForEpisode } from '@/lib/voice-assigner';

const mockEpisodeVoiceFindMany = vi.fn();
const mockEpisodeVoiceCreateMany = vi.fn();
const mockEpisodeFindUniqueOrThrow = vi.fn();
const serverConfiguration = vi.hoisted(() => ({ ttsVoices: null as string | null }));

vi.mock('@/lib/server-config', () => ({
  infra: (key: string) =>
    key === 'ttsVoices' ? (serverConfiguration.ttsVoices ?? undefined) : undefined,
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    episode: { findUniqueOrThrow: (...args: unknown[]) => mockEpisodeFindUniqueOrThrow(...args) },
    episodeVoice: {
      findMany: (...args: unknown[]) => mockEpisodeVoiceFindMany(...args),
      createMany: (...args: unknown[]) => mockEpisodeVoiceCreateMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/redis', () => ({
  cache: { get: vi.fn(), set: vi.fn() },
  getRedisClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('assignVoicesForEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverConfiguration.ttsVoices = null;
    mockEpisodeVoiceFindMany.mockResolvedValue([]);
    mockEpisodeVoiceCreateMany.mockResolvedValue({ count: 0 });
    mockEpisodeFindUniqueOrThrow.mockResolvedValue({ ttsModel: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('skips assignment for 1 speaker', async () => {
    await assignVoicesForEpisode('pod-1', [{ name: 'HOST' }], 'elevenlabs');

    expect(mockEpisodeVoiceFindMany).not.toHaveBeenCalled();
    expect(mockEpisodeVoiceCreateMany).not.toHaveBeenCalled();
  });

  it('uses deterministic assignment for 2 speakers', async () => {
    await assignVoicesForEpisode('pod-1', [{ name: 'HOST' }, { name: 'EXPERT' }], 'elevenlabs');

    expect(mockEpisodeVoiceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ episodeId: 'pod-1', speaker: 'HOST', provider: 'elevenlabs' }),
          expect.objectContaining({
            episodeId: 'pod-1',
            speaker: 'EXPERT',
            provider: 'elevenlabs',
          }),
        ]),
      })
    );
  });

  it.each(['deepgram', 'rime', 'playht', 'fish'] as const)(
    'assigns voices from the %s pool (no unsupported-provider throw)',
    async (provider) => {
      await assignVoicesForEpisode('pod-1', [{ name: 'HOST' }, { name: 'EXPERT' }], provider);

      const call = mockEpisodeVoiceCreateMany.mock.calls[0][0];
      expect(call.data).toHaveLength(2);
      for (const row of call.data as Array<{ provider: string; voiceId: string }>) {
        expect(row.provider).toBe(provider);
        expect(row.voiceId).toBeTruthy();
      }
    }
  );

  it('preserves existing voice overrides', async () => {
    mockEpisodeVoiceFindMany.mockResolvedValue([
      { speaker: 'HOST' },
      { speaker: 'EXPERT' },
      { speaker: 'GUEST' },
    ]);

    await assignVoicesForEpisode(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }, { name: 'GUEST' }],
      'elevenlabs'
    );

    expect(mockEpisodeVoiceCreateMany).not.toHaveBeenCalled();
  });

  it.each([null, 'tts-1', 'tts-1-hd'])(
    'persists model-compatible distinct OpenAI voices for %s',
    async (ttsModel) => {
      mockEpisodeFindUniqueOrThrow.mockResolvedValue({ ttsModel });
      await assignVoicesForEpisode(
        'cmvoal7ql003701pj1bes6bvg',
        [{ name: 'HOST' }, { name: 'EXPERT' }],
        'openai'
      );
      const rows = mockEpisodeVoiceCreateMany.mock.calls[0][0].data as Array<{ voiceId: string }>;
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.voiceId)).size).toBe(2);
      for (const row of rows) {
        expect([
          'alloy',
          'ash',
          'coral',
          'echo',
          'fable',
          'onyx',
          'nova',
          'sage',
          'shimmer',
        ]).toContain(row.voiceId);
      }
    }
  );

  it('retains modern OpenAI voices for the captured modern episode model', async () => {
    mockEpisodeFindUniqueOrThrow.mockResolvedValue({ ttsModel: 'gpt-4o-mini-tts' });
    await assignVoicesForEpisode(
      'cmvoal7ql003701pj1bes6bvg',
      [{ name: 'HOST' }, { name: 'EXPERT' }],
      'openai'
    );
    const rows = mockEpisodeVoiceCreateMany.mock.calls[0][0].data as Array<{ voiceId: string }>;
    expect(rows.map((row) => row.voiceId)).toContain('cedar');
  });

  it('keeps legacy OpenAI casting deterministic and varied between episodes', async () => {
    mockEpisodeFindUniqueOrThrow.mockResolvedValue({ ttsModel: 'tts-1-hd' });
    const cast = async (episodeId: string) => {
      await assignVoicesForEpisode(episodeId, [{ name: 'HOST' }, { name: 'EXPERT' }], 'openai');
      const rows = mockEpisodeVoiceCreateMany.mock.lastCall![0].data as Array<{ voiceId: string }>;
      return rows.map((row) => row.voiceId);
    };
    expect(await cast('same-episode')).toEqual(await cast('same-episode'));
    const pairs: string[][] = [];
    for (let index = 0; index < 24; index++) pairs.push(await cast(`voice-variety-${index}`));
    expect(new Set(pairs.flat()).size).toBeGreaterThan(2);
    for (const pair of pairs) expect(new Set(pair).size).toBe(2);
  });

  it('assigns 3 distinct voices deterministically for 3+ speakers', async () => {
    await assignVoicesForEpisode(
      'pod-1',
      [
        { name: 'HOST', description: 'Warm episode host' },
        { name: 'EXPERT', description: 'Subject matter expert' },
        { name: 'GUEST', description: 'Curious newcomer' },
      ],
      'elevenlabs'
    );

    const createCall = mockEpisodeVoiceCreateMany.mock.calls[0][0];
    const data = createCall.data as Array<{ voiceId: string }>;
    expect(data).toHaveLength(3);
    expect(new Set(data.map((entry) => entry.voiceId)).size).toBe(3);
    expect(mockEpisodeVoiceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ episodeId: 'pod-1', speaker: 'HOST', provider: 'elevenlabs' }),
          expect.objectContaining({
            episodeId: 'pod-1',
            speaker: 'EXPERT',
            provider: 'elevenlabs',
          }),
          expect.objectContaining({ episodeId: 'pod-1', speaker: 'GUEST', provider: 'elevenlabs' }),
        ]),
      })
    );
  });

  it('uses provider-specific deterministic voice pools', async () => {
    await assignVoicesForEpisode(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }, { name: 'GUEST' }],
      'cartesia'
    );

    expect(mockEpisodeVoiceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ episodeId: 'pod-1', speaker: 'HOST', provider: 'cartesia' }),
          expect.objectContaining({ episodeId: 'pod-1', speaker: 'EXPERT', provider: 'cartesia' }),
          expect.objectContaining({ episodeId: 'pod-1', speaker: 'GUEST', provider: 'cartesia' }),
        ]),
      })
    );
  });

  it('uses configured local sidecar voice IDs', async () => {
    serverConfiguration.ttsVoices = 'voice_a,voice_b,voice_c';

    await assignVoicesForEpisode(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }, { name: 'GUEST' }],
      'local'
    );

    const createCall = mockEpisodeVoiceCreateMany.mock.calls[0][0];
    const data = createCall.data as Array<{ provider: string; voiceId: string }>;
    expect(data).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'local' })]));
    for (const entry of data) {
      expect(['voice_a', 'voice_b', 'voice_c']).toContain(entry.voiceId);
    }
  });

  it('rejects unsupported providers instead of falling back to ElevenLabs', async () => {
    await expect(
      assignVoicesForEpisode('pod-1', [{ name: 'HOST' }, { name: 'EXPERT' }], 'unknown' as never)
    ).rejects.toThrow('Unsupported TTS provider for voice assignment: unknown');

    expect(mockEpisodeVoiceCreateMany).not.toHaveBeenCalled();
  });
});
