import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockEpisodeFindUnique = vi.fn();
const mockEpisodeFindUniqueOrThrow = vi.fn();
const mockEpisodeUpdate = vi.fn();
const mockEpisodeUpdateMany = vi.fn();
const mockScriptFindUnique = vi.fn();
const mockDiscoveryFindFirst = vi.fn();
const mockCreateSegmentsAndQueueAudio = vi.fn();
const mockEpisodeVoiceDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockEpisodeVoiceCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockGetAutoModelConfig = vi.fn();
const mockAssignVoicesForEpisode = vi.fn();
const mockConvertTurnsForProvider = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    episode: {
      findUnique: (...args: unknown[]) => mockEpisodeFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockEpisodeFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockEpisodeUpdate(...args),
      updateMany: (...args: unknown[]) => mockEpisodeUpdateMany(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockScriptFindUnique(...args),
    },
    discovery: {
      findFirst: (...args: unknown[]) => mockDiscoveryFindFirst(...args),
    },
    episodeVoice: {
      deleteMany: (...args: unknown[]) => mockEpisodeVoiceDeleteMany(...args),
      createMany: (...args: unknown[]) => mockEpisodeVoiceCreateMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/segment-creator', () => ({
  createSegmentsAndQueueAudio: (...args: unknown[]) => mockCreateSegmentsAndQueueAudio(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getRedisClient: vi.fn(),
  invalidateEpisodeCache: vi.fn().mockResolvedValue(undefined),
  publishEpisodeStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...args: unknown[]) => mockGetAutoModelConfig(...args),
}));

vi.mock('@/lib/voice-assigner', () => ({
  assignVoicesForEpisode: (...args: unknown[]) => mockAssignVoicesForEpisode(...args),
}));

