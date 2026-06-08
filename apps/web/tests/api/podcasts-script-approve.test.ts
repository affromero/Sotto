import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastFindUniqueOrThrow = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockScriptFindUnique = vi.fn();
const mockDiscoveryFindFirst = vi.fn();
const mockCreateSegmentsAndQueueAudio = vi.fn();
const mockPodcastVoiceDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPodcastVoiceCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockCheckGenerationGate = vi.fn();
const mockSelectFreeTierProviders = vi.fn();
const mockAssignVoicesForPodcast = vi.fn();
const mockConvertTurnsForProvider = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockPodcastFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockScriptFindUnique(...args),
    },
    discovery: {
      findFirst: (...args: unknown[]) => mockDiscoveryFindFirst(...args),
    },
    podcastVoice: {
      deleteMany: (...args: unknown[]) => mockPodcastVoiceDeleteMany(...args),
      createMany: (...args: unknown[]) => mockPodcastVoiceCreateMany(...args),
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
  invalidatePodcastCache: vi.fn().mockResolvedValue(undefined),
  publishPodcastStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/generation-gate', () => ({
  checkGenerationGate: (...args: unknown[]) => mockCheckGenerationGate(...args),
}));

vi.mock('@/lib/free-tier-provider-selector', () => ({
  selectFreeTierProviders: (...args: unknown[]) => mockSelectFreeTierProviders(...args),
}));

vi.mock('@/lib/voice-assigner', () => ({
  assignVoicesForPodcast: (...args: unknown[]) => mockAssignVoicesForPodcast(...args),
}));

