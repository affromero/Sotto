import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPodcastVoiceFindMany = vi.fn();
const mockPodcastVoiceCreateMany = vi.fn();
const mockGetVoiceCatalog = vi.fn();
const mockGenerateResponse = vi.fn();
const mockLogUsage = vi.fn();
const mockResolveAutoModel = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcastVoice: {
      findMany: (...args: unknown[]) => mockPodcastVoiceFindMany(...args),
      createMany: (...args: unknown[]) => mockPodcastVoiceCreateMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/voice-catalog', () => ({
  getVoiceCatalog: (...args: unknown[]) => mockGetVoiceCatalog(...args),
}));

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: (...args: unknown[]) => mockGenerateResponse(...args) }),
}));

vi.mock('@/lib/prompt-loader', () => ({
  loadAndRender: vi.fn().mockReturnValue('Test prompt'),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('@/lib/auto-model-config', () => ({
  resolveAutoModel: (...args: unknown[]) => mockResolveAutoModel(...args),
}));

vi.mock('@/lib/redis', () => ({
  cache: { get: vi.fn(), set: vi.fn() },
  getRedisClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { assignVoicesForPodcast } from '@/lib/voice-assigner';

describe('assignVoicesForPodcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPodcastVoiceFindMany.mockResolvedValue([]);
    mockPodcastVoiceCreateMany.mockResolvedValue({ count: 0 });
    mockResolveAutoModel.mockResolvedValue({
      aiProvider: 'anthropic',
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'elevenlabs',
      ttsModel: 'eleven_v3',
      sttProvider: 'openai',
      sttModel: 'whisper-1',
    });
    mockLogUsage.mockResolvedValue(undefined);
  });

  it('skips assignment for 1 speaker', async () => {
    await assignVoicesForPodcast('pod-1', [{ name: 'HOST' }], 'elevenlabs');

    expect(mockPodcastVoiceFindMany).not.toHaveBeenCalled();
    expect(mockPodcastVoiceCreateMany).not.toHaveBeenCalled();
  });

  it('skips LLM and uses fallback for 2 speakers', async () => {
    await assignVoicesForPodcast(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }],
      'elevenlabs',
    );

    // Should use fallback (no LLM call) for 2 speakers
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    expect(mockPodcastVoiceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'HOST', provider: 'elevenlabs' }),
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'EXPERT', provider: 'elevenlabs' }),
        ]),
      }),
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
      'elevenlabs',
    );

    // All speakers already assigned — no new assignments
    expect(mockPodcastVoiceCreateMany).not.toHaveBeenCalled();
  });

  it('assigns 3 distinct voices via LLM for 3+ speakers', async () => {
    const catalog = [
      { id: 'v1', name: 'Voice 1', gender: 'female', description: 'warm host' },
      { id: 'v2', name: 'Voice 2', gender: 'male', description: 'authoritative expert' },
      { id: 'v3', name: 'Voice 3', gender: 'female', description: 'curious guest' },
      { id: 'v4', name: 'Voice 4', gender: 'male', description: 'skeptical analyst' },
    ];
    mockGetVoiceCatalog.mockResolvedValue(catalog);

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({ HOST: 'v1', EXPERT: 'v2', GUEST: 'v3' }),
      inputTokens: 100,
      outputTokens: 50,
      model: 'claude-haiku-4-5-20251001',
    });

    await assignVoicesForPodcast(
      'pod-1',
      [
        { name: 'HOST', description: 'Warm podcast host' },
        { name: 'EXPERT', description: 'Subject matter expert' },
        { name: 'GUEST', description: 'Curious newcomer' },
      ],
      'elevenlabs',
      'test-api-key',
    );

    expect(mockGetVoiceCatalog).toHaveBeenCalledWith('elevenlabs', 'test-api-key');
    expect(mockGenerateResponse).toHaveBeenCalled();
    expect(mockPodcastVoiceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          { podcastId: 'pod-1', speaker: 'HOST', voiceId: 'v1', provider: 'elevenlabs' },
          { podcastId: 'pod-1', speaker: 'EXPERT', voiceId: 'v2', provider: 'elevenlabs' },
          { podcastId: 'pod-1', speaker: 'GUEST', voiceId: 'v3', provider: 'elevenlabs' },
        ]),
      }),
    );
    expect(mockLogUsage).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'voice_assignment', podcastId: 'pod-1' }),
    );
  });

  it('falls back to hash-based selection on LLM failure', async () => {
    const catalog = [
      { id: 'v1', name: 'Voice 1', gender: 'female' },
      { id: 'v2', name: 'Voice 2', gender: 'male' },
      { id: 'v3', name: 'Voice 3', gender: 'female' },
    ];
    mockGetVoiceCatalog.mockResolvedValue(catalog);
    mockGenerateResponse.mockRejectedValue(new Error('LLM unavailable'));

    await assignVoicesForPodcast(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }, { name: 'GUEST' }],
      'elevenlabs',
    );

    // Should still create voices via fallback
    expect(mockPodcastVoiceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'HOST', provider: 'elevenlabs' }),
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'EXPERT', provider: 'elevenlabs' }),
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'GUEST', provider: 'elevenlabs' }),
        ]),
      }),
    );
  });

  it('falls back when LLM returns invalid JSON', async () => {
    mockGetVoiceCatalog.mockResolvedValue([
      { id: 'v1', name: 'Voice 1', gender: 'female' },
    ]);
    mockGenerateResponse.mockResolvedValue({
      content: 'not valid json at all',
      inputTokens: 50,
      outputTokens: 20,
      model: 'claude-haiku-4-5-20251001',
    });

    await assignVoicesForPodcast(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }, { name: 'GUEST' }],
      'elevenlabs',
    );

    // Fallback should still produce assignments
    expect(mockPodcastVoiceCreateMany).toHaveBeenCalled();
  });

  it('uses KittenTTS fallback directly without LLM', async () => {
    await assignVoicesForPodcast(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }, { name: 'GUEST' }],
      'kittentts',
    );

    expect(mockGenerateResponse).not.toHaveBeenCalled();
    expect(mockGetVoiceCatalog).not.toHaveBeenCalled();
    expect(mockPodcastVoiceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'HOST', provider: 'kittentts' }),
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'EXPERT', provider: 'kittentts' }),
          expect.objectContaining({ podcastId: 'pod-1', speaker: 'GUEST', provider: 'kittentts' }),
        ]),
      }),
    );
  });

  it('deduplicates voice IDs from LLM response', async () => {
    mockGetVoiceCatalog.mockResolvedValue([
      { id: 'v1', name: 'Voice 1', gender: 'female' },
      { id: 'v2', name: 'Voice 2', gender: 'male' },
    ]);
    // LLM assigns same voice to two speakers
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({ HOST: 'v1', EXPERT: 'v1', GUEST: 'v2' }),
      inputTokens: 50,
      outputTokens: 20,
      model: 'claude-haiku-4-5-20251001',
    });

    await assignVoicesForPodcast(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }, { name: 'GUEST' }],
      'elevenlabs',
    );

    const createCall = mockPodcastVoiceCreateMany.mock.calls[0][0];
    const llmData = createCall.data;
    // HOST gets v1, EXPERT is deduped out, GUEST gets v2
    expect(llmData).toEqual([
      { podcastId: 'pod-1', speaker: 'HOST', voiceId: 'v1', provider: 'elevenlabs' },
      { podcastId: 'pod-1', speaker: 'GUEST', voiceId: 'v2', provider: 'elevenlabs' },
    ]);

    // EXPERT should be assigned via fallback (second createMany call)
    expect(mockPodcastVoiceCreateMany).toHaveBeenCalledTimes(2);
  });

  it('handles markdown-wrapped JSON from LLM', async () => {
    mockGetVoiceCatalog.mockResolvedValue([
      { id: 'v1', name: 'Voice 1', gender: 'female' },
      { id: 'v2', name: 'Voice 2', gender: 'male' },
      { id: 'v3', name: 'Voice 3', gender: 'female' },
    ]);
    mockGenerateResponse.mockResolvedValue({
      content: '```json\n{"HOST": "v1", "EXPERT": "v2", "GUEST": "v3"}\n```',
      inputTokens: 50,
      outputTokens: 20,
      model: 'claude-haiku-4-5-20251001',
    });

    await assignVoicesForPodcast(
      'pod-1',
      [{ name: 'HOST' }, { name: 'EXPERT' }, { name: 'GUEST' }],
      'elevenlabs',
    );

    expect(mockPodcastVoiceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          { podcastId: 'pod-1', speaker: 'HOST', voiceId: 'v1', provider: 'elevenlabs' },
          { podcastId: 'pod-1', speaker: 'EXPERT', voiceId: 'v2', provider: 'elevenlabs' },
          { podcastId: 'pod-1', speaker: 'GUEST', voiceId: 'v3', provider: 'elevenlabs' },
        ]),
      }),
    );
  });
});
