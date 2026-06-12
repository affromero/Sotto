import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assignVoicesForPodcast } from '@/lib/voice-assigner';

const mockPodcastVoiceFindMany = vi.fn();
const mockPodcastVoiceCreateMany = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcastVoice: {
      findMany: (...args: unknown[]) => mockPodcastVoiceFindMany(...args),
      createMany: (...args: unknown[]) => mockPodcastVoiceCreateMany(...args),
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

describe('assignVoicesForPodcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPodcastVoiceFindMany.mockResolvedValue([]);
    mockPodcastVoiceCreateMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('skips assignment for 1 speaker', async () => {
    await assignVoicesForPodcast('pod-1', [{ name: 'HOST' }], 'elevenlabs');

    expect(mockPodcastVoiceFindMany).not.toHaveBeenCalled();
    expect(mockPodcastVoiceCreateMany).not.toHaveBeenCalled();
  });

  it('uses deterministic assignment for 2 speakers', async () => {
    await assignVoicesForPodcast('pod-1', [{ name: 'HOST' }, { name: 'EXPERT' }], 'elevenlabs');

    expect(mockPodcastVoiceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'HOST', provider: 'elevenlabs' }),
          expect.objectContaining({
            podcastId: 'pod-1',
            speaker: 'EXPERT',
            provider: 'elevenlabs',
          }),
        ]),
      })
    );
  });

  it('preserves existing voice overrides', async () => {
    mockPodcastVoiceFindMany.mockResolvedValue([
      { speaker: 'HOST' },
      { speaker: 'EXPERT' },
      { speaker: 'GUEST' },
    ]);

    await assignVoicesForPodcast(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }, { name: 'GUEST' }],
      'elevenlabs'
    );

    expect(mockPodcastVoiceCreateMany).not.toHaveBeenCalled();
  });

  it('assigns 3 distinct voices deterministically for 3+ speakers', async () => {
    await assignVoicesForPodcast(
      'pod-1',
      [
        { name: 'HOST', description: 'Warm podcast host' },
        { name: 'EXPERT', description: 'Subject matter expert' },
        { name: 'GUEST', description: 'Curious newcomer' },
      ],
      'elevenlabs'
    );

    const createCall = mockPodcastVoiceCreateMany.mock.calls[0][0];
    const data = createCall.data as Array<{ voiceId: string }>;
    expect(data).toHaveLength(3);
    expect(new Set(data.map((entry) => entry.voiceId)).size).toBe(3);
    expect(mockPodcastVoiceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'HOST', provider: 'elevenlabs' }),
          expect.objectContaining({
            podcastId: 'pod-1',
            speaker: 'EXPERT',
            provider: 'elevenlabs',
          }),
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'GUEST', provider: 'elevenlabs' }),
        ]),
      })
    );
  });

  it('uses provider-specific deterministic voice pools', async () => {
    await assignVoicesForPodcast(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }, { name: 'GUEST' }],
      'cartesia'
    );

    expect(mockPodcastVoiceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'HOST', provider: 'cartesia' }),
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'EXPERT', provider: 'cartesia' }),
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'GUEST', provider: 'cartesia' }),
        ]),
      })
    );
  });

  it('uses configured local sidecar voice IDs', async () => {
    vi.stubEnv('TTS_VOICES', 'voice_a,voice_b,voice_c');

    await assignVoicesForPodcast(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }, { name: 'GUEST' }],
      'local'
    );

    const createCall = mockPodcastVoiceCreateMany.mock.calls[0][0];
    const data = createCall.data as Array<{ provider: string; voiceId: string }>;
    expect(data).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'local' })]));
    for (const entry of data) {
      expect(['voice_a', 'voice_b', 'voice_c']).toContain(entry.voiceId);
    }
  });

  it('rejects unsupported providers instead of falling back to ElevenLabs', async () => {
    await expect(
      assignVoicesForPodcast('pod-1', [{ name: 'HOST' }, { name: 'EXPERT' }], 'unknown' as never)
    ).rejects.toThrow('Unsupported TTS provider for voice assignment: unknown');

    expect(mockPodcastVoiceCreateMany).not.toHaveBeenCalled();
  });
});
