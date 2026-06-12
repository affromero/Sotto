import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assignVoicesForEpisode } from '@/lib/voice-assigner';

const mockEpisodeVoiceFindMany = vi.fn();
const mockEpisodeVoiceCreateMany = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
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
    mockEpisodeVoiceFindMany.mockResolvedValue([]);
    mockEpisodeVoiceCreateMany.mockResolvedValue({ count: 0 });
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
          expect.objectContaining({ episodeId: 'pod-1', speaker: 'EXPERT', provider: 'elevenlabs' }),
        ]),
      })
    );
  });

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
          expect.objectContaining({ episodeId: 'pod-1', speaker: 'EXPERT', provider: 'elevenlabs' }),
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

  it('rejects unsupported providers instead of falling back to ElevenLabs', async () => {
    await expect(
      assignVoicesForEpisode('pod-1', [{ name: 'HOST' }, { name: 'EXPERT' }], 'unknown' as never)
    ).rejects.toThrow('Unsupported TTS provider for voice assignment: unknown');

    expect(mockEpisodeVoiceCreateMany).not.toHaveBeenCalled();
  });
});