vi.mock('@/lib/tts-tag-converter', () => ({
  convertTurnsForProvider: (...args: unknown[]) => mockConvertTurnsForProvider(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/podcasts/[podcastId]/script/approve/route';

function createRequest(body?: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/script/approve'), {
    method: 'POST',
    ...(body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
}

async function createParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

const defaultTurns = [
  { speaker: 'HOST', text: 'Welcome', direction: 'enthusiastic' },
  { speaker: 'EXPERT', text: 'Thanks for having me' },
];

describe('POST /api/podcasts/[podcastId]/script/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isByokUser: true });
    mockSelectFreeTierProviders.mockResolvedValue({
      aiProvider: 'anthropic', aiModel: 'claude-haiku-4-5-20251001', aiQuota: 10,
      ttsProvider: 'elevenlabs', ttsModel: 'eleven_multilingual_v2', ttsQuota: 10,
    });
    mockPodcastUpdate.mockResolvedValue({});
    mockPodcastFindUniqueOrThrow.mockResolvedValue({ ttsProvider: 'elevenlabs' });
    mockDiscoveryFindFirst.mockResolvedValue(null);
    mockConvertTurnsForProvider.mockImplementation((turns: unknown[]) => Promise.resolve(turns));
    mockCreateSegmentsAndQueueAudio.mockResolvedValue(undefined);
    mockAssignVoicesForPodcast.mockResolvedValue(undefined);
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

  it('returns 404 when podcast not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 403 when user does not own the podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'other-user', status: 'SCRIPT_READY' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 400 when status is not SCRIPT_READY', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'GENERATING_AUDIO' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('SCRIPT_READY');
  });

  it('returns 404 when script not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockScriptFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Script not found' });
  });

  it('creates segments, queues audio, and transitions to GENERATING_AUDIO', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });

  describe('audio config at approve time', () => {
    it('writes ttsProvider from body for BYOK user', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isByokUser: true });
      mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const response = await POST(
        createRequest({ ttsProvider: 'openai', ttsModel: 'tts-1-hd' }),
        await createParams('pod-1')
      );

      expect(response.status).toBe(200);
      expect(mockPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pod-1' },
          data: { ttsProvider: 'openai', ttsModel: 'tts-1-hd' },
        })
      );
      expect(mockSelectFreeTierProviders).not.toHaveBeenCalled();
    });

    it('uses existing ttsProvider for BYOK user when no body provider is provided', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isByokUser: true });
      mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const response = await POST(createRequest(), await createParams('pod-1'));

      expect(response.status).toBe(200);
      const providerUpdateCalls = mockPodcastUpdate.mock.calls.filter(
        (call: unknown[]) => (call[0] as Record<string, unknown>).data &&
          'ttsProvider' in ((call[0] as Record<string, Record<string, unknown>>).data)
      );
      expect(providerUpdateCalls).toHaveLength(0);
      expect(mockSelectFreeTierProviders).not.toHaveBeenCalled();
      expect(mockAssignVoicesForPodcast).toHaveBeenCalledWith(
        'pod-1',
        expect.any(Array),
        'elevenlabs'
      );
    });

    it('requires a ttsProvider for BYOK user when none is selected or persisted', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isByokUser: true });
      mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockPodcastFindUniqueOrThrow.mockResolvedValueOnce({ ttsProvider: null });

      const response = await POST(createRequest(), await createParams('pod-1'));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toMatchObject({
        error: 'Choose a TTS provider before approving the script.',
        code: 'tts_provider_required',
      });
      expect(mockSelectFreeTierProviders).not.toHaveBeenCalled();
      expect(mockScriptFindUnique).not.toHaveBeenCalled();
      expect(mockAssignVoicesForPodcast).not.toHaveBeenCalled();
      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });

    it('auto-selects ttsProvider for free-tier user', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isByokUser: false });
      mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const response = await POST(createRequest(), await createParams('pod-1'));

      expect(response.status).toBe(200);
      expect(mockSelectFreeTierProviders).toHaveBeenCalledWith('user-1');
      expect(mockPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pod-1' },
          data: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_multilingual_v2' },
        })
      );
    });

    it('creates PodcastVoice records when voices provided', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
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
      expect(mockPodcastVoiceDeleteMany).toHaveBeenCalledWith({ where: { podcastId: 'pod-1' } });
      expect(mockPodcastVoiceCreateMany).toHaveBeenCalledWith({
        data: [
          { podcastId: 'pod-1', speaker: 'HOST', voiceId: 'voice-abc', provider: 'elevenlabs' },
          { podcastId: 'pod-1', speaker: 'EXPERT', voiceId: 'voice-xyz', provider: 'elevenlabs' },
        ],
      });
    });

    it('skips PodcastVoice creation when voices not provided', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const response = await POST(createRequest(), await createParams('pod-1'));

      expect(response.status).toBe(200);
      expect(mockPodcastVoiceDeleteMany).not.toHaveBeenCalled();
      expect(mockPodcastVoiceCreateMany).not.toHaveBeenCalled();
    });

    it('calls assignVoicesForPodcast when no custom voices provided', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockScriptFindUnique.mockResolvedValue({ turns: defaultTurns });

      const response = await POST(createRequest(), await createParams('pod-1'));

      expect(response.status).toBe(200);
      expect(mockAssignVoicesForPodcast).toHaveBeenCalledWith(
        'pod-1',
        expect.arrayContaining([
          expect.objectContaining({ name: 'HOST' }),
          expect.objectContaining({ name: 'EXPERT' }),
        ]),
        'elevenlabs'
      );
      // Voice assignment must happen before segment creation
      const assignOrder = mockAssignVoicesForPodcast.mock.invocationCallOrder[0];
      const segmentOrder = mockCreateSegmentsAndQueueAudio.mock.invocationCallOrder[0];
      expect(assignOrder).toBeLessThan(segmentOrder);
    });

    it('still runs auto voice assignment after saving explicit custom voices', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
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
      expect(mockAssignVoicesForPodcast).toHaveBeenCalledWith(
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
      mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
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
      expect(mockPodcastVoiceCreateMany).toHaveBeenCalledWith({
        data: [{ podcastId: 'pod-1', speaker: 'HOST', voiceId: 'voice-abc', provider: 'elevenlabs' }],
      });
      expect(mockAssignVoicesForPodcast).toHaveBeenCalledWith(
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
      mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
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
      expect(mockPodcastVoiceDeleteMany).toHaveBeenCalledWith({ where: { podcastId: 'pod-1' } });
      expect(mockPodcastVoiceCreateMany).not.toHaveBeenCalled();
      expect(mockAssignVoicesForPodcast).toHaveBeenCalledWith(
        'pod-1',
        [{ name: 'ALICE' }, { name: 'BOB' }],
        'elevenlabs'
      );
    });
  });
});