vi.mock('@/lib/tts-tag-converter', () => ({
  convertTurnsForProvider: (...args: unknown[]) => mockConvertTurnsForProvider(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/v1/episodes/[episodeId]/script/approve/route';

function createRequest(body?: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/episodes/pod-1/script/approve'), {
    method: 'POST',
    ...(body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
}

async function createParams(episodeId: string) {
  return { params: Promise.resolve({ episodeId }) };
}

const defaultTurns = [
  { speaker: 'HOST', text: 'Welcome', direction: 'enthusiastic' },
  { speaker: 'EXPERT', text: 'Thanks for having me' },
];

describe('POST /api/v1/episodes/[episodeId]/script/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAutoModelConfig.mockResolvedValue({
      model: {
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_multilingual_v2',
        sttProvider: 'openai',
        sttModel: 'whisper-1',
      },
      platform: {
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
      },
    });
    mockEpisodeUpdate.mockResolvedValue({});
    mockEpisodeUpdateMany.mockResolvedValue({ count: 1 });
    mockEpisodeFindUniqueOrThrow.mockResolvedValue({ ttsProvider: 'elevenlabs' });
    mockDiscoveryFindFirst.mockResolvedValue(null);
    mockConvertTurnsForProvider.mockImplementation((turns: unknown[]) => Promise.resolve(turns));
    mockCreateSegmentsAndQueueAudio.mockResolvedValue(undefined);
    mockAssignVoicesForEpisode.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when episode not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Episode not found' });
  });

  it('returns 403 when user does not own the episode', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'other-user', status: 'SCRIPT_READY' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 400 when status is not SCRIPT_READY', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'GENERATING_AUDIO' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('SCRIPT_READY');
  });

  it('returns 404 when script not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockScriptFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Script not found' });
  });

  it('creates segments, queues audio, and transitions to GENERATING_AUDIO', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });

  it('does not mutate configuration or queue audio when another approval wins', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });
    mockEpisodeUpdateMany.mockResolvedValue({ count: 0 });

    const response = await POST(createRequest(), await createParams('pod-1'));

    expect(response.status).toBe(409);
    expect(mockEpisodeUpdate).not.toHaveBeenCalled();
    expect(mockEpisodeVoiceDeleteMany).not.toHaveBeenCalled();
    expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
  });

  describe('audio config at approve time', () => {
    it('writes ttsProvider from body', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockEpisodeFindUniqueOrThrow.mockResolvedValue({ ttsProvider: 'openai' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const response = await POST(
        createRequest({ ttsProvider: 'openai', ttsModel: 'tts-1-hd' }),
        await createParams('pod-1')
      );

      expect(response.status).toBe(200);
      expect(mockEpisodeUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pod-1' },
          data: { ttsProvider: 'openai', ttsModel: 'tts-1-hd' },
        })
      );
    });

    it('uses existing ttsProvider when no body provider is provided', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({
        userId: 'user-1',
        status: 'SCRIPT_READY',
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_multilingual_v2',
      });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const response = await POST(createRequest(), await createParams('pod-1'));

      expect(response.status).toBe(200);
      const providerUpdateCalls = mockEpisodeUpdate.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).data &&
          'ttsProvider' in (call[0] as Record<string, Record<string, unknown>>).data
      );
      expect(providerUpdateCalls).toHaveLength(1);
      expect(providerUpdateCalls[0][0]).toEqual(
        expect.objectContaining({
          where: { id: 'pod-1' },
          data: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_multilingual_v2' },
        })
      );
      expect(mockAssignVoicesForEpisode).toHaveBeenCalledWith(
        'pod-1',
        expect.any(Array),
        'elevenlabs'
      );
    });

    it('uses auto-model TTS defaults when none is selected or persisted', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const response = await POST(createRequest(), await createParams('pod-1'));

      expect(response.status).toBe(200);
      expect(mockEpisodeUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pod-1' },
          data: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_multilingual_v2' },
        })
      );
    });

    it('creates EpisodeVoice records when voices provided', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const voices = [
        { speaker: 'HOST', voiceId: 'voice-abc' },
        { speaker: 'EXPERT', voiceId: 'voice-xyz' },
      ];
      const response = await POST(
        createRequest({ ttsProvider: 'elevenlabs', ttsModel: 'eleven_v3', voices }),
        await createParams('pod-1')
      );

      expect(response.status).toBe(200);
      expect(mockEpisodeVoiceDeleteMany).toHaveBeenCalledWith({ where: { episodeId: 'pod-1' } });
      expect(mockEpisodeVoiceCreateMany).toHaveBeenCalledWith({
        data: [
          { episodeId: 'pod-1', speaker: 'HOST', voiceId: 'voice-abc', provider: 'elevenlabs' },
          { episodeId: 'pod-1', speaker: 'EXPERT', voiceId: 'voice-xyz', provider: 'elevenlabs' },
        ],
      });
    });

    it('skips EpisodeVoice creation when voices not provided', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const response = await POST(createRequest(), await createParams('pod-1'));

      expect(response.status).toBe(200);
      expect(mockEpisodeVoiceDeleteMany).not.toHaveBeenCalled();
      expect(mockEpisodeVoiceCreateMany).not.toHaveBeenCalled();
    });

    it('calls assignVoicesForEpisode when no custom voices provided', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const response = await POST(createRequest(), await createParams('pod-1'));

      expect(response.status).toBe(200);
      expect(mockAssignVoicesForEpisode).toHaveBeenCalledWith(
        'pod-1',
        expect.arrayContaining([
          expect.objectContaining({ name: 'HOST' }),
          expect.objectContaining({ name: 'EXPERT' }),
        ]),
        'elevenlabs'
      );
      // Voice assignment must happen before segment creation
      const assignOrder = mockAssignVoicesForEpisode.mock.invocationCallOrder[0];
      const segmentOrder = mockCreateSegmentsAndQueueAudio.mock.invocationCallOrder[0];
      expect(assignOrder).toBeLessThan(segmentOrder);
    });

    it('still runs auto voice assignment after saving explicit custom voices', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const voices = [
        { speaker: 'HOST', voiceId: 'voice-abc' },
        { speaker: 'EXPERT', voiceId: 'voice-xyz' },
      ];
      const response = await POST(
        createRequest({ ttsProvider: 'elevenlabs', voices }),
        await createParams('pod-1')
      );

      expect(response.status).toBe(200);
      expect(mockAssignVoicesForEpisode).toHaveBeenCalledWith(
        'pod-1',
        expect.arrayContaining([
          expect.objectContaining({ name: 'HOST' }),
          expect.objectContaining({ name: 'EXPERT' }),
        ]),
        'elevenlabs'
      );
    });

    it('filters out voices with null voiceId', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const voices = [
        { speaker: 'HOST', voiceId: 'voice-abc' },
        { speaker: 'EXPERT', voiceId: null },
      ];
      const response = await POST(
        createRequest({ ttsProvider: 'elevenlabs', voices }),
        await createParams('pod-1')
      );

      expect(response.status).toBe(200);
      expect(mockEpisodeVoiceCreateMany).toHaveBeenCalledWith({
        data: [
          { episodeId: 'pod-1', speaker: 'HOST', voiceId: 'voice-abc', provider: 'elevenlabs' },
        ],
      });
      expect(mockAssignVoicesForEpisode).toHaveBeenCalledWith(
        'pod-1',
        expect.arrayContaining([
          expect.objectContaining({ name: 'HOST' }),
          expect.objectContaining({ name: 'EXPERT' }),
        ]),
        'elevenlabs'
      );
    });

    it('treats all-auto voice placeholders as needing auto assignment', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({
        turns: [
          { speaker: 'ALICE', text: 'Intro' },
          { speaker: 'BOB', text: 'Response' },
        ],
      });

      const response = await POST(
        createRequest({
          ttsProvider: 'elevenlabs',
          voices: [
            { speaker: 'ALICE', voiceId: null },
            { speaker: 'BOB', voiceId: null },
          ],
        }),
        await createParams('pod-1')
      );

      expect(response.status).toBe(200);
      expect(mockEpisodeVoiceDeleteMany).toHaveBeenCalledWith({ where: { episodeId: 'pod-1' } });
      expect(mockEpisodeVoiceCreateMany).not.toHaveBeenCalled();
      expect(mockAssignVoicesForEpisode).toHaveBeenCalledWith(
        'pod-1',
        [{ name: 'ALICE' }, { name: 'BOB' }],
        'elevenlabs'
      );
    });
  });
});
